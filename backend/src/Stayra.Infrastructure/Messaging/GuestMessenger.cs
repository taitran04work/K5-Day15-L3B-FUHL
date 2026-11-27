using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Infrastructure.Messaging;

public interface IChannelAdapter
{
    ChannelType Channel { get; }
    Task DeliverAsync(Tenant tenant, Conversation conversation, Message message, IReadOnlyList<Card> cards, CancellationToken ct);
}

/// <summary>Widget clients receive messages over SignalR, so there is nothing extra to deliver.</summary>
public class WebWidgetAdapter : IChannelAdapter
{
    public ChannelType Channel => ChannelType.WebWidget;
    public Task DeliverAsync(Tenant tenant, Conversation conversation, Message message, IReadOnlyList<Card> cards, CancellationToken ct) => Task.CompletedTask;
}

public static class MessageDto
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static object From(Message m) => new
    {
        id = m.Id,
        conversationId = m.ConversationId,
        role = m.Role.ToString(),
        content = m.Content,
        cards = m.CardsJson is null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(m.CardsJson),
        authorName = m.AuthorName,
        toolName = m.ToolName,
        createdAt = m.CreatedAt,
    };

    public static string? SerializeCards(IReadOnlyList<Card>? cards) =>
        cards is { Count: > 0 } ? JsonSerializer.Serialize(cards.Select(c => new { type = c.Type, data = c.Data }), Json) : null;
}

public class GuestMessenger(
    IAppDbContext db,
    IRealtimeNotifier realtime,
    IEnumerable<IChannelAdapter> adapters,
    ILogger<GuestMessenger> log) : IGuestMessenger
{
    public async Task<Message> SendAsync(Guid conversationId, MessageRole role, string text, IReadOnlyList<Card>? cards = null, string? author = null, CancellationToken ct = default)
    {
        var conv = await db.Conversations.IgnoreQueryFilters().FirstAsync(c => c.Id == conversationId, ct);
        var tenant = await db.Tenants.FirstAsync(t => t.Id == conv.TenantId, ct);
        var msg = new Message
        {
            ConversationId = conv.Id,
            Role = role,
            Content = text,
            CardsJson = MessageDto.SerializeCards(cards),
            AuthorName = author,
        };
        db.Messages.Add(msg);
        conv.LastMessageAt = msg.CreatedAt;
        conv.LastMessagePreview = text.Length > 140 ? text[..140] : text;
        await db.SaveChangesAsync(ct);

        await realtime.MessageAdded(tenant.Id, conv.Id, MessageDto.From(msg));
        await realtime.ConversationUpdated(tenant.Id, conv.Id);

        var adapter = adapters.FirstOrDefault(a => a.Channel == conv.Channel);
        if (adapter != null)
        {
            try { await adapter.DeliverAsync(tenant, conv, msg, cards ?? [], ct); }
            catch (Exception ex) { log.LogWarning(ex, "Delivery to {Channel} failed for conversation {Id}", conv.Channel, conv.Id); }
        }
        return msg;
    }
}
