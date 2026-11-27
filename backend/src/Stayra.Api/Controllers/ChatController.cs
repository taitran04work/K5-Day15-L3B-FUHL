using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Concierge;
using Stayra.Infrastructure.Messaging;
using Stayra.Infrastructure.Persistence;

namespace Stayra.Api.Controllers;

public record StartChatRequest(string? Language, string? VisitorToken);
public record SendChatRequest(string Token, string Text);

/// <summary>Public chat widget API.</summary>
[ApiController]
[Route("api/public/{slug}/chat")]
public class ChatController(StayraDbContext db, ConciergeService concierge) : PublicControllerBase
{
    [HttpPost("conversations")]
    [EnableRateLimiting("public")]
    public async Task<object> Start(string slug, StartChatRequest req)
    {
        var tenant = CurrentTenant;
        Conversation? conv = null;
        if (!string.IsNullOrEmpty(req.VisitorToken))
            conv = await db.Conversations.Where(c => c.VisitorToken == req.VisitorToken && c.Channel == ChannelType.WebWidget)
                .OrderByDescending(c => c.LastMessageAt).FirstOrDefaultAsync();
        if (conv == null)
        {
            conv = new Conversation
            {
                TenantId = tenant.Id, Channel = ChannelType.WebWidget,
                VisitorToken = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)),
                Language = tenant.DefaultLanguage,
            };
            db.Conversations.Add(conv);
            await db.SaveChangesAsync();
            await concierge.GreetAsync(conv, tenant);
        }
        else if (conv.Language != tenant.DefaultLanguage)
        {
            conv.Language = tenant.DefaultLanguage;
            await db.SaveChangesAsync();
        }
        return new { conversationId = conv.Id, visitorToken = conv.VisitorToken, language = conv.Language, status = conv.Status, messages = await Visible(conv.Id) };
    }

    [HttpGet("conversations/{conversationId:guid}/messages")]
    public async Task<List<object>> Messages(string slug, Guid conversationId, [FromQuery] string token)
    {
        await Authorize(conversationId, token);
        return await Visible(conversationId);
    }

    [HttpPost("conversations/{conversationId:guid}/messages")]
    [EnableRateLimiting("chat")]
    public async Task<object> Send(string slug, Guid conversationId, SendChatRequest req)
    {
        await Authorize(conversationId, req.Token);
        var text = (req.Text ?? "").Trim();
        if (text.Length == 0) throw AppException.BadRequest("empty_message", "Type a message first.");
        if (text.Length > ConciergeService.MaxInputChars) throw AppException.BadRequest("message_too_long", $"Messages can be up to {ConciergeService.MaxInputChars} characters.");
        var messages = await concierge.HandleGuestMessageAsync(conversationId, text);
        var conv = await db.Conversations.FirstAsync(c => c.Id == conversationId);
        return new { status = conv.Status, language = conv.Language, messages = messages.Select(MessageDto.From) };
    }

    [HttpPost("conversations/{conversationId:guid}/language")]
    public async Task<IActionResult> Language(string slug, Guid conversationId, [FromBody] LanguageRequest req)
    {
        var conv = await Authorize(conversationId, req.Token);
        conv.Language = CurrentTenant.DefaultLanguage;
        await db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<Conversation> Authorize(Guid conversationId, string? token)
    {
        var conv = await db.Conversations.FirstOrDefaultAsync(c => c.Id == conversationId);
        if (conv == null || string.IsNullOrEmpty(token) || conv.VisitorToken == null
            || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(conv.VisitorToken), Encoding.UTF8.GetBytes(token)))
            throw new AppException(404, "conversation_not_found", "This conversation has ended. Start a new one.");
        return conv;
    }

    private async Task<List<object>> Visible(Guid conversationId) =>
        (await db.Messages.Where(m => m.ConversationId == conversationId && m.Role != MessageRole.Tool).OrderBy(m => m.CreatedAt).ToListAsync())
            .Select(MessageDto.From).ToList();
}

public record LanguageRequest(string Token, string Language);

public record OwnerReplyRequest(string Text);

[Route("api/app/inbox")]
public class InboxController(IGuestMessenger messenger, IRealtimeNotifier realtime) : OwnerControllerBase
{
    [HttpGet("conversations")]
    public async Task<object> List([FromQuery] string? status, [FromQuery] string? channel, [FromQuery] string? q)
    {
        var query = Db.Conversations.AsQueryable();
        if (status == "attention") query = query.Where(c => c.NeedsAttention);
        else if (!string.IsNullOrEmpty(status) && Enum.TryParse<ConversationStatus>(status, true, out var st)) query = query.Where(c => c.Status == st);
        if (!string.IsNullOrEmpty(channel) && Enum.TryParse<ChannelType>(channel, true, out var ch)) query = query.Where(c => c.Channel == ch);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower();
            query = query.Where(c => (c.GuestName != null && c.GuestName.ToLower().Contains(term)) || (c.GuestPhone != null && c.GuestPhone.Contains(term))
                                     || (c.LastMessagePreview != null && c.LastMessagePreview.ToLower().Contains(term)));
        }
        var list = await query.Where(c => c.Messages.Any(m => m.Role == MessageRole.Guest || m.Role == MessageRole.Owner))
            .OrderByDescending(c => c.LastMessageAt).Take(200).ToListAsync();
        var bookingIds = list.Where(c => c.BookingId != null).Select(c => c.BookingId!.Value).ToList();
        var codes = await Db.Bookings.Where(b => bookingIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id, b => b.Code);
        return list.Select(c => Summary(c, c.BookingId is { } bid ? codes.GetValueOrDefault(bid) : null));
    }

    [HttpGet("conversations/{id:guid}")]
    public async Task<object> Get(Guid id)
    {
        var c = await Load(id);
        var messages = await Db.Messages.Where(m => m.ConversationId == id).OrderBy(m => m.CreatedAt).ToListAsync();
        var booking = c.BookingId is { } bid ? await Db.Bookings.Include(b => b.Room).FirstOrDefaultAsync(b => b.Id == bid) : null;
        return new
        {
            conversation = Summary(c, booking?.Code),
            booking = booking is null ? null : Contracts.BookingDto.From(booking),
            messages = messages.Select(m => new
            {
                id = m.Id, conversationId = m.ConversationId, role = m.Role.ToString(), content = m.Content,
                cards = m.CardsJson is null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(m.CardsJson),
                authorName = m.AuthorName, toolName = m.ToolName,
                toolInput = m.ToolInputJson is null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(m.ToolInputJson),
                toolOutput = m.ToolOutputJson is null ? (JsonElement?)null : SafeJson(m.ToolOutputJson),
                inputTokens = m.InputTokens, outputTokens = m.OutputTokens, createdAt = m.CreatedAt,
            }),
        };
    }

    [HttpPost("conversations/{id:guid}/takeover")]
    public async Task<object> Takeover(Guid id) => await SetStatus(id, ConversationStatus.HumanTakeover, "The host has joined the conversation.", "Chủ nhà đã tham gia cuộc trò chuyện.");

    [HttpPost("conversations/{id:guid}/handback")]
    public async Task<object> Handback(Guid id) => await SetStatus(id, ConversationStatus.Bot, "The virtual concierge is back to help.", "Trợ lý ảo đã quay lại hỗ trợ bạn.");

    [HttpPost("conversations/{id:guid}/close")]
    public async Task<object> Close(Guid id)
    {
        var c = await Load(id);
        c.Status = ConversationStatus.Closed;
        c.NeedsAttention = false;
        c.UnreadCount = 0;
        await Db.SaveChangesAsync();
        await realtime.ConversationUpdated(TenantId, id);
        return Summary(c, null);
    }

    [HttpPost("conversations/{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id)
    {
        var c = await Load(id);
        c.UnreadCount = 0;
        await Db.SaveChangesAsync();
        await realtime.ConversationUpdated(TenantId, id);
        return NoContent();
    }

    [HttpPost("conversations/{id:guid}/messages")]
    public async Task<object> Reply(Guid id, OwnerReplyRequest req)
    {
        var c = await Load(id);
        var text = (req.Text ?? "").Trim();
        if (text.Length == 0) throw AppException.BadRequest("empty_message", "Type a message first.");
        if (c.Status == ConversationStatus.Bot) c.Status = ConversationStatus.HumanTakeover; // replying takes over automatically
        if (c.Status == ConversationStatus.Closed) c.Status = ConversationStatus.HumanTakeover;
        c.NeedsAttention = false;
        c.UnreadCount = 0;
        await Db.SaveChangesAsync();
        var name = User.FindFirst("name")?.Value ?? "Host";
        var m = await messenger.SendAsync(id, MessageRole.Owner, text, null, name);
        return MessageDto.From(m);
    }

    private async Task<object> SetStatus(Guid id, ConversationStatus status, string en, string vi)
    {
        var c = await Load(id);
        c.Status = status;
        if (status == ConversationStatus.Bot) { c.NeedsAttention = false; c.HandoffReason = null; }
        await Db.SaveChangesAsync();
        await messenger.SendAsync(id, MessageRole.System, c.Language == "vi" ? vi : en);
        return Summary(c, null);
    }

    private async Task<Conversation> Load(Guid id) => await Db.Conversations.FirstOrDefaultAsync(c => c.Id == id) ?? throw AppException.NotFound("Conversation");

    private static object Summary(Conversation c, string? bookingCode) => new
    {
        id = c.Id, channel = c.Channel.ToString(), guestName = c.GuestName, guestPhone = c.GuestPhone, status = c.Status.ToString(),
        needsAttention = c.NeedsAttention, unreadCount = c.UnreadCount, lastMessagePreview = c.LastMessagePreview, lastMessageAt = c.LastMessageAt,
        bookingId = c.BookingId, bookingCode, language = c.Language, handoffReason = c.HandoffReason, externalUserId = c.ExternalUserId, createdAt = c.CreatedAt,
    };

    private static JsonElement? SafeJson(string s)
    {
        try { return JsonSerializer.Deserialize<JsonElement>(s); } catch { return null; }
    }
}
