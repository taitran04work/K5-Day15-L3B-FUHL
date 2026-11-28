using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Messaging;
using DomainMessage = Stayra.Domain.Message;

namespace Stayra.Infrastructure.Concierge;

/// <summary>
/// One concierge for every channel. Persists the guest message, runs Claude with server-side tools using the homestay's
/// own API key (or the offline assistant when it has none), persists tool calls, and delivers the reply through IGuestMessenger.
/// </summary>
public partial class ConciergeService(
    IAppDbContext db,
    ITenantContext tenantContext,
    IGuestMessenger messenger,
    IRealtimeNotifier realtime,
    ConciergeTools tools,
    OfflineConcierge offline,
    TenantAi ai,
    IConfiguration config,
    TimeProvider clock,
    ILogger<ConciergeService> log)
{
    public const int MaxInputChars = 2000;
    private const int HistoryLimit = 30;

    /// <summary>Handles one inbound guest message synchronously. Returns the new guest-visible messages (guest + system + bot).</summary>
    public async Task<List<DomainMessage>> HandleGuestMessageAsync(Guid conversationId, string text, CancellationToken ct = default)
    {
        var (guestMsg, shouldRunBot) = await RecordGuestMessageAsync(conversationId, text, null, ct);
        if (shouldRunBot)
            await RunAssistantReplyAsync(conversationId, ct);

        return await db.Messages.Where(m => m.ConversationId == conversationId && m.CreatedAt >= guestMsg.CreatedAt && m.Role != MessageRole.Tool)
            .OrderBy(m => m.CreatedAt).ToListAsync(ct);
    }

    /// <summary>Persists an inbound guest message immediately and returns whether the AI assistant should reply.</summary>
    public async Task<(DomainMessage GuestMessage, bool ShouldRunBot)> RecordGuestMessageAsync(
        Guid conversationId,
        string text,
        string? externalMessageId = null,
        CancellationToken ct = default)
    {
        var conv = await db.Conversations.IgnoreQueryFilters().FirstAsync(c => c.Id == conversationId, ct);
        tenantContext.Set(conv.TenantId);
        var tenant = await db.Tenants.FirstAsync(t => t.Id == conv.TenantId, ct);

        text = (text ?? "").Trim();
        if (text.Length > MaxInputChars) text = text[..MaxInputChars];
        if (text.Length == 0) throw AppException.BadRequest("empty_message", "Type a message first.");

        var lang = DetectLanguage(text, conv.Language);
        conv.Language = lang;
        conv.UnreadCount++;
        var reopenedFromClosed = conv.Status == ConversationStatus.Closed;
        if (reopenedFromClosed) conv.Status = ConversationStatus.Bot;
        await db.SaveChangesAsync(ct);
        if (reopenedFromClosed) await realtime.ConversationStatusChanged(conv.Id, conv.Status.ToString());

        var guestMsg = await messenger.SendAsync(conv.Id, MessageRole.Guest, text, null, conv.GuestName, ct);
        if (!string.IsNullOrWhiteSpace(externalMessageId))
        {
            var tracked = await db.Messages.FirstOrDefaultAsync(m => m.Id == guestMsg.Id, ct);
            if (tracked != null)
            {
                tracked.ExternalMessageId = externalMessageId;
                await db.SaveChangesAsync(ct);
            }
        }

        return (guestMsg, tenant.BotEnabled && conv.Status == ConversationStatus.Bot);
    }

    /// <summary>Runs the AI assistant for the conversation using the latest persisted history.</summary>
    public async Task RunAssistantReplyAsync(Guid conversationId, CancellationToken ct = default)
    {
        var conv = await db.Conversations.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.Id == conversationId, ct);
        if (conv == null) return;
        tenantContext.Set(conv.TenantId);
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Id == conv.TenantId, ct);
        if (tenant == null || !tenant.BotEnabled || conv.Status != ConversationStatus.Bot) return;

        var lastGuestText = await db.Messages
            .Where(m => m.ConversationId == conv.Id && m.Role == MessageRole.Guest)
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => m.Content)
            .FirstOrDefaultAsync(ct) ?? "";

        await realtime.Typing(conv.Id, true);
        try
        {
            var ctx = new ToolContext(tenant, conv);
            string reply;
            int inTok = 0, outTok = 0;
            var client = ai.Client(tenant);
            if (client is not null)
            {
                try { (reply, inTok, outTok) = await RunClaudeAsync(client, ctx, ct); }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogError(ex, "Claude call failed for conversation {Id}; falling back to offline assistant", conv.Id);
                    reply = await offline.ReplyAsync(ctx, lastGuestText, ct);
                }
            }
            else reply = await offline.ReplyAsync(ctx, lastGuestText, ct);

            if (!string.IsNullOrWhiteSpace(reply) || ctx.Cards.Count > 0)
            {
                var botMsg = await messenger.SendAsync(conv.Id, MessageRole.Bot, reply.Trim(), ctx.Cards, null, ct);
                if (inTok + outTok > 0)
                {
                    var tracked = await db.Messages.FirstAsync(m => m.Id == botMsg.Id, ct);
                    tracked.InputTokens = inTok;
                    tracked.OutputTokens = outTok;
                }
            }
            await db.SaveChangesAsync(ct);
        }
        finally
        {
            await realtime.Typing(conv.Id, false);
        }
    }

    /// <summary>Starts a conversation with a greeting in the right language.</summary>
    public async Task<DomainMessage> GreetAsync(Conversation conv, Tenant tenant, CancellationToken ct = default)
    {
        var text = conv.Language == "vi"
            ? $"Xin chào! Mình là trợ lý của {tenant.Name}. Mình có thể giúp bạn tìm phòng, xem giá và lịch trống, đặt phòng hoặc quản lý đặt phòng của bạn."
            : $"Hi! I'm the concierge at {tenant.Name}. I can help you find a room, check prices and availability, book, or manage an existing booking.";
        return await messenger.SendAsync(conv.Id, MessageRole.Bot, text, null, null, ct);
    }

    // ---------------- Claude ----------------

    private async Task<(string Reply, int InputTokens, int OutputTokens)> RunClaudeAsync(AnthropicClient client, ToolContext ctx, CancellationToken ct)
    {
        var model = ai.Model(ctx.Tenant);
        var maxIterations = Math.Clamp(config.GetValue("Anthropic:MaxIterations", 6), 1, 10);
        var system = BuildSystemPrompt(ctx.Tenant, ctx.Conversation);
        var toolUnions = ConciergeTools.Definitions.Select(d => (ToolUnion)new Tool
        {
            Name = d.Name,
            Description = d.Description,
            InputSchema = ToSchema(d.SchemaJson),
        }).ToList();

        var messages = await BuildHistoryAsync(ctx.Conversation, ct);
        int inTok = 0, outTok = 0;
        var finalText = new StringBuilder();

        for (var iteration = 0; iteration < maxIterations; iteration++)
        {
            var resp = await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 4096,
                System = new List<TextBlockParam> { new() { Text = system, CacheControl = new CacheControlEphemeral() } },
                Tools = toolUnions,
                Messages = messages,
                OutputConfig = new OutputConfig { Effort = Effort.Low },
            }, ct);
            inTok += (int)resp.Usage.InputTokens + (int)(resp.Usage.CacheReadInputTokens ?? 0) + (int)(resp.Usage.CacheCreationInputTokens ?? 0);
            outTok += (int)resp.Usage.OutputTokens;

            if (resp.StopReason == "refusal")
            {
                await tools.Handoff(ctx, "The assistant couldn't help with this request", ct);
                return (ctx.Conversation.Language == "vi" ? "Mình sẽ chuyển cho chủ nhà hỗ trợ bạn ngay nhé." : "Let me pass this to the host — they'll reply here shortly.", inTok, outTok);
            }

            var assistantContent = new List<ContentBlockParam>();
            var toolResults = new List<ContentBlockParam>();
            var turnText = new StringBuilder();
            foreach (var block in resp.Content)
            {
                if (block.TryPickText(out TextBlock? t))
                {
                    assistantContent.Add(new TextBlockParam { Text = t.Text });
                    turnText.Append(t.Text);
                }
                else if (block.TryPickThinking(out ThinkingBlock? th))
                    assistantContent.Add(new ThinkingBlockParam { Thinking = th.Thinking, Signature = th.Signature });
                else if (block.TryPickRedactedThinking(out RedactedThinkingBlock? rt))
                    assistantContent.Add(new RedactedThinkingBlockParam { Data = rt.Data });
                else if (block.TryPickToolUse(out ToolUseBlock? tu))
                {
                    assistantContent.Add(new ToolUseBlockParam { ID = tu.ID, Name = tu.Name, Input = tu.Input });
                    var input = JsonSerializer.SerializeToElement(tu.Input);
                    var result = await tools.ExecuteAsync(ctx, tu.Name, input, ct);
                    await PersistToolCallAsync(ctx, tu.Name, input, result, ct);
                    toolResults.Add(new ToolResultBlockParam { ToolUseID = tu.ID, Content = result.Json, IsError = result.IsError });
                }
            }

            if (resp.StopReason == "tool_use" && toolResults.Count > 0)
            {
                messages.Add(new AssistantMessageParam { Content = assistantContent });
                messages.Add(new UserMessageParam { Content = toolResults });
                if (turnText.Length > 0) finalText.Clear(); // interim text before tool calls is replaced by the final answer
                continue;
            }

            finalText.Append(turnText);
            if (resp.StopReason == "max_tokens" && finalText.Length == 0)
                finalText.Append(ctx.Conversation.Language == "vi" ? "Xin lỗi, bạn có thể hỏi ngắn gọn hơn được không?" : "Sorry, could you ask that a bit more briefly?");
            break;
        }

        if (finalText.Length == 0)
            finalText.Append(ctx.Conversation.Language == "vi"
                ? "Mình cần thêm chút thời gian — chủ nhà sẽ hỗ trợ bạn tiếp nhé."
                : "I need a little more time on this — the host will follow up with you here.");
        return (finalText.ToString(), inTok, outTok);
    }

    private async Task<List<MessageParam>> BuildHistoryAsync(Conversation conv, CancellationToken ct)
    {
        var recent = await db.Messages.Where(m => m.ConversationId == conv.Id && m.Role != MessageRole.Tool)
            .OrderByDescending(m => m.CreatedAt).Take(HistoryLimit).ToListAsync(ct);
        recent.Reverse();

        // Collapse into strictly alternating user/assistant turns, starting with the user.
        var turns = new List<(bool User, StringBuilder Text)>();
        foreach (var m in recent)
        {
            var isUser = m.Role is MessageRole.Guest or MessageRole.System;
            var text = m.Role switch
            {
                MessageRole.System => $"[Booking system update, not written by the guest: {m.Content}]",
                MessageRole.Owner => $"[Host replied: {m.Content}]",
                _ => m.Content,
            };
            if (turns.Count > 0 && turns[^1].User == isUser) turns[^1].Text.Append("\n\n").Append(text);
            else turns.Add((isUser, new StringBuilder(text)));
        }
        while (turns.Count > 0 && !turns[0].User) turns.RemoveAt(0);
        return turns.Select(t => t.User
            ? (MessageParam)new UserMessageParam { Content = t.Text.ToString() }
            : new AssistantMessageParam { Content = t.Text.ToString() }).ToList();
    }

    private async Task PersistToolCallAsync(ToolContext ctx, string name, JsonElement input, ToolResult result, CancellationToken ct)
    {
        var msg = new DomainMessage
        {
            ConversationId = ctx.Conversation.Id,
            Role = MessageRole.Tool,
            Content = result.Summary,
            ToolName = name,
            ToolInputJson = input.GetRawText(),
            ToolOutputJson = result.Json.Length > 20000 ? result.Json[..20000] : result.Json,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync(ct);
        await realtime.MessageAdded(ctx.Tenant.Id, ctx.Conversation.Id, MessageDto.From(msg));
    }

    private static string? _template;

    public string BuildSystemPrompt(Tenant t, Conversation conv)
    {
        _template ??= LoadTemplate();
        var now = TenantTime.Now(t, clock);
        return _template
            .Replace("{{TenantName}}", t.Name)
            .Replace("{{Channel}}", conv.Channel == ChannelType.Zalo ? "Zalo" : "the website chat")
            .Replace("{{Persona}}", string.IsNullOrWhiteSpace(t.BotPersona) ? "Warm, helpful and professional." : t.BotPersona)
            .Replace("{{Language}}", conv.Language)
            .Replace("{{CheckInTime}}", t.CheckInTime.ToString("HH:mm"))
            .Replace("{{CheckOutTime}}", t.CheckOutTime.ToString("HH:mm"))
            .Replace("{{OpeningTime}}", t.OpeningTime.ToString("HH:mm"))
            .Replace("{{ClosingTime}}", t.ClosingTime.ToString("HH:mm"))
            .Replace("{{DepositPercent}}", t.DepositPercent.ToString())
            .Replace("{{HoldMinutes}}", t.HoldMinutes.ToString())
            .Replace("{{Today}}", now.ToString("yyyy-MM-dd"))
            .Replace("{{Weekday}}", now.DayOfWeek.ToString())
            .Replace("{{Now}}", now.ToString("HH:mm"))
            .Replace("{{TimeZone}}", t.TimeZone);
    }

    private static string LoadTemplate()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Prompts", "concierge.md");
        return File.Exists(path) ? File.ReadAllText(path) : "You are the concierge of {{TenantName}}. Never invent prices or policies; always use tools.";
    }

    private static InputSchema ToSchema(string json)
    {
        var root = JsonDocument.Parse(json).RootElement;
        return new InputSchema
        {
            Properties = root.TryGetProperty("properties", out var p)
                ? p.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.Clone())
                : new Dictionary<string, JsonElement>(),
            Required = root.TryGetProperty("required", out var r) ? r.EnumerateArray().Select(x => x.GetString()!).ToList() : [],
        };
    }

    // ---------------- Language ----------------

    public static string DetectLanguage(string text, string current)
    {
        if (VietnameseChars().IsMatch(text)) return "vi";
        var lower = $" {text.ToLowerInvariant()} ";
        string[] viWords = [" chào ", " xin ", " phòng ", " giá ", " đặt ", " không ", " cho mình ", " bạn ", " ạ ", " nhé ", " cảm ơn ", " khong ", " phong ", " gia ", " dat ", " chao ", " ban ", " minh "];
        string[] enWords = [" hi ", " hello ", " room ", " price ", " book ", " the ", " please ", " thanks ", " is ", " do you ", " can i ", " how ", " what "];
        var vi = viWords.Count(lower.Contains);
        var en = enWords.Count(lower.Contains);
        if (vi > en) return "vi";
        if (en > vi) return "en";
        return string.IsNullOrEmpty(current) ? "en" : current;
    }

    [GeneratedRegex("[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]", RegexOptions.IgnoreCase)]
    private static partial Regex VietnameseChars();
}
