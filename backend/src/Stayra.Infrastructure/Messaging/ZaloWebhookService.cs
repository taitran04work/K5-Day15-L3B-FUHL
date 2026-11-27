using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Concierge;
using DomainMessage = Stayra.Domain.Message;

namespace Stayra.Infrastructure.Messaging;

public record ZaloWebhookResult(bool Accepted, string? Reason, Guid? ConversationId, List<DomainMessage> Messages);

/// <summary>Handles Zalo OA webhook events (and the dev simulator, which posts the same event shape).</summary>
public class ZaloWebhookService(IAppDbContext db, ITenantContext tenantContext, ISecretProtector secrets, ConciergeService concierge, ILogger<ZaloWebhookService> log)
{
    public async Task<ZaloWebhookResult> HandleAsync(string tenantSlug, string rawBody, string? signatureHeader, bool skipSignature, CancellationToken ct = default)
    {
        tenantContext.Set(null, bypass: true);
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug.ToLower() && t.Status == TenantStatus.Active, ct);
        if (tenant == null) return new(false, "unknown_tenant", null, []);
        tenantContext.Set(tenant.Id);

        JsonElement body;
        try { body = JsonDocument.Parse(rawBody).RootElement; }
        catch (JsonException) { return new(false, "invalid_json", null, []); }

        if (!skipSignature)
        {
            var secret = secrets.Unprotect(tenant.ZaloOaSecretKeyEnc);
            var timestamp = body.TryGetProperty("timestamp", out var ts) ? (ts.ValueKind == JsonValueKind.String ? ts.GetString() ?? "" : ts.GetRawText()) : "";
            var appId = body.TryGetProperty("app_id", out var aid) ? aid.GetString() ?? tenant.ZaloAppId ?? "" : tenant.ZaloAppId ?? "";
            if (string.IsNullOrEmpty(secret) || !ZaloSignature.Verify(signatureHeader, tenant.ZaloAppId ?? appId, rawBody, timestamp, secret))
            {
                log.LogWarning("Zalo webhook signature rejected for {Tenant}", tenant.Slug);
                return new(false, "invalid_signature", null, []);
            }
        }

        var evt = body.TryGetProperty("event_name", out var en) ? en.GetString() : null;
        if (evt is not ("user_send_text" or "user_send_image" or "user_send_sticker" or "user_send_file"))
            return new(true, "ignored_event", null, []);

        var senderId = body.TryGetProperty("sender", out var sender) && sender.TryGetProperty("id", out var sid) ? sid.GetString() : null;
        if (string.IsNullOrEmpty(senderId)) return new(true, "no_sender", null, []);

        var text = evt == "user_send_text" && body.TryGetProperty("message", out var msg) && msg.TryGetProperty("text", out var t)
            ? t.GetString() ?? ""
            : evt == "user_send_image" ? "[image]" : "[attachment]";
        if (string.IsNullOrWhiteSpace(text)) return new(true, "empty", null, []);

        var conv = await db.Conversations.FirstOrDefaultAsync(c => c.TenantId == tenant.Id && c.Channel == ChannelType.Zalo && c.ExternalUserId == senderId, ct);
        if (conv == null)
        {
            conv = new Conversation
            {
                TenantId = tenant.Id, Channel = ChannelType.Zalo, ExternalUserId = senderId,
                Language = tenant.DefaultLanguage,
                GuestName = body.TryGetProperty("user_name", out var un) ? un.GetString() : null,
            };
            db.Conversations.Add(conv);
            await db.SaveChangesAsync(ct);
        }
        var messages = await concierge.HandleGuestMessageAsync(conv.Id, text, ct);
        return new(true, null, conv.Id, messages);
    }
}
