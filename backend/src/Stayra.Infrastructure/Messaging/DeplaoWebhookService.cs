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
        if (!string.Equals(eventType, "message.received", StringComparison.OrdinalIgnoreCase))
            return new(true, "ignored_event", null, []);

        var mappedChannel = DeplaoClient.MapChannel(Str(root, "channel"));
        if (mappedChannel is not { } channelType)
            return new(true, "ignored_channel", null, []);

        if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            return new(false, "missing_data", null, []);
        if (!data.TryGetProperty("message", out var msg) || msg.ValueKind != JsonValueKind.Object)
            return new(false, "missing_message", null, []);

        if (msg.TryGetProperty("is_self", out var isSelf) && isSelf.ValueKind == JsonValueKind.True)
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

        if (!string.IsNullOrWhiteSpace(accountId))
        {
            var connFilter = await db.ChannelConnections
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

        var senderName = Str(msg, "sender_name")
            ?? (data.TryGetProperty("conversation", out var convObj) && convObj.ValueKind == JsonValueKind.Object ? Str(convObj, "name") : null);

        var conv = await db.Conversations.FirstOrDefaultAsync(
            c => c.TenantId == tenant.Id && c.Channel == channelType && c.ExternalUserId == threadId, ct);

        if (conv == null)
        {
            conv = new Conversation
            {
                TenantId = tenant.Id,
                Channel = channelType,
                ExternalUserId = threadId,
                ExternalAccountId = accountId ?? tenant.DeplaoAccountId,
                Language = tenant.DefaultLanguage,
                GuestName = senderName,
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
            if (string.IsNullOrWhiteSpace(conv.GuestName) && !string.IsNullOrWhiteSpace(senderName))
            {
                conv.GuestName = senderName;
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

        var messages = await concierge.HandleGuestMessageAsync(conv.Id, text, ct);
        if (!string.IsNullOrWhiteSpace(msgId))
        {
            var guestMsg = messages.FirstOrDefault(m => m.Role == MessageRole.Guest);
            if (guestMsg != null)
            {
                var tracked = await db.Messages.FirstOrDefaultAsync(m => m.Id == guestMsg.Id, ct);
                if (tracked != null)
                {
                    tracked.ExternalMessageId = msgId;
                    await db.SaveChangesAsync(ct);
                }
            }
        }

        return new(true, null, conv.Id, messages);
    }

    private static string? Str(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
