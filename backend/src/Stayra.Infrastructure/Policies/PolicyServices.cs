using System.Globalization;
using System.Text;
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
        "có", "không", "của", "và", "là", "cho", "mình", "bạn", "được", "những", "thì", "này", "với", "ạ", "nhé", "vậy", "gì", "nào", "thế", "homestay",
        "co", "khong", "cua", "va", "la", "cho", "minh", "ban", "duoc", "nhung", "thi", "nay", "voi", "a", "nhe", "vay", "gi", "nao", "the", "hoi",
    };

    private static readonly Dictionary<string, string[]> Synonyms = new(StringComparer.OrdinalIgnoreCase)
    {
        ["sang"] = ["breakfast", "coffee"],
        ["bua"] = ["breakfast"],
        ["breakfast"] = ["sang", "bua"],
        ["cho"] = ["pet", "pets", "assistance", "market"],
        ["meo"] = ["pet", "pets"],
        ["thu"] = ["pet", "pets"],
        ["cung"] = ["pet", "pets"],
        ["pet"] = ["thu", "cung", "cho", "meo"],
        ["pets"] = ["thu", "cung", "cho", "meo"],
        ["xe"] = ["parking", "motorbikes", "car"],
        ["dau"] = ["parking"],
        ["do"] = ["parking"],
        ["may"] = ["motorbikes", "parking"],
        ["oto"] = ["car", "parking"],
        ["parking"] = ["xe", "dau", "do", "oto"],
        ["huy"] = ["cancel", "cancellation", "cancellations", "refund", "refundable"],
        ["hoan"] = ["refund", "refunds", "refundable", "returned"],
        ["coc"] = ["deposit"],
        ["deposit"] = ["coc"],
        ["cancel"] = ["huy", "hoan"],
        ["cancellation"] = ["huy", "hoan"],
        ["refund"] = ["hoan", "coc"],
        ["nhan"] = ["check", "checkin"],
        ["tra"] = ["check", "checkout"],
        ["som"] = ["early"],
        ["muon"] = ["late"],
        ["gio"] = ["hourly", "hours", "quiet", "time", "check"],
        ["hourly"] = ["gio"],
        ["yen"] = ["quiet"],
        ["tinh"] = ["quiet"],
        ["on"] = ["quiet"],
        ["quiet"] = ["yen", "tinh"],
        ["thuoc"] = ["smoking", "smoke"],
        ["hut"] = ["smoking", "smoke"],
        ["smoking"] = ["hut", "thuoc"],
        ["wifi"] = ["wi", "fi", "network"],
        ["mang"] = ["wi", "fi", "network"],
        ["suoi"] = ["heated", "heater"],
        ["chan"] = ["blankets"],
        ["am"] = ["heated", "blankets"],
        ["noi"] = ["house", "rules"],
        ["quy"] = ["house", "rules", "regulations", "policy"],
        ["chinh"] = ["policy", "rules"],
        ["sach"] = ["policy", "rules"],
        ["rules"] = ["noi", "quy"],
        ["policy"] = ["chinh", "sach", "noi", "quy"],
        ["chia"] = ["keys"],
        ["khoa"] = ["keys"],
        ["mat"] = ["lost", "damage"],
        ["bo"] = ["left", "lost"],
        ["quen"] = ["left", "lost"],
        ["doi"] = ["change", "changes"],
        ["trung"] = ["centre", "center"],
        ["tam"] = ["centre", "center"],
        ["xuan"] = ["xuan", "huong", "lake"],
        ["huong"] = ["huong", "lake"],
        ["cccd"] = ["id", "passport"],
        ["ho"] = ["passport"],
        ["chieu"] = ["passport"],
        ["momo"] = ["momo", "deposit", "refunds"],
        ["thanh"] = ["payment", "payments", "deposit"],
        ["toan"] = ["payment", "payments", "deposit"],
    };

    private static string Plain(string text)
    {
        var n = text.ToLowerInvariant().Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(n.Length);
        foreach (var c in n)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return sb.ToString();
    }

    public static List<string> Tokens(string query) =>
        WordRegex().Matches(query.ToLowerInvariant()).Select(m => m.Value).Where(t => t.Length >= 2 && !Stop.Contains(t)).Distinct().Take(12).ToList();

    private static List<string> SearchTerms(string query)
    {
        var baseTokens = WordRegex().Matches(Plain(query)).Select(m => m.Value).Where(t => t.Length >= 2 && !Stop.Contains(t)).Distinct().Take(12).ToList();
        var expanded = new HashSet<string>(baseTokens, StringComparer.OrdinalIgnoreCase);
        foreach (var t in baseTokens)
            if (Synonyms.TryGetValue(t, out var syn))
                foreach (var s in syn) expanded.Add(s);
        return expanded.ToList();
    }

    private static int WordHits(string text, IReadOnlyList<string> terms)
    {
        if (terms.Count == 0) return 0;
        var words = new HashSet<string>(WordRegex().Matches(Plain(text)).Select(m => m.Value), StringComparer.OrdinalIgnoreCase);
        return terms.Count(words.Contains);
    }

    public async Task<PolicySearchResult> SearchAsync(Guid tenantId, string query, int k = 5, CancellationToken ct = default)
    {
        query = query.Length > 500 ? query[..500] : query;
        var docs = await db.PolicyDocuments.Where(d => d.TenantId == tenantId).ToDictionaryAsync(d => d.Id, d => d.FileName, ct);
        var chunks = new List<PolicyHit>();
        var tokens = Tokens(query);
        var terms = SearchTerms(query);

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

        if (chunks.Count == 0 && terms.Count > 0)
        {
            var tsQuery = string.Join(" | ", terms.Select(t => t + ":*"));
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
                chunks = all.Select(c => new { c, score = WordHits(c.Content, terms) })
                    .Where(x => x.score > 0).OrderByDescending(x => x.score).Take(k)
                    .Select(x => new PolicyHit(x.c.Content, x.c.Page, docs.GetValueOrDefault(x.c.DocumentId, "document"), x.score / (double)Math.Max(1, tokens.Count))).ToList();
            }
        }

        var faqs = await db.FaqItems.Where(f => f.TenantId == tenantId && f.Status == FaqStatus.Approved).ToListAsync(ct);
        var faqHits = faqs.Select(f => new { f, score = WordHits(f.Question + " " + f.Answer, terms) })
            .Where(x => x.score > 0).OrderByDescending(x => x.score).Take(3).Select(x => new FaqHit(x.f.Question, x.f.Answer)).ToList();
        return new PolicySearchResult(chunks, faqHits);
    }

    /// <summary>The single sentence (or short passage) of a chunk that best matches the query — for concise citations.</summary>
    public static string BestPassage(string content, string query, int maxChars = 600)
    {
        var terms = SearchTerms(query);
        var sentences = Regex.Split(content, @"(?<=[.!?])\s+").Where(s => s.Length > 0).ToList();
        if (sentences.Count == 0) return content;
        var best = sentences.Select((s, i) => new { s, i, score = WordHits(s, terms) })
            .OrderByDescending(x => x.score).First();
        var passage = best.s;
        if (best.i + 1 < sentences.Count && passage.Length < 220 && WordHits(sentences[best.i + 1], terms) > 0)
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
    public async Task Ingest(Guid documentId, bool extract, string? language = null)
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
            var vi = GuestText.IsVietnamese(language);
            if (pages.Sum(p => p.Text.Length) < 40)
                throw new InvalidOperationException(vi
                    ? "PDF này không có văn bản đọc được (có thể là ảnh scan)."
                    : "This PDF has no readable text (it may be a scanned image).");

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
                await extraction.ExtractAndSaveDraftAsync(doc, pages, language);
            }

            doc.Status = DocumentStatus.Ready;
            doc.StatusDetail = null;
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Policy ingestion failed for {Doc}", documentId);
            doc.Status = DocumentStatus.Failed;
            doc.StatusDetail = ex is InvalidOperationException ? ex.Message
                : GuestText.IsVietnamese(language) ? "Không đọc được tệp PDF này. Vui lòng thử tệp khác."
                : "We couldn't read this PDF. Please try another file.";
            await db.SaveChangesAsync();
        }
        await realtime.DocumentChanged(doc.TenantId, doc.Id);
    }
}

public class PolicySeedHook(IJobScheduler jobs) : ISeedHook
{
    public Task AfterSeedAsync(Tenant pine, Tenant sea, PolicyDocument pineDoc)
    {
        jobs.Enqueue<PolicyJobs>(j => j.Ingest(pineDoc.Id, false, null));
        return Task.CompletedTask;
    }
}
