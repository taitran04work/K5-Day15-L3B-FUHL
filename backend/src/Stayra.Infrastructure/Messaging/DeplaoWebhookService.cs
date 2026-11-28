using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Concierge;
using DomainMessage = Stayra.Domain.Message;

namespace Stayra.Infrastructure.Messaging;

public record DeplaoWebhookResult(bool Accepted, string? Reason, Guid? ConversationId, List<DomainMessage> Messages);

/// <summary>Handles Deplao T123 webhook events (Zalo, Facebook, Telegram) and routes them into ConciergeService.</summary>
public class DeplaoWebhookService(
    IAppDbContext db,
    ITenantContext tenantContext,
    DeplaoClient deplao,
    ConciergeService concierge,
    ConciergeReplyDebouncer debouncer,
    IRealtimeNotifier realtime,
    TimeProvider clock,
    ILogger<DeplaoWebhookService> log)
{
    public async Task<DeplaoWebhookResult> HandleAsync(
        string? tenantSlug,
        byte[] rawBody,
        string? timestampHeader,
        string? signatureHeader,
        bool skipSignature,
        CancellationToken ct = default)
    {
        JsonElement root;
        try { root = JsonDocument.Parse(rawBody).RootElement; }
        catch (JsonException) { return new(false, "invalid_json", null, []); }

        var eventType = Str(root, "type");
        var isReceived = string.Equals(eventType, "message.received", StringComparison.OrdinalIgnoreCase);
        var isSent = string.Equals(eventType, "message.sent", StringComparison.OrdinalIgnoreCase);
        if (!isReceived && !isSent)
            return new(true, "ignored_event", null, []);

        var mappedChannel = DeplaoClient.MapChannel(Str(root, "channel"));
        if (mappedChannel is not { } channelType)
            return new(true, "ignored_channel", null, []);

        if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            return new(false, "missing_data", null, []);
        if (!data.TryGetProperty("message", out var msg) || msg.ValueKind != JsonValueKind.Object)
            return new(false, "missing_message", null, []);

        var isSelf = msg.TryGetProperty("is_self", out var selfProp) && selfProp.ValueKind == JsonValueKind.True;
        if (isReceived && isSelf)
            return new(true, "self_message", null, []);

        var msgType = Str(msg, "msg_type") ?? "text";
        if (string.Equals(msgType, "system", StringComparison.OrdinalIgnoreCase))
            return new(true, "system_message", null, []);

        var accountId = Str(root, "account_id") ?? Str(msg, "account_id");
        tenantContext.Set(null, bypass: true);

        Tenant? tenant = null;
        if (!string.IsNullOrWhiteSpace(tenantSlug))
        {
            tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug.ToLower() && t.Status == TenantStatus.Active, ct);
        }
        else if (!string.IsNullOrWhiteSpace(accountId))
        {
            var conn = await db.ChannelConnections.IgnoreQueryFilters()
                .FirstOrDefaultAsync(c => c.Channel == channelType && c.AccountId == accountId && c.IsEnabled, ct);
            if (conn != null)
                tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Id == conn.TenantId && t.Status == TenantStatus.Active, ct);
        }

        if (tenant == null) return new(false, "unknown_tenant", null, []);
        tenantContext.Set(tenant.Id);

        if (!skipSignature)
        {
            var secret = deplao.ResolveWebhookSecret(tenant);
            if (!DeplaoSignature.Verify(signatureHeader, timestampHeader, rawBody, secret, clock))
            {
                log.LogWarning("Deplao webhook signature rejected for {Tenant}", tenant.Slug);
                return new(false, "invalid_signature", null, []);
            }
        }

        var msgId = Str(msg, "msg_id") ?? Str(root, "id");
        var threadId = Str(msg, "thread_id") ?? Str(msg, "sender_id");
        if (string.IsNullOrWhiteSpace(threadId))
            return new(true, "no_thread", null, []);

        ChannelConnection? connFilter = null;
        if (!string.IsNullOrWhiteSpace(accountId))
        {
            connFilter = await db.ChannelConnections
                .FirstOrDefaultAsync(c => c.Channel == channelType && c.AccountId == accountId, ct);
            if (connFilter != null && !connFilter.IsEnabled)
                return new(true, "connection_disabled", null, []);
            if (connFilter != null && !string.IsNullOrWhiteSpace(connFilter.AllowedThreadIds))
            {
                var allowed = connFilter.AllowedThreadIds
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (allowed.Length > 0 && !allowed.Contains(threadId, StringComparer.Ordinal))
                {
                    log.LogDebug("Ignored webhook for non-whitelisted thread {ThreadId} on {AccountId}", threadId, accountId);
                    return new(true, "thread_not_whitelisted", null, []);
                }
            }
        }

        var rawText = Str(msg, "text")?.Trim() ?? "";
        var text = !string.IsNullOrEmpty(rawText)
            ? rawText
            : msgType.Equals("image", StringComparison.OrdinalIgnoreCase) ? "[image]" : "[attachment]";

        var convObj = data.TryGetProperty("conversation", out var co) && co.ValueKind == JsonValueKind.Object ? co : default;
        var convDisplayName = convObj.ValueKind == JsonValueKind.Object
            ? (Str(convObj, "display_name") ?? Str(convObj, "name"))
            : null;
        var msgSenderName = Str(msg, "sender_name");
        var isGroup = string.Equals(Str(msg, "thread_type"), "group", StringComparison.OrdinalIgnoreCase)
            || (convObj.ValueKind == JsonValueKind.Object && string.Equals(Str(convObj, "type"), "group", StringComparison.OrdinalIgnoreCase));
        var resolvedName = !string.IsNullOrWhiteSpace(convDisplayName) ? convDisplayName : msgSenderName;

        var conv = await db.Conversations.FirstOrDefaultAsync(
            c => c.TenantId == tenant.Id && c.Channel == channelType && c.ExternalUserId == threadId, ct);

        // Safety for message.sent: only sync Owner messages sent from the Zalo app if a conversation already exists
        // OR the thread is explicitly whitelisted (never leak personal chats to unrelated friends).
        if (isSent && conv == null && string.IsNullOrWhiteSpace(connFilter?.AllowedThreadIds))
            return new(true, "sent_ignored_unknown_thread", null, []);

        if (conv == null)
        {
            conv = new Conversation
            {
                TenantId = tenant.Id,
                Channel = channelType,
                ExternalUserId = threadId,
                ExternalAccountId = accountId ?? tenant.DeplaoAccountId,
                Language = tenant.DefaultLanguage,
                GuestName = resolvedName,
            };
            db.Conversations.Add(conv);
            await db.SaveChangesAsync(ct);
        }
        else
        {
            var changed = false;
            if (!string.IsNullOrWhiteSpace(accountId) && conv.ExternalAccountId != accountId)
            {
                conv.ExternalAccountId = accountId;
                changed = true;
            }
            if ((string.IsNullOrWhiteSpace(conv.GuestName) || string.Equals(conv.GuestName, "Zalo guest", StringComparison.OrdinalIgnoreCase))
                && !string.IsNullOrWhiteSpace(resolvedName))
            {
                conv.GuestName = resolvedName;
                changed = true;
            }
            if (changed) await db.SaveChangesAsync(ct);
        }

        if (!string.IsNullOrWhiteSpace(msgId))
        {
            var exists = await db.Messages.AnyAsync(m => m.ConversationId == conv.Id && m.ExternalMessageId == msgId, ct);
            if (exists)
                return new(true, "duplicate", conv.Id, []);
        }

        // Handle outbound messages sent directly by the Owner/Staff on the Zalo phone/desktop app
        if (isSent)
        {
            var cutoff = clock.GetUtcNow().AddSeconds(-30);
            var alreadySentFromStayra = await db.Messages.AnyAsync(m =>
                m.ConversationId == conv.Id
                && (m.Role == MessageRole.Bot || m.Role == MessageRole.Owner)
                && m.CreatedAt >= cutoff
                && m.Content == text, ct);
            if (alreadySentFromStayra)
                return new(true, "duplicate_outbound", conv.Id, []);

            var ownerMsg = new DomainMessage
            {
                ConversationId = conv.Id,
                Role = MessageRole.Owner,
                Content = text,
                ExternalMessageId = msgId,
                CreatedAt = clock.GetUtcNow(),
            };
            db.Messages.Add(ownerMsg);
            conv.LastMessageAt = ownerMsg.CreatedAt;
            conv.LastMessagePreview = text.Length > 140 ? text[..140] : text;
            conv.UnreadCount = 0;
            var statusChanged = conv.Status != ConversationStatus.HumanTakeover;
            if (statusChanged)
            {
                conv.Status = ConversationStatus.HumanTakeover;
                conv.NeedsAttention = false;
            }
            await db.SaveChangesAsync(ct);

            await realtime.MessageAdded(tenant.Id, conv.Id, MessageDto.From(ownerMsg));
            if (statusChanged) await realtime.ConversationStatusChanged(conv.Id, conv.Status.ToString());
            await realtime.ConversationUpdated(tenant.Id, conv.Id);
            return new(true, "owner_synced", conv.Id, [ownerMsg]);
        }

        if (isGroup && !string.IsNullOrWhiteSpace(msgSenderName) && !string.Equals(msgSenderName, conv.GuestName, StringComparison.OrdinalIgnoreCase))
            text = $"[{msgSenderName}]: {text}";

        var (guestMsg, shouldRunBot) = await concierge.RecordGuestMessageAsync(conv.Id, text, msgId, ct);
        if (shouldRunBot)
            debouncer.Schedule(conv.Id);

        return new(true, null, conv.Id, [guestMsg]);
    }

    private static string? Str(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
