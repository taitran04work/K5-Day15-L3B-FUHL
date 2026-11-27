using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;
using Stayra.Application.Refunds;
using Stayra.Domain;

namespace Stayra.Infrastructure.Policies;

public class ExtractedRule
{
    public int MinHoursBeforeCheckIn { get; set; }
    public int? MaxHoursBeforeCheckIn { get; set; }
    public decimal RefundPercent { get; set; }
    public string AppliesTo { get; set; } = "Deposit";
    public string Label { get; set; } = "";
    public string SourceQuote { get; set; } = "";
    public int SourcePage { get; set; }
}

public class ExtractedFaq
{
    public string Question { get; set; } = "";
    public string Answer { get; set; } = "";
}

public class ExtractedPolicy
{
    public List<ExtractedRule> Rules { get; set; } = [];
    public decimal NoShowRefundPercent { get; set; }
    public string Notes { get; set; } = "";
    public List<string> Ambiguities { get; set; } = [];
    public List<ExtractedFaq> SuggestedFaqs { get; set; } = [];
}

/// <summary>Turns policy text into a Draft RefundPolicy (+ suggested FAQs). Uses Claude structured outputs when configured, otherwise a deterministic heuristic.</summary>
public class PolicyExtractionService(IAppDbContext db, Concierge.TenantAi ai, AuditService audit, ILogger<PolicyExtractionService> log)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.AllowReadingFromString };

    private const string SchemaJson = """
    {
      "type": "object",
      "additionalProperties": false,
      "required": ["rules", "noShowRefundPercent", "notes", "ambiguities", "suggestedFaqs"],
      "properties": {
        "rules": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["minHoursBeforeCheckIn", "maxHoursBeforeCheckIn", "refundPercent", "appliesTo", "label", "sourceQuote", "sourcePage"],
            "properties": {
              "minHoursBeforeCheckIn": { "type": "integer" },
              "maxHoursBeforeCheckIn": { "type": ["integer", "null"] },
              "refundPercent": { "type": "number" },
              "appliesTo": { "type": "string", "enum": ["Deposit", "Total"] },
              "label": { "type": "string" },
              "sourceQuote": { "type": "string" },
              "sourcePage": { "type": "integer" }
            }
          }
        },
        "noShowRefundPercent": { "type": "number" },
        "notes": { "type": "string" },
        "ambiguities": { "type": "array", "items": { "type": "string" } },
        "suggestedFaqs": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["question", "answer"],
            "properties": { "question": { "type": "string" }, "answer": { "type": "string" } }
          }
        }
      }
    }
    """;

    private static string BuildInstructions(string language)
    {
        var vi = GuestText.IsVietnamese(language);
        var outLang = vi ? "Vietnamese" : "English";
        var labelExample = vi ? "\"Hơn 7 ngày trước giờ nhận phòng\"" : "\"More than 7 days before\"";
        var ambExample = vi ? "\"Chưa nêu rõ mốc 24–72 giờ trước giờ nhận phòng\"" : "\"24–72 hours is not mentioned\"";
        return $$"""
        You extract a homestay's cancellation/refund rules from its policy document into JSON.
        Output language: Write label, notes, ambiguities, and every suggestedFaqs question and answer in natural {{outLang}}, regardless of the source document's language.
        Rules:
        - Each rule is a window measured in hours before the check-in time: minHoursBeforeCheckIn (inclusive) to maxHoursBeforeCheckIn (exclusive, null = no upper limit). Convert days to hours (1 day = 24 hours).
        - refundPercent is 0-100. appliesTo is "Deposit" when the text refunds the deposit, "Total" when it refunds the total/booking amount.
        - label is a short plain-{{outLang}} description such as {{labelExample}}.
        - sourceQuote must be the exact sentence copied verbatim from the document (do not translate sourceQuote); sourcePage is its page number (pages are marked as [Page N]).
        - noShowRefundPercent: refund for no-shows (0 if not refundable or not mentioned).
        - notes: other refund-relevant conditions in one or two {{outLang}} sentences (empty string if none).
        - ambiguities: anything unclear, contradictory, or windows not covered, written in {{outLang}} (e.g. {{ambExample}}).
        - suggestedFaqs: 3-6 short guest questions with answers in {{outLang}}, taken only from the document (house rules, breakfast, parking, check-in times...).
        Never invent rules that are not in the text.
        """;
    }

    public async Task<RefundPolicy?> ExtractAndSaveDraftAsync(PolicyDocument doc, IReadOnlyList<PageText> pages, string? language = null, CancellationToken ct = default)
    {
        // the homestay's own key + model; no key -> the heuristic extractor
        var tenant = await db.Tenants.IgnoreQueryFilters().FirstAsync(t => t.Id == doc.TenantId, ct);
        var lang = GuestText.IsVietnamese(language ?? tenant.DefaultLanguage) ? "vi" : "en";
        var client = ai.Client(tenant);
        var aiUsed = client is not null;
        ExtractedPolicy extracted;
        if (client is not null)
        {
            try { extracted = await ExtractWithClaudeAsync(client, ai.Model(tenant), pages, lang, ct); }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Claude extraction failed for {Doc}; using heuristic extractor", doc.Id);
                extracted = Heuristic(pages, lang);
                extracted.Ambiguities.Insert(0, lang == "vi"
                    ? "Bộ trích xuất AI tạm thời không khả dụng nên hệ thống đọc quy tắc theo cách đơn giản. Vui lòng kiểm tra kỹ lại."
                    : "The AI extractor was unavailable, so these rules were read with a simpler method. Please double-check them.");
            }
        }
        else extracted = Heuristic(pages, lang);

        var rules = Validate(extracted, lang);
        await db.RefundPolicies
            .Where(p => p.TenantId == doc.TenantId && p.SourceDocumentId == doc.Id && p.Status == RefundPolicyStatus.Draft)
            .ExecuteDeleteAsync(ct);
        await db.FaqItems
            .Where(f => f.TenantId == doc.TenantId && f.SourceDocumentId == doc.Id && f.Status == FaqStatus.Suggested)
            .ExecuteDeleteAsync(ct);

        RefundPolicy? policy = null;
        if (rules.Count > 0)
        {
            var version = (await db.RefundPolicies.Where(p => p.TenantId == doc.TenantId).MaxAsync(p => (int?)p.Version) ?? 0) + 1;
            policy = new RefundPolicy
            {
                TenantId = doc.TenantId,
                Status = RefundPolicyStatus.Draft,
                Version = version,
                SourceDocumentId = doc.Id,
                Rules = rules,
                NoShowRefundPercent = Math.Clamp(extracted.NoShowRefundPercent, 0, 100),
                Notes = string.IsNullOrWhiteSpace(extracted.Notes) ? null : extracted.Notes.Trim(),
                Ambiguities = extracted.Ambiguities.Where(a => !string.IsNullOrWhiteSpace(a)).Distinct().ToList(),
            };
            foreach (var w in RefundEngine.Analyze(rules, lang).Where(w => w.Code is "gap" or "overlap"))
                if (!policy.Ambiguities.Contains(w.Message)) policy.Ambiguities.Add(w.Message);
            db.RefundPolicies.Add(policy);
        }

        var existing = (await db.FaqItems.Where(f => f.TenantId == doc.TenantId).Select(f => f.Question).ToListAsync(ct))
            .Select(q => q.ToLowerInvariant()).ToHashSet();
        var order = await db.FaqItems.Where(f => f.TenantId == doc.TenantId).MaxAsync(f => (int?)f.SortOrder, ct) ?? 0;
        foreach (var f in extracted.SuggestedFaqs.Where(f => f.Question.Length > 3 && f.Answer.Length > 3).Take(8))
        {
            if (!existing.Add(f.Question.Trim().ToLowerInvariant())) continue;
            db.FaqItems.Add(new FaqItem
            {
                TenantId = doc.TenantId, Question = f.Question.Trim(), Answer = f.Answer.Trim(), Status = FaqStatus.Suggested,
                SourceDocumentId = doc.Id, SortOrder = ++order,
            });
        }
        audit.Log(doc.TenantId, Actors.System, "policy.extracted", policy is null ? nameof(PolicyDocument) : nameof(RefundPolicy), policy?.Id ?? doc.Id, new { doc.FileName, Rules = rules.Count, Ai = aiUsed, Language = lang });
        await db.SaveChangesAsync(ct);
        return policy;
    }

    private async Task<ExtractedPolicy> ExtractWithClaudeAsync(AnthropicClient client, string model, IReadOnlyList<PageText> pages, string language, CancellationToken ct)
    {
        var schema = JsonDocument.Parse(SchemaJson).RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());
        var text = string.Join("\n\n", pages.Select(p => $"[Page {p.Page}]\n{p.Text}"));
        var resp = await client.Messages.Create(new MessageCreateParams
        {
            Model = model,
            MaxTokens = 16000,
            System = BuildInstructions(language),
            Messages = [new UserMessageParam { Content = $"<policy_document>\n{text}\n</policy_document>" }],
            OutputConfig = new OutputConfig { Effort = Effort.Medium, Format = new JsonOutputFormat { Schema = schema } },
        }, ct);
        if (resp.StopReason == "refusal") throw new InvalidOperationException("Extraction refused");
        var json = string.Concat(resp.Content.Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text));
        return JsonSerializer.Deserialize<ExtractedPolicy>(json, Json) ?? throw new InvalidOperationException("Empty extraction");
    }

    /// <summary>Server-side validation of extracted rules: clamps values, drops malformed rules, normalizes labels.</summary>
    public static List<RefundRule> Validate(ExtractedPolicy p, string language = "en")
    {
        var rules = new List<RefundRule>();
        foreach (var r in p.Rules)
        {
            if (r.MinHoursBeforeCheckIn < 0 || r.MinHoursBeforeCheckIn > 24 * 365) continue;
            if (r.MaxHoursBeforeCheckIn is { } mx && mx <= r.MinHoursBeforeCheckIn) continue;
            rules.Add(new RefundRule
            {
                MinHoursBeforeCheckIn = r.MinHoursBeforeCheckIn,
                MaxHoursBeforeCheckIn = r.MaxHoursBeforeCheckIn,
                RefundPercent = Math.Clamp(Math.Round(r.RefundPercent, 1), 0, 100),
                AppliesTo = string.Equals(r.AppliesTo, "Total", StringComparison.OrdinalIgnoreCase) ? RefundAppliesTo.Total : RefundAppliesTo.Deposit,
                Label = string.IsNullOrWhiteSpace(r.Label) ? LabelFor(r.MinHoursBeforeCheckIn, r.MaxHoursBeforeCheckIn, language) : r.Label.Trim(),
                SourceQuote = string.IsNullOrWhiteSpace(r.SourceQuote) ? null : r.SourceQuote.Trim(),
                SourcePage = r.SourcePage > 0 ? r.SourcePage : null,
            });
        }
        return rules.OrderByDescending(r => r.MinHoursBeforeCheckIn).ToList();
    }

    public static string LabelFor(int min, int? max, string language = "en")
    {
        if (GuestText.IsVietnamese(language))
        {
            static string HV(int h) => h >= 168 && h % 24 == 0 ? $"{h / 24} ngày" : $"{h} giờ";
            if (max is null) return $"Hơn {HV(min)} trước";
            if (min == 0) return $"Dưới {HV(max.Value)} trước";
            if (min % 24 == 0 && max % 24 == 0 && min >= 24) return $"Từ {min / 24} đến {max / 24} ngày trước";
            return $"Từ {HV(min)} đến {HV(max.Value)} trước";
        }
        static string H(int h) => h >= 168 && h % 24 == 0 ? $"{h / 24} days" : $"{h} hours";
        if (max is null) return $"More than {H(min)} before";
        if (min == 0) return $"Less than {H(max.Value)} before";
        if (min % 24 == 0 && max % 24 == 0 && min >= 24) return $"{min / 24} to {max / 24} days before";
        return $"{H(min)} to {H(max.Value)} before";
    }

    // ---------------- Heuristic extractor (no API key) ----------------

    private static readonly Regex Sentence = new(@"(?<=[.!?])\s+", RegexOptions.Compiled);
    private static readonly Regex Num = new(@"(\d+(?:[.,]\d+)?)\s*(days?|hours?|ngày|giờ|h\b)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Pct = new(@"(\d{1,3}(?:[.,]\d+)?)\s*%", RegexOptions.Compiled);

    public static ExtractedPolicy Heuristic(IReadOnlyList<PageText> pages, string language = "en")
    {
        var vi = GuestText.IsVietnamese(language);
        var result = new ExtractedPolicy();
        var sentences = pages.SelectMany(p => SplitSentences(p.Text).Select(s => (p.Page, Text: s))).ToList();

        foreach (var (page, s) in sentences)
        {
            var lower = s.ToLowerInvariant();
            var isCancel = lower.Contains("cancel") || lower.Contains("hủy") || lower.Contains("huỷ");
            if (lower.Contains("no-show") || lower.Contains("no show") || lower.Contains("không đến"))
            {
                result.NoShowRefundPercent = PercentOf(lower) ?? 0;
                continue;
            }
            if (!isCancel) continue;
            var percent = PercentOf(lower);
            if (percent is null) continue;

            var hours = Num.Matches(lower).Select(m => ToHours(m)).ToList();
            // Prefer explicit hour values in parentheses, e.g. "7 days (168 hours)".
            var explicitHours = Num.Matches(lower).Where(m => m.Groups[2].Value.StartsWith("hour") || m.Groups[2].Value.StartsWith("giờ")).Select(ToHours).ToList();
            int? min = null, max = null;
            if (Regex.IsMatch(lower, @"\bbetween\b|\btừ\b.*\bđến\b|\bto\b"))
            {
                var vals = explicitHours.Count >= 2 ? explicitHours : hours;
                // "between 3 and 7 days (72 to 168 hours)" -> numbers without units count too.
                var bare = Regex.Match(lower, @"(?:between|từ)\s+(\d+)\s+(?:and|đến|-|–)\s+(\d+)\s*(days?|hours?|ngày|giờ|h\b)");
                if (explicitHours.Count < 2 && bare.Success)
                {
                    var u = bare.Groups[3].Value.ToLowerInvariant();
                    var mult = u.StartsWith("day") || u == "ngày" ? 24 : 1;
                    vals = [int.Parse(bare.Groups[1].Value) * mult, int.Parse(bare.Groups[2].Value) * mult];
                }
                var paren = Regex.Match(lower, @"\((\d+)\s*(?:to|-|–)\s*(\d+)\s*(?:hours?|giờ)\)");
                if (paren.Success) vals = [int.Parse(paren.Groups[1].Value), int.Parse(paren.Groups[2].Value)];
                if (vals.Count >= 2) { min = Math.Min(vals[0], vals[1]); max = Math.Max(vals[0], vals[1]); }
            }
            if (min is null && Regex.IsMatch(lower, @"less than|within|under|fewer than|dưới|ít hơn|trong vòng|muộn hơn"))
            {
                var v = explicitHours.FirstOrDefault(h => h > 0);
                if (v == 0) v = hours.FirstOrDefault();
                if (v > 0) { min = 0; max = v; }
            }
            if (min is null && Regex.IsMatch(lower, @"more than|over|at least|earlier than|trước hơn|trước từ|từ\s+\d+.*trở lên|trên|hơn|ít nhất|tối thiểu|trước\s+\d+"))
            {
                var v = explicitHours.FirstOrDefault(h => h > 0);
                if (v == 0) v = hours.FirstOrDefault();
                if (v > 0) { min = v; max = null; }
            }
            if (min is null) continue;

            var appliesTo = lower.Contains("deposit") || lower.Contains("cọc") ? "Deposit"
                : lower.Contains("total") || lower.Contains("booking amount") || lower.Contains("tổng") ? "Total" : "Deposit";
            result.Rules.Add(new ExtractedRule
            {
                MinHoursBeforeCheckIn = min.Value, MaxHoursBeforeCheckIn = max, RefundPercent = percent.Value, AppliesTo = appliesTo,
                Label = LabelFor(min.Value, max, language), SourceQuote = s, SourcePage = page,
            });
        }

        var refundNote = sentences.FirstOrDefault(s => Regex.IsMatch(s.Text, @"refunds? (are|is) (returned|sent|processed)|tiền hoàn.*(xử lý|chuyển|hoàn lại|ngày làm việc)", RegexOptions.IgnoreCase));
        if (refundNote.Text != null) result.Notes = refundNote.Text;
        if (result.Rules.Count == 0)
            result.Ambiguities.Add(vi
                ? "Không tìm thấy khung thời gian hủy rõ ràng trong tài liệu. Vui lòng thêm quy tắc thủ công."
                : "We couldn't find clear cancellation windows in this document. Please add the rules manually.");
        if (!sentences.Any(s => s.Text.Contains("no-show", StringComparison.OrdinalIgnoreCase) || s.Text.Contains("no show", StringComparison.OrdinalIgnoreCase) || s.Text.Contains("không đến", StringComparison.OrdinalIgnoreCase)))
            result.Ambiguities.Add(vi
                ? "Tài liệu chưa nêu rõ trường hợp khách không đến (no-show); hệ thống tạm mặc định không hoàn tiền."
                : "The document doesn't say what happens with no-shows; we assumed no refund.");

        var faqKeys = new (string Pattern, string QuestionEn, string QuestionVi)[]
        {
            (@"check-in is|check-in from|check in from|nhận phòng.*từ|giờ nhận phòng|giờ check-in", "What are the check-in and check-out times?", "Giờ nhận phòng và trả phòng là mấy giờ?"),
            (@"breakfast|bữa sáng|ăn sáng", "Is breakfast included?", "Có bao gồm bữa sáng không?"),
            (@"parking|đỗ xe|gửi xe|bãi xe", "Is there parking?", "Chỗ nghỉ có chỗ đỗ xe không?"),
            (@"\bpets?\b|thú cưng|vật nuôi", "Are pets allowed?", "Có được mang theo thú cưng không?"),
            (@"smok|hút thuốc", "Can I smoke at the property?", "Có được hút thuốc tại chỗ nghỉ không?"),
            (@"quiet hours|giờ yên tĩnh|giữ yên lặng", "Are there quiet hours?", "Chỗ nghỉ có quy định giờ yên tĩnh không?"),
            (@"wi-?fi|mật khẩu mạng", "Is there Wi-Fi?", "Chỗ nghỉ có Wi-Fi không?"),
            (@"early check-in|late check-out|nhận phòng sớm|trả phòng muộn", "Can I check in early or check out late?", "Có thể nhận phòng sớm hoặc trả phòng muộn không?"),
        };
        foreach (var (pattern, qEn, qVi) in faqKeys)
        {
            var hit = sentences.FirstOrDefault(s =>
            {
                var l = s.Text.ToLowerInvariant();
                return Regex.IsMatch(s.Text, pattern, RegexOptions.IgnoreCase) && !l.Contains("cancel") && !l.Contains("hủy") && !l.Contains("huỷ");
            });
            if (hit.Text != null) result.SuggestedFaqs.Add(new ExtractedFaq { Question = vi ? qVi : qEn, Answer = hit.Text });
        }
        return result;
    }

    private static readonly Regex Heading = new(@"^\d+[.)]\s+\S.{0,70}$", RegexOptions.Compiled);

    /// <summary>Splits page text into sentences, keeping numbered section headings out of the sentences that follow them.</summary>
    public static List<string> SplitSentences(string pageText)
    {
        var result = new List<string>();
        var buffer = new System.Text.StringBuilder();
        void Flush()
        {
            result.AddRange(Sentence.Split(buffer.ToString()).Select(x => x.Trim()).Where(x => x.Length > 0));
            buffer.Clear();
        }
        foreach (var raw in pageText.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            if (Heading.IsMatch(line) && !Regex.IsMatch(line, @"[.!?,;:]$"))
            {
                Flush(); // headings are context, not content
                continue;
            }
            buffer.Append(line).Append(' ');
        }
        Flush();
        return result;
    }

    private static decimal? PercentOf(string lower)
    {
        var m = Pct.Match(lower);
        if (m.Success) return decimal.Parse(m.Groups[1].Value.Replace(',', '.'), CultureInfo.InvariantCulture);
        if (Regex.IsMatch(lower, @"full refund|fully refund|refunded in full|hoàn toàn bộ|hoàn 100")) return 100;
        if (Regex.IsMatch(lower, @"not refundable|non-refundable|no refund|not be refunded|are not refunded|không hoàn")) return 0;
        if (Regex.IsMatch(lower, @"half")) return 50;
        return null;
    }

    private static int ToHours(Match m)
    {
        var v = decimal.Parse(m.Groups[1].Value.Replace(',', '.'), CultureInfo.InvariantCulture);
        var unit = m.Groups[2].Value.ToLowerInvariant();
        return (int)(unit.StartsWith("day") || unit == "ngày" ? v * 24 : v);
    }
}
