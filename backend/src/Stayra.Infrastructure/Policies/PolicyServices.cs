using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pgvector;
using Pgvector.EntityFrameworkCore;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Persistence;

namespace Stayra.Infrastructure.Policies;

public record PolicyHit(string Content, int Page, string DocumentName, double Score);
public record FaqHit(string Question, string Answer);
public record PolicySearchResult(List<PolicyHit> Chunks, List<FaqHit> Faqs);

public partial class PolicySearchService(IAppDbContext db, IEmbeddingService embeddings, ILogger<PolicySearchService> log)
{
    private static readonly HashSet<string> Stop = new(StringComparer.OrdinalIgnoreCase)
    {
        "the", "and", "for", "are", "can", "you", "your", "with", "what", "when", "where", "how", "does", "is", "do", "any", "there", "have", "about",
        "this", "that", "from", "will", "please", "tell", "much", "many", "our", "may", "i", "we", "it", "of", "to", "in", "on", "a", "an", "or", "be",
        "có", "không", "của", "và", "là", "cho", "mình", "bạn", "được", "những", "thì", "này", "với", "ạ", "nhé", "vậy", "gì", "nào",
    };

    public static List<string> Tokens(string query) =>
        WordRegex().Matches(query.ToLowerInvariant()).Select(m => m.Value).Where(t => t.Length >= 3 && !Stop.Contains(t)).Distinct().Take(12).ToList();

    public async Task<PolicySearchResult> SearchAsync(Guid tenantId, string query, int k = 5, CancellationToken ct = default)
    {
        query = query.Length > 500 ? query[..500] : query;
        var docs = await db.PolicyDocuments.Where(d => d.TenantId == tenantId).ToDictionaryAsync(d => d.Id, d => d.FileName, ct);
        var chunks = new List<PolicyHit>();
        var tokens = Tokens(query);

        if (embeddings.IsEnabled && await db.PolicyChunks.AnyAsync(c => c.TenantId == tenantId && c.Embedding != null, ct))
        {
            var v = await embeddings.EmbedAsync(query, isQuery: true, ct);
            if (v != null)
            {
                var vec = new Vector(v);
                var rows = await db.PolicyChunks.Where(c => c.TenantId == tenantId && c.Embedding != null)
                    .Select(c => new { c.Content, c.Page, c.DocumentId, Distance = c.Embedding!.CosineDistance(vec) })
                    .OrderBy(x => x.Distance).Take(k).ToListAsync(ct);
                chunks = rows.Where(r => r.Distance < 0.75)
                    .Select(r => new PolicyHit(r.Content, r.Page, docs.GetValueOrDefault(r.DocumentId, "document"), Math.Round(1 - r.Distance, 3))).ToList();
            }
        }

        if (chunks.Count == 0 && tokens.Count > 0)
        {
            var tsQuery = string.Join(" | ", tokens.Select(t => t + ":*"));
            try
            {
                var rows = await db.PolicyChunks
                    .FromSqlInterpolated($"""
                        SELECT * FROM "PolicyChunks"
                        WHERE "TenantId" = {tenantId} AND to_tsvector('simple', "Content") @@ to_tsquery('simple', {tsQuery})
                        ORDER BY ts_rank(to_tsvector('simple', "Content"), to_tsquery('simple', {tsQuery})) DESC
                        LIMIT {k}
                        """)
                    .Select(c => new { c.Content, c.Page, c.DocumentId }).ToListAsync(ct);
                chunks = rows.Select((r, i) => new PolicyHit(r.Content, r.Page, docs.GetValueOrDefault(r.DocumentId, "document"), Math.Round(1.0 - i * 0.1, 2))).ToList();
            }
            catch (Exception ex) { log.LogWarning(ex, "Full-text policy search failed"); }

            if (chunks.Count == 0)
            {
                var all = await db.PolicyChunks.Where(c => c.TenantId == tenantId).Select(c => new { c.Content, c.Page, c.DocumentId }).ToListAsync(ct);
                chunks = all.Select(c => new { c, score = tokens.Count(t => c.Content.Contains(t, StringComparison.OrdinalIgnoreCase)) })
                    .Where(x => x.score > 0).OrderByDescending(x => x.score).Take(k)
                    .Select(x => new PolicyHit(x.c.Content, x.c.Page, docs.GetValueOrDefault(x.c.DocumentId, "document"), x.score / (double)tokens.Count)).ToList();
            }
        }

        var faqs = await db.FaqItems.Where(f => f.TenantId == tenantId && f.Status == FaqStatus.Approved).ToListAsync(ct);
        var faqHits = faqs.Select(f => new { f, score = tokens.Count(t => (f.Question + " " + f.Answer).Contains(t, StringComparison.OrdinalIgnoreCase)) })
            .Where(x => x.score > 0).OrderByDescending(x => x.score).Take(3).Select(x => new FaqHit(x.f.Question, x.f.Answer)).ToList();
        return new PolicySearchResult(chunks, faqHits);
    }

    /// <summary>The single sentence (or short passage) of a chunk that best matches the query — for concise citations.</summary>
    public static string BestPassage(string content, string query, int maxChars = 600)
    {
        var tokens = Tokens(query);
        var sentences = Regex.Split(content, @"(?<=[.!?])\s+").Where(s => s.Length > 0).ToList();
        if (sentences.Count == 0) return content;
        var best = sentences.Select((s, i) => new { s, i, score = tokens.Count(t => s.Contains(t, StringComparison.OrdinalIgnoreCase)) })
            .OrderByDescending(x => x.score).First();
        var passage = best.s;
        if (best.i + 1 < sentences.Count && passage.Length < 200 && tokens.Any(t => sentences[best.i + 1].Contains(t, StringComparison.OrdinalIgnoreCase)))
            passage += " " + sentences[best.i + 1];
        passage = passage.Replace("\n", " ");
        return passage.Length > maxChars ? passage[..maxChars] : passage;
    }

    [GeneratedRegex(@"[\p{L}\p{N}]+")] private static partial Regex WordRegex();
}

/// <summary>Background ingestion: PDF → text → chunks → embeddings → (optional) rule extraction.</summary>
public class PolicyJobs(
    IAppDbContext db,
    ITenantContext tenantContext,
    IFileStorage storage,
    IEmbeddingService embeddings,
    PolicyExtractionService extraction,
    IRealtimeNotifier realtime,
    ILogger<PolicyJobs> log)
{
    public async Task Ingest(Guid documentId, bool extract)
    {
        tenantContext.Set(null, bypass: true);
        var doc = await db.PolicyDocuments.FirstOrDefaultAsync(d => d.Id == documentId);
        if (doc == null) return;
        tenantContext.Set(doc.TenantId);
        try
        {
            doc.Status = DocumentStatus.Processing;
            doc.StatusDetail = "Reading the PDF";
            await db.SaveChangesAsync();
            await realtime.DocumentChanged(doc.TenantId, doc.Id);

            var path = storage.PathFromUrl(doc.Url) ?? throw new InvalidOperationException("File not found in storage");
            await using var stream = await storage.OpenAsync(path) ?? throw new InvalidOperationException("File not found in storage");
            using var ms = new MemoryStream();
            await stream.CopyToAsync(ms);
            var pages = PdfText.Extract(ms.ToArray());
            doc.PageCount = pages.Count;
            if (pages.Sum(p => p.Text.Length) < 40)
                throw new InvalidOperationException("This PDF has no readable text (it may be a scanned image).");

            var chunks = PdfText.Chunk(pages);
            doc.StatusDetail = embeddings.IsEnabled ? "Indexing for search" : "Indexing for keyword search";
            await db.SaveChangesAsync();
            var vectors = embeddings.IsEnabled ? await embeddings.EmbedManyAsync(chunks.Select(c => c.Content).ToList()) : null;

            await db.PolicyChunks.Where(c => c.DocumentId == doc.Id).ExecuteDeleteAsync();
            for (var i = 0; i < chunks.Count; i++)
                db.PolicyChunks.Add(new PolicyChunk
                {
                    TenantId = doc.TenantId, DocumentId = doc.Id, Content = chunks[i].Content, Page = chunks[i].Page, Ordinal = chunks[i].Ordinal,
                    Embedding = vectors != null && i < vectors.Count ? new Vector(vectors[i]) : null,
                });
            doc.ChunkCount = chunks.Count;

            if (extract)
            {
                doc.StatusDetail = "Reading the cancellation rules";
                await db.SaveChangesAsync();
                await realtime.DocumentChanged(doc.TenantId, doc.Id);
                await extraction.ExtractAndSaveDraftAsync(doc, pages);
            }

            doc.Status = DocumentStatus.Ready;
            doc.StatusDetail = null;
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Policy ingestion failed for {Doc}", documentId);
            doc.Status = DocumentStatus.Failed;
            doc.StatusDetail = ex is InvalidOperationException ? ex.Message : "We couldn't read this PDF. Please try another file.";
            await db.SaveChangesAsync();
        }
        await realtime.DocumentChanged(doc.TenantId, doc.Id);
    }
}

public class PolicySeedHook(IJobScheduler jobs) : ISeedHook
{
    public Task AfterSeedAsync(Tenant pine, Tenant sea, PolicyDocument pineDoc)
    {
        jobs.Enqueue<PolicyJobs>(j => j.Ingest(pineDoc.Id, false));
        return Task.CompletedTask;
    }
}
