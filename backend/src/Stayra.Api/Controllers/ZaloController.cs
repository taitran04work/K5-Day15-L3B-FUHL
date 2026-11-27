using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Messaging;
using Stayra.Infrastructure.Payments;
using Stayra.Infrastructure.Persistence;

namespace Stayra.Api.Controllers;

[ApiController]
[Route("api/channels/zalo")]
public class ZaloWebhookController(ZaloWebhookService zalo, ILogger<ZaloWebhookController> log) : ControllerBase
{
    /// <summary>Zalo OA webhook. Verifies X-ZEvent-Signature (mac = sha256(appId + body + timestamp + OASecretKey)).</summary>
    [HttpPost("{tenantSlug}/webhook")]
    public async Task<IActionResult> Webhook(string tenantSlug)
    {
        Request.EnableBuffering();
        using var reader = new StreamReader(Request.Body, Encoding.UTF8, leaveOpen: true);
        var raw = await reader.ReadToEndAsync();
        var result = await zalo.HandleAsync(tenantSlug, raw, Request.Headers["X-ZEvent-Signature"].FirstOrDefault(), skipSignature: false);
        if (result.Reason == "invalid_signature") return Unauthorized();
        if (!result.Accepted) log.LogInformation("Zalo webhook for {Slug} not accepted: {Reason}", tenantSlug, result.Reason);
        return Ok(new { received = true });
    }
}

public record ZaloSimRequest(string UserId, string? UserName, string Text);

/// <summary>Development-only Zalo simulator: builds the same event Zalo would send and runs the real pipeline.</summary>
[ApiController]
[Route("api/dev/zalo")]
public class ZaloSimulatorController(IWebHostEnvironment env, ZaloWebhookService zalo, StayraDbContext db, ITenantContext tenantContext) : ControllerBase
{
    [HttpPost("{slug}/send")]
    public async Task<object> Send(string slug, ZaloSimRequest req)
    {
        EnsureDev();
        var userId = req.UserId.StartsWith("sim-") ? req.UserId : $"sim-{req.UserId}";
        var evt = new
        {
            app_id = "simulator",
            event_name = "user_send_text",
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(),
            user_name = req.UserName,
            sender = new { id = userId },
            recipient = new { id = "oa-simulator" },
            message = new { text = req.Text, msg_id = Guid.NewGuid().ToString("N") },
        };
        var r = await zalo.HandleAsync(slug, JsonSerializer.Serialize(evt), null, skipSignature: true);
        if (!r.Accepted) throw AppException.NotFound("Homestay");
        if (r.ConversationId is { } cid && !string.IsNullOrWhiteSpace(req.UserName))
        {
            var conv = await db.Conversations.FirstAsync(c => c.Id == cid);
            if (string.IsNullOrEmpty(conv.GuestName)) { conv.GuestName = req.UserName; await db.SaveChangesAsync(); }
        }
        return new { conversationId = r.ConversationId, messages = r.Messages.Select(MessageDto.From) };
    }

    [HttpGet("{slug}/conversations/{userId}")]
    public async Task<object> Conversation(string slug, string userId)
    {
        EnsureDev();
        tenantContext.Set(null, bypass: true);
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == slug) ?? throw AppException.NotFound("Homestay");
        var uid = userId.StartsWith("sim-") ? userId : $"sim-{userId}";
        var conv = await db.Conversations.FirstOrDefaultAsync(c => c.TenantId == tenant.Id && c.Channel == ChannelType.Zalo && c.ExternalUserId == uid);
        if (conv == null) return new { conversationId = (Guid?)null, messages = Array.Empty<object>() };
        var messages = await db.Messages.Where(m => m.ConversationId == conv.Id && m.Role != MessageRole.Tool).OrderBy(m => m.CreatedAt).ToListAsync();
        return new { conversationId = (Guid?)conv.Id, messages = messages.Select(MessageDto.From) };
    }

    private void EnsureDev()
    {
        if (!env.IsDevelopment()) throw AppException.NotFound("Endpoint");
    }
}

public record ZaloConnectRequest(string? AppId, string? AppSecret, string? OaId, string? OaSecretKey, string? AccessToken, string? RefreshToken);
public record ZaloTestRequest(string UserId, string? Text);

[Route("api/app/channels/zalo")]
public class ChannelsController(ISecretProtector secrets, ZaloClient zaloClient, IOptions<MomoOptions> momo, IConfiguration config) : OwnerControllerBase
{
    [HttpGet]
    public async Task<object> Get() => View(await CurrentTenantAsync());

    [HttpPut]
    public async Task<object> Connect(ZaloConnectRequest req)
    {
        var t = await CurrentTenantAsync();
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.AppId) && string.IsNullOrEmpty(t.ZaloAppId)) errors["appId"] = ["required"];
        if (string.IsNullOrWhiteSpace(req.OaId) && string.IsNullOrEmpty(t.ZaloOaId)) errors["oaId"] = ["required"];
        if (string.IsNullOrWhiteSpace(req.OaSecretKey) && string.IsNullOrEmpty(t.ZaloOaSecretKeyEnc)) errors["oaSecretKey"] = ["required"];
        if (errors.Count > 0) throw new AppException(400, "validation", "Please fill in the required fields.", errors);

        if (!string.IsNullOrWhiteSpace(req.AppId)) t.ZaloAppId = req.AppId.Trim();
        if (!string.IsNullOrWhiteSpace(req.OaId)) t.ZaloOaId = req.OaId.Trim();
        if (!string.IsNullOrWhiteSpace(req.AppSecret)) t.ZaloAppSecretEnc = secrets.Protect(req.AppSecret.Trim());
        if (!string.IsNullOrWhiteSpace(req.OaSecretKey)) t.ZaloOaSecretKeyEnc = secrets.Protect(req.OaSecretKey.Trim());
        if (!string.IsNullOrWhiteSpace(req.AccessToken))
        {
            t.ZaloAccessTokenEnc = secrets.Protect(req.AccessToken.Trim());
            t.ZaloTokenExpiresAt = DateTimeOffset.UtcNow.AddHours(25);
        }
        if (!string.IsNullOrWhiteSpace(req.RefreshToken)) t.ZaloRefreshTokenEnc = secrets.Protect(req.RefreshToken.Trim());
        Db.AuditLogs.Add(new AuditLog { TenantId = t.Id, Actor = Actor, Action = "channel.zalo_connected", EntityType = nameof(Tenant), EntityId = t.Id });
        await Db.SaveChangesAsync();
        return View(t);
    }

    [HttpDelete]
    public async Task<object> Disconnect()
    {
        var t = await CurrentTenantAsync();
        t.ZaloAppId = t.ZaloOaId = null;
        t.ZaloAppSecretEnc = t.ZaloOaSecretKeyEnc = t.ZaloAccessTokenEnc = t.ZaloRefreshTokenEnc = null;
        t.ZaloTokenExpiresAt = null;
        await Db.SaveChangesAsync();
        return View(t);
    }

    [HttpPost("test")]
    public async Task<object> Test(ZaloTestRequest req)
    {
        var t = await CurrentTenantAsync();
        if (!zaloClient.IsConnected(t)) throw AppException.BadRequest("zalo_not_connected", "Connect your Zalo Official Account first.");
        if (string.IsNullOrWhiteSpace(req.UserId)) throw new AppException(400, "validation", "Enter a Zalo user id.", new Dictionary<string, string[]> { ["userId"] = ["required"] });
        try
        {
            var (ok, message) = await zaloClient.SendTextAsync(t, req.UserId.Trim(), req.Text ?? $"Test message from {t.Name} via Stayra.", HttpContext.RequestAborted);
            return new { ok, message };
        }
        catch (HttpRequestException)
        {
            return new { ok = false, message = "Couldn't reach Zalo. Check your internet connection." };
        }
    }

    private object View(Tenant t)
    {
        var apiBase = (config["App:PublicApiUrl"] ?? momo.Value.IpnBaseUrl).TrimEnd('/');
        return new
        {
            connected = !string.IsNullOrEmpty(t.ZaloAccessTokenEnc) && !string.IsNullOrEmpty(t.ZaloOaId),
            configured = !string.IsNullOrEmpty(t.ZaloOaSecretKeyEnc),
            appId = t.ZaloAppId,
            oaId = t.ZaloOaId,
            hasAppSecret = !string.IsNullOrEmpty(t.ZaloAppSecretEnc),
            hasOaSecretKey = !string.IsNullOrEmpty(t.ZaloOaSecretKeyEnc),
            hasRefreshToken = !string.IsNullOrEmpty(t.ZaloRefreshTokenEnc),
            webhookUrl = $"{apiBase}/api/channels/zalo/{t.Slug}/webhook",
            tokenExpiresAt = t.ZaloTokenExpiresAt,
        };
    }
}
