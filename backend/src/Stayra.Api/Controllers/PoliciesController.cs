using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stayra.Api.Contracts;
using Stayra.Application.Common;
using Stayra.Application.Refunds;
using Stayra.Domain;
using Stayra.Infrastructure.Policies;

namespace Stayra.Api.Controllers;

public record PolicyUpdateRequest(List<RefundRuleDto> Rules, decimal NoShowRefundPercent, string? Notes);

[Route("api/app/policies")]
public class PoliciesController(IFileStorage storage, IJobScheduler jobs, PolicySearchService search, IRealtimeNotifier realtime) : OwnerControllerBase
{
    [HttpGet("documents")]
    public async Task<List<PolicyDocumentDto>> Documents() =>
        (await Db.PolicyDocuments.OrderByDescending(d => d.UploadedAt).ToListAsync()).Select(PolicyDocumentDto.From).ToList();

    [HttpGet("documents/{id:guid}")]
    public async Task<PolicyDocumentDto> Document(Guid id) =>
        PolicyDocumentDto.From(await Db.PolicyDocuments.FirstOrDefaultAsync(d => d.Id == id) ?? throw AppException.NotFound("Document"));

    [HttpPost("documents")]
    [RequestSizeLimit(25_000_000)]
    public async Task<PolicyDocumentDto> Upload(IFormFile file, [FromForm] string? language = null)
    {
        if (file == null || file.Length == 0) throw AppException.BadRequest("no_file", "Choose a PDF to upload.");
        if (!file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && file.ContentType != "application/pdf")
            throw AppException.BadRequest("not_a_pdf", "Only PDF files are supported.");
        if (file.Length > 20_000_000) throw AppException.BadRequest("file_too_large", "The PDF must be smaller than 20 MB.");
        var safeName = string.Concat(Path.GetFileName(file.FileName).Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_' ? c : '-'));
        await using var s = file.OpenReadStream();
        var url = await storage.SaveAsync(s, $"{TenantId}/policies/{Guid.NewGuid():N}-{safeName}", "application/pdf");
        var doc = new PolicyDocument { TenantId = TenantId, FileName = Path.GetFileName(file.FileName), Url = url, Status = DocumentStatus.Uploaded };
        Db.PolicyDocuments.Add(doc);
        Db.AuditLogs.Add(new AuditLog { TenantId = TenantId, Actor = Actor, Action = "policy.document_uploaded", EntityType = nameof(PolicyDocument), EntityId = doc.Id });
        await Db.SaveChangesAsync();
        var lang = NormalizeLanguage(language);
        jobs.Enqueue<PolicyJobs>(j => j.Ingest(doc.Id, true, lang));
        return PolicyDocumentDto.From(doc);
    }

    [HttpPost("documents/{id:guid}/reprocess")]
    public async Task<PolicyDocumentDto> Reprocess(Guid id, [FromQuery] string? language = null)
    {
        var doc = await Db.PolicyDocuments.FirstOrDefaultAsync(d => d.Id == id) ?? throw AppException.NotFound("Document");
        doc.Status = DocumentStatus.Uploaded;
        doc.StatusDetail = null;
        await Db.SaveChangesAsync();
        var lang = NormalizeLanguage(language);
        jobs.Enqueue<PolicyJobs>(j => j.Ingest(doc.Id, true, lang));
        return PolicyDocumentDto.From(doc);
    }

    private static string? NormalizeLanguage(string? language) =>
        string.Equals(language, "vi", StringComparison.OrdinalIgnoreCase) ? "vi"
        : string.Equals(language, "en", StringComparison.OrdinalIgnoreCase) ? "en"
        : null;

    [HttpDelete("documents/{id:guid}")]
    public async Task<IActionResult> DeleteDocument(Guid id)
    {
        var doc = await Db.PolicyDocuments.FirstOrDefaultAsync(d => d.Id == id) ?? throw AppException.NotFound("Document");
        await Db.PolicyChunks.Where(c => c.DocumentId == id).ExecuteDeleteAsync();
        Db.PolicyDocuments.Remove(doc);
        await Db.SaveChangesAsync();
        if (storage.PathFromUrl(doc.Url) is { } path) await storage.DeleteAsync(path);
        await realtime.DocumentChanged(TenantId, id);
        return NoContent();
    }

    [HttpGet]
    public async Task<List<RefundPolicyDto>> Policies() =>
        (await Db.RefundPolicies.OrderByDescending(p => p.Version).ToListAsync())
            .OrderBy(p => p.Status == RefundPolicyStatus.Draft ? 0 : p.Status == RefundPolicyStatus.Active ? 1 : 2).ThenByDescending(p => p.Version)
            .Select(RefundPolicyDto.From).ToList();

    [HttpGet("{id:guid}")]
    public async Task<RefundPolicyDto> Get(Guid id) => RefundPolicyDto.From(await Load(id));

    [HttpPost("draft")]
    public async Task<RefundPolicyDto> CreateDraft()
    {
        var tenant = await CurrentTenantAsync();
        var vi = GuestText.IsVietnamese(tenant.DefaultLanguage);
        var active = await Db.RefundPolicies.Where(p => p.Status == RefundPolicyStatus.Active).OrderByDescending(p => p.Version).FirstOrDefaultAsync();
        var version = (await Db.RefundPolicies.MaxAsync(p => (int?)p.Version) ?? 0) + 1;
        var draft = new RefundPolicy
        {
            TenantId = TenantId, Status = RefundPolicyStatus.Draft, Version = version, SourceDocumentId = active?.SourceDocumentId,
            NoShowRefundPercent = active?.NoShowRefundPercent ?? 0, Notes = active?.Notes,
            Rules = active?.Rules.Select(r => new RefundRule
            {
                MinHoursBeforeCheckIn = r.MinHoursBeforeCheckIn, MaxHoursBeforeCheckIn = r.MaxHoursBeforeCheckIn, RefundPercent = r.RefundPercent,
                AppliesTo = r.AppliesTo, Label = r.Label, SourceQuote = r.SourceQuote, SourcePage = r.SourcePage,
            }).ToList() ??
            [
                new RefundRule { MinHoursBeforeCheckIn = 168, RefundPercent = 100, AppliesTo = RefundAppliesTo.Deposit, Label = vi ? "Hơn 7 ngày trước" : "More than 7 days before" },
                new RefundRule { MinHoursBeforeCheckIn = 0, MaxHoursBeforeCheckIn = 168, RefundPercent = 0, AppliesTo = RefundAppliesTo.Deposit, Label = vi ? "Dưới 7 ngày trước" : "Less than 7 days before" },
            ],
        };
        Db.RefundPolicies.Add(draft);
        await Db.SaveChangesAsync();
        return RefundPolicyDto.From(draft);
    }

    [HttpPut("{id:guid}")]
    public async Task<RefundPolicyDto> Update(Guid id, PolicyUpdateRequest req)
    {
        var p = await Load(id);
        if (p.Status != RefundPolicyStatus.Draft) throw AppException.Conflict("not_draft", "Only drafts can be edited. Create a new draft to make changes.");
        var errors = new Dictionary<string, string[]>();
        for (var i = 0; i < req.Rules.Count; i++)
        {
            var r = req.Rules[i];
            if (r.MinHoursBeforeCheckIn < 0) errors[$"rules[{i}].minHoursBeforeCheckIn"] = ["out_of_range"];
            if (r.MaxHoursBeforeCheckIn is { } mx && mx <= r.MinHoursBeforeCheckIn) errors[$"rules[{i}].maxHoursBeforeCheckIn"] = ["end_before_start"];
            if (r.RefundPercent is < 0 or > 100) errors[$"rules[{i}].refundPercent"] = ["out_of_range"];
        }
        if (req.NoShowRefundPercent is < 0 or > 100) errors["noShowRefundPercent"] = ["out_of_range"];
        if (errors.Count > 0) throw new AppException(400, "validation", "Please check the highlighted rules.", errors);

        // Replace the owned JSON collection wholesale.
        p.Rules = req.Rules.Select(r => new RefundRule
        {
            MinHoursBeforeCheckIn = r.MinHoursBeforeCheckIn, MaxHoursBeforeCheckIn = r.MaxHoursBeforeCheckIn, RefundPercent = r.RefundPercent,
            AppliesTo = r.AppliesTo, Label = string.IsNullOrWhiteSpace(r.Label) ? PolicyExtractionService.LabelFor(r.MinHoursBeforeCheckIn, r.MaxHoursBeforeCheckIn) : r.Label.Trim(),
            SourceQuote = r.SourceQuote, SourcePage = r.SourcePage,
        }).ToList();
        p.NoShowRefundPercent = req.NoShowRefundPercent;
        p.Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
        await Db.SaveChangesAsync();
        return RefundPolicyDto.From(p);
    }

    [HttpPost("{id:guid}/activate")]
    public async Task<RefundPolicyDto> Activate(Guid id)
    {
        var p = await Load(id);
        if (p.Status != RefundPolicyStatus.Draft) throw AppException.Conflict("not_draft", "Only a draft can be activated.");
        var blocking = RefundEngine.Analyze(p.Rules).Where(w => w.Code is "empty" or "invalid_range" or "invalid_percent").ToList();
        if (blocking.Count > 0) throw new AppException(400, "policy_invalid", blocking[0].Message);
        foreach (var old in await Db.RefundPolicies.Where(x => x.Status == RefundPolicyStatus.Active).ToListAsync())
            old.Status = RefundPolicyStatus.Archived;
        p.Status = RefundPolicyStatus.Active;
        p.ApprovedBy = User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value ?? Actor;
        p.ApprovedAt = DateTimeOffset.UtcNow;
        Db.AuditLogs.Add(new AuditLog
        {
            TenantId = TenantId, Actor = Actor, Action = "policy.activated", EntityType = nameof(RefundPolicy), EntityId = p.Id,
            DataJson = System.Text.Json.JsonSerializer.Serialize(new { p.Version, Rules = p.Rules.Count }),
        });
        await Db.SaveChangesAsync();
        return RefundPolicyDto.From(p);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteDraft(Guid id)
    {
        var p = await Load(id);
        if (p.Status != RefundPolicyStatus.Draft) throw AppException.Conflict("not_draft", "Only drafts can be deleted.");
        Db.RefundPolicies.Remove(p);
        await Db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("search")]
    public async Task<PolicySearchResult> Search([FromQuery] string q) => await search.SearchAsync(TenantId, q ?? "");

    private async Task<RefundPolicy> Load(Guid id) =>
        await Db.RefundPolicies.FirstOrDefaultAsync(p => p.Id == id) ?? throw AppException.NotFound("Cancellation rules");
}

public record FaqInput(string Question, string Answer);

[Route("api/app/faqs")]
public class FaqsController : OwnerControllerBase
{
    [HttpGet]
    public async Task<List<FaqDto>> List() =>
        (await Db.FaqItems.OrderBy(f => f.Status).ThenBy(f => f.SortOrder).ToListAsync()).Select(FaqDto.From).ToList();

    [HttpPost]
    public async Task<FaqDto> Create(FaqInput input)
    {
        Validate(input);
        var order = await Db.FaqItems.MaxAsync(f => (int?)f.SortOrder) ?? 0;
        var f = new FaqItem { TenantId = TenantId, Question = input.Question.Trim(), Answer = input.Answer.Trim(), Status = FaqStatus.Approved, SortOrder = order + 1 };
        Db.FaqItems.Add(f);
        await Db.SaveChangesAsync();
        return FaqDto.From(f);
    }

    [HttpPut("{id:guid}")]
    public async Task<FaqDto> Update(Guid id, FaqInput input)
    {
        Validate(input);
        var f = await Load(id);
        f.Question = input.Question.Trim();
        f.Answer = input.Answer.Trim();
        await Db.SaveChangesAsync();
        return FaqDto.From(f);
    }

    [HttpPost("{id:guid}/approve")]
    public async Task<FaqDto> Approve(Guid id)
    {
        var f = await Load(id);
        f.Status = FaqStatus.Approved;
        await Db.SaveChangesAsync();
        return FaqDto.From(f);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        Db.FaqItems.Remove(await Load(id));
        await Db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<FaqItem> Load(Guid id) => await Db.FaqItems.FirstOrDefaultAsync(f => f.Id == id) ?? throw AppException.NotFound("Question");

    private static void Validate(FaqInput i)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(i.Question)) errors["question"] = ["required"];
        if (string.IsNullOrWhiteSpace(i.Answer)) errors["answer"] = ["required"];
        if (errors.Count > 0) throw new AppException(400, "validation", "Please fill in both fields.", errors);
    }
}
