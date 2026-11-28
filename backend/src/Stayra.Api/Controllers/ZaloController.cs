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

[ApiController]
[Route("api/channels/deplao")]
public class DeplaoWebhookController(DeplaoWebhookService deplaoWebhook, ILogger<DeplaoWebhookController> log) : ControllerBase
{
    /// <summary>Unified Deplao T123 webhook (Zalo, Facebook, Telegram). Resolves tenant from ChannelConnections by account_id.</summary>
    [HttpPost("webhook")]
    public Task<IActionResult> GlobalWebhook() => HandleAsync(null);

    /// <summary>Tenant-scoped Deplao T123 webhook.</summary>
    [HttpPost("{tenantSlug}/webhook")]
    public Task<IActionResult> TenantWebhook(string tenantSlug) => HandleAsync(tenantSlug);

    private async Task<IActionResult> HandleAsync(string? tenantSlug)
    {
        using var ms = new MemoryStream();
        await Request.Body.CopyToAsync(ms);
        var raw = ms.ToArray();
        var ts = Request.Headers["X-Deplao-Timestamp"].FirstOrDefault();
        var sig = Request.Headers["X-Deplao-Signature"].FirstOrDefault();
        var result = await deplaoWebhook.HandleAsync(tenantSlug, raw, ts, sig, skipSignature: false, HttpContext.RequestAborted);
        if (result.Reason == "invalid_signature") return Unauthorized();
        if (!result.Accepted) log.LogInformation("Deplao webhook for {Slug} not accepted: {Reason}", tenantSlug ?? "global", result.Reason);
        return Ok(new { received = true, reason = result.Reason, conversationId = result.ConversationId });
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
public class ChannelsController(ISecretProtector secrets, ZaloClient zaloClient, IOptions<VnpayOptions> vnpay, IConfiguration config) : OwnerControllerBase
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
        // Disable Zalo channel connections so webhooks stop routing to this tenant.
        // We disable (not delete) so they can be re-enabled if the OA is reconnected later.
        var zaloConns = await Db.ChannelConnections.Where(c => c.Channel == ChannelType.Zalo).ToListAsync();
        foreach (var conn in zaloConns)
            conn.IsEnabled = false;
        Db.AuditLogs.Add(new AuditLog { TenantId = t.Id, Actor = Actor, Action = "channel.zalo_disconnected", EntityType = nameof(Tenant), EntityId = t.Id });
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
        var apiBase = (config["App:PublicApiUrl"] ?? vnpay.Value.IpnBaseUrl).TrimEnd('/');
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

public record DeplaoConnectRequest(string? BaseUrl, string? ApiKey, string? AccountId, string? WebhookSecret, bool AutoRegisterWebhook = false);
public record DeplaoAccountsRequest(string? BaseUrl, string? ApiKey);
public record DeplaoTestRequest(string ConversationId, string? Text, string? AccountId, string? Type = null);
public record ChannelConnectionRequest(string Channel, string AccountId, string AccountName);
public record ToggleConnectionRequest(bool IsEnabled);
public record AllowedThreadsRequest(string[] AllowedThreadIds);

[Route("api/app/channels/deplao")]
public class DeplaoChannelsController(
    ISecretProtector secrets,
    DeplaoClient deplaoClient,
    IOptions<DeplaoOptions> deplaoOptions,
    IConfiguration config) : OwnerControllerBase
{
    [HttpGet]
    public async Task<object> Get()
    {
        var t = await CurrentTenantAsync();
        // Attempt silent auto-provisioning; surface the outcome so the frontend can
        // show a warning when the gateway isn't ready yet.
        var provisioned = await deplaoClient.EnsureProvisionedAsync(t, Db, WebhookUrlFor(t), HttpContext.RequestAborted);
        var connections = await Db.ChannelConnections.OrderBy(c => c.CreatedAt).ToListAsync();
        var provisionStatus = deplaoClient.IsConnected(t) ? "ok"
                            : provisioned ? "ok"
                            : (string.IsNullOrWhiteSpace(deplaoClient.ResolveApiKey(t)) ? "not_configured" : "failed");
        return View(t, connections, provisionStatus);
    }

    [HttpPost("zalo/qr")]
    public async Task<object> StartZaloQr()
    {
        var t = await CurrentTenantAsync();
        var provisioned = await deplaoClient.EnsureProvisionedAsync(t, Db, WebhookUrlFor(t), HttpContext.RequestAborted);
        if (!deplaoClient.IsConnected(t))
        {
            var reason = string.IsNullOrWhiteSpace(deplaoOptions.Value.WebPassword)
                ? "Thiếu cấu hình Deplao__WebPassword trên API."
                : $"Không kết nối được tới Deplao Engine ({deplaoClient.ResolveBaseUrl(t)}) hoặc sai DEPLAO_WEB_PASSWORD (provisioned={provisioned}).";
            throw AppException.BadRequest("deplao_not_configured", reason);
        }
        var res = await deplaoClient.StartZaloQrAsync(t, HttpContext.RequestAborted);
        if (res.Forbidden)
        {
            t.DeplaoApiKeyEnc = null;
            await Db.SaveChangesAsync();
            await deplaoClient.EnsureProvisionedAsync(t, Db, WebhookUrlFor(t), HttpContext.RequestAborted);
            res = await deplaoClient.StartZaloQrAsync(t, HttpContext.RequestAborted);
        }
        if (!res.Ok || string.IsNullOrWhiteSpace(res.TempId))
            throw AppException.BadRequest("qr_start_failed", res.Error ?? "Could not start Zalo QR login.");
        return new { tempId = res.TempId };
    }

    [HttpGet("zalo/qr/{tempId}")]
    public async Task<object> GetZaloQrStatus(string tempId)
    {
        var t = await CurrentTenantAsync();
        var res = await deplaoClient.GetZaloQrStatusAsync(t, tempId, HttpContext.RequestAborted);
        if (!res.Ok)
            throw AppException.BadRequest("qr_status_failed", res.Error ?? "Could not fetch QR status.");

        if (res.Status == "success" && !string.IsNullOrWhiteSpace(res.AccountId))
        {
            var accId = res.AccountId.Trim();
            var claimedByOther = await Db.ChannelConnections.IgnoreQueryFilters()
                .AnyAsync(c => c.Channel == ChannelType.Zalo && c.AccountId == accId && c.TenantId != t.Id);
            if (claimedByOther)
            {
                return new
                {
                    tempId,
                    status = "error",
                    qrDataUrl = "",
                    message = "Tài khoản Zalo này đã được kết nối với một homestay khác.",
                    accountId = (string?)null,
                    accountName = (string?)null,
                };
            }

            var existing = await Db.ChannelConnections.FirstOrDefaultAsync(c => c.Channel == ChannelType.Zalo && c.AccountId == accId);
            if (existing == null)
            {
                Db.ChannelConnections.Add(new ChannelConnection
                {
                    TenantId = t.Id,
                    Channel = ChannelType.Zalo,
                    AccountId = accId,
                    AccountName = string.IsNullOrWhiteSpace(res.AccountName) ? accId : res.AccountName.Trim(),
                    IsEnabled = true,
                });
            }
            else
            {
                existing.AccountName = string.IsNullOrWhiteSpace(res.AccountName) ? existing.AccountName : res.AccountName.Trim();
                existing.IsEnabled = true;
            }
            if (string.IsNullOrWhiteSpace(t.DeplaoAccountId))
                t.DeplaoAccountId = accId;
            await Db.SaveChangesAsync();
        }

        return new
        {
            tempId,
            status = res.Status,
            qrDataUrl = res.QrDataUrl ?? "",
            message = res.Message,
            accountId = res.AccountId,
            accountName = res.AccountName,
        };
    }

    [HttpPost("zalo/qr/{tempId}/abort")]
    public async Task<object> AbortZaloQr(string tempId)
    {
        var t = await CurrentTenantAsync();
        await deplaoClient.AbortZaloQrAsync(t, tempId, HttpContext.RequestAborted);
        return new { aborted = true };
    }

    [HttpPost("connections")]
    public async Task<object> AddConnection(ChannelConnectionRequest req)
    {
        var t = await CurrentTenantAsync();
        var ch = DeplaoClient.MapChannel(req.Channel)
            ?? throw AppException.BadRequest("invalid_channel", "Channel must be zalo, facebook, or telegram.");
        if (string.IsNullOrWhiteSpace(req.AccountId))
            throw AppException.BadRequest("required", "AccountId is required.");

        var accId = req.AccountId.Trim();
        var claimedByOther = await Db.ChannelConnections.IgnoreQueryFilters()
            .AnyAsync(c => c.Channel == ch && c.AccountId == accId && c.TenantId != t.Id);
        if (claimedByOther)
            throw new AppException(409, "account_taken", "This channel account is already connected to another homestay.");

        var existing = await Db.ChannelConnections.FirstOrDefaultAsync(c => c.Channel == ch && c.AccountId == accId);
        if (existing == null)
        {
            existing = new ChannelConnection
            {
                TenantId = t.Id,
                Channel = ch,
                AccountId = accId,
                AccountName = string.IsNullOrWhiteSpace(req.AccountName) ? accId : req.AccountName.Trim(),
                IsEnabled = true,
            };
            Db.ChannelConnections.Add(existing);
        }
        else
        {
            existing.AccountName = string.IsNullOrWhiteSpace(req.AccountName) ? existing.AccountName : req.AccountName.Trim();
            existing.IsEnabled = true;
        }
        if (ch == ChannelType.Zalo && string.IsNullOrWhiteSpace(t.DeplaoAccountId))
            t.DeplaoAccountId = accId;

        await Db.SaveChangesAsync();
        var connections = await Db.ChannelConnections.OrderBy(c => c.CreatedAt).ToListAsync();
        return View(t, connections);
    }

    [HttpPut("connections/{id:guid}")]
    public async Task<object> ToggleConnection(Guid id, ToggleConnectionRequest req)
    {
        // TenantId check is enforced by the global query filter (ITenantOwned + TenantContext set by JWT).
        // Explicit guard here as defence-in-depth: an owner can only toggle their own tenant's connections.
        var c = await Db.ChannelConnections.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == TenantId)
            ?? throw AppException.NotFound("ChannelConnection");
        c.IsEnabled = req.IsEnabled;
        await Db.SaveChangesAsync();
        return new { id = c.Id, isEnabled = c.IsEnabled };
    }

    [HttpPut("connections/{id:guid}/allowed-threads")]
    public async Task<object> SetAllowedThreads(Guid id, AllowedThreadsRequest req)
    {
        var c = await Db.ChannelConnections.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == TenantId)
            ?? throw AppException.NotFound("ChannelConnection");
        var clean = (req.AllowedThreadIds ?? [])
            .Select(x => x?.Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        c.AllowedThreadIds = clean.Length == 0 ? null : string.Join(',', clean);
        await Db.SaveChangesAsync();
        return new { id = c.Id, allowedThreadIds = clean };
    }

    [HttpDelete("connections/{id:guid}")]
    public async Task<IActionResult> RemoveConnection(Guid id)
    {
        // Same defence-in-depth TenantId guard.
        var c = await Db.ChannelConnections.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == TenantId)
            ?? throw AppException.NotFound("ChannelConnection");
        Db.ChannelConnections.Remove(c);
        await Db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut]
    public async Task<object> Connect(DeplaoConnectRequest req)
    {
        var t = await CurrentTenantAsync();
        var baseUrl = string.IsNullOrWhiteSpace(req.BaseUrl)
            ? (t.DeplaoBaseUrl ?? deplaoOptions.Value.DefaultBaseUrl)
            : req.BaseUrl.Trim();
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(baseUrl)) errors["baseUrl"] = ["required"];
        if (string.IsNullOrWhiteSpace(req.ApiKey) && string.IsNullOrEmpty(t.DeplaoApiKeyEnc)) errors["apiKey"] = ["required"];
        if (errors.Count > 0) throw new AppException(400, "validation", "Please fill in the required fields.", errors);

        t.DeplaoBaseUrl = deplaoClient.NormalizeBaseUrl(baseUrl);
        if (!string.IsNullOrWhiteSpace(req.ApiKey)) t.DeplaoApiKeyEnc = secrets.Protect(req.ApiKey.Trim());
        if (req.AccountId != null) t.DeplaoAccountId = string.IsNullOrWhiteSpace(req.AccountId) ? null : req.AccountId.Trim();
        if (!string.IsNullOrWhiteSpace(req.WebhookSecret))
            t.DeplaoWebhookSecretEnc = secrets.Protect(req.WebhookSecret.Trim());
        else if (string.IsNullOrEmpty(t.DeplaoWebhookSecretEnc))
            t.DeplaoWebhookSecretEnc = secrets.Protect("whsec_" + Guid.NewGuid().ToString("N"));

        string? webhookMessage = null;
        if (req.AutoRegisterWebhook)
        {
            var webhookUrl = WebhookUrlFor(t);
            var secret = secrets.Unprotect(t.DeplaoWebhookSecretEnc) ?? "";
            var reg = await deplaoClient.RegisterOrUpdateWebhookAsync(t, webhookUrl, secret, HttpContext.RequestAborted);
            if (reg.Ok && !string.IsNullOrEmpty(reg.WebhookId)) t.DeplaoWebhookId = reg.WebhookId;
            webhookMessage = reg.Message;
        }

        Db.AuditLogs.Add(new AuditLog { TenantId = t.Id, Actor = Actor, Action = "channel.deplao_connected", EntityType = nameof(Tenant), EntityId = t.Id });
        await Db.SaveChangesAsync();
        var connections = await Db.ChannelConnections.OrderBy(c => c.CreatedAt).ToListAsync();
        return new { status = View(t, connections), webhookMessage };
    }

    [HttpDelete]
    public async Task<object> Disconnect()
    {
        var t = await CurrentTenantAsync();
        t.DeplaoBaseUrl = t.DeplaoApiKeyEnc = t.DeplaoAccountId = t.DeplaoWebhookId = t.DeplaoWebhookSecretEnc = null;

        // Disable all channel connections so webhooks stop routing to this tenant
        // while the account IDs are still registered in Deplao. We disable (not delete)
        // so the owner can re-enable them quickly if they reconnect with the same API key.
        var tenantConnections = await Db.ChannelConnections.ToListAsync();
        foreach (var conn in tenantConnections)
            conn.IsEnabled = false;

        Db.AuditLogs.Add(new AuditLog { TenantId = t.Id, Actor = Actor, Action = "channel.deplao_disconnected", EntityType = nameof(Tenant), EntityId = t.Id });
        await Db.SaveChangesAsync();
        var connections = await Db.ChannelConnections.OrderBy(c => c.CreatedAt).ToListAsync();
        return View(t, connections);
    }

    [HttpPost("accounts")]
    public async Task<object> Accounts(DeplaoAccountsRequest? req)
    {
        var t = await CurrentTenantAsync();
        await deplaoClient.EnsureProvisionedAsync(t, Db, WebhookUrlFor(t), HttpContext.RequestAborted);
        var baseUrl = !string.IsNullOrWhiteSpace(req?.BaseUrl) ? req.BaseUrl.Trim() : deplaoClient.ResolveBaseUrl(t);
        var apiKey = !string.IsNullOrWhiteSpace(req?.ApiKey) ? req.ApiKey.Trim() : deplaoClient.ResolveApiKey(t);
        if (string.IsNullOrWhiteSpace(apiKey))
            throw AppException.BadRequest("deplao_not_connected", "Deplao gateway is not ready. Check DEPLAO_WEB_PASSWORD.");
        var (ok, accounts, error) = await deplaoClient.GetAccountsAsync(baseUrl, apiKey, HttpContext.RequestAborted);
        if (!ok && string.IsNullOrWhiteSpace(req?.ApiKey) && (error?.StartsWith("HTTP 401:") == true || error?.StartsWith("HTTP 403:") == true))
        {
            t.DeplaoApiKeyEnc = null;
            await Db.SaveChangesAsync();
            if (await deplaoClient.EnsureProvisionedAsync(t, Db, WebhookUrlFor(t), HttpContext.RequestAborted))
            {
                apiKey = deplaoClient.ResolveApiKey(t) ?? apiKey;
                (ok, accounts, error) = await deplaoClient.GetAccountsAsync(baseUrl, apiKey, HttpContext.RequestAborted);
            }
        }
        if (ok)
        {
            var takenByOthers = await Db.ChannelConnections.IgnoreQueryFilters()
                .Where(c => c.TenantId != t.Id)
                .Select(c => new { c.Channel, c.AccountId })
                .ToListAsync(HttpContext.RequestAborted);
            accounts = accounts.Where(a =>
            {
                var ch = DeplaoClient.MapChannel(a.Channel);
                return ch is null || !takenByOthers.Any(x => x.Channel == ch.Value && x.AccountId == a.Id);
            }).ToList();
        }
        return new { ok, accounts, error };
    }

    [HttpPost("register-webhook")]
    public async Task<object> RegisterWebhook()
    {
        var t = await CurrentTenantAsync();
        if (!deplaoClient.IsConnected(t))
            throw AppException.BadRequest("deplao_not_connected", "Connect Deplao T123 first.");
        var secret = deplaoClient.ResolveWebhookSecret(t);
        if (string.IsNullOrWhiteSpace(secret))
        {
            secret = "whsec_" + Guid.NewGuid().ToString("N");
            t.DeplaoWebhookSecretEnc = secrets.Protect(secret);
        }
        var reg = await deplaoClient.RegisterOrUpdateWebhookAsync(t, WebhookUrlFor(t), secret, HttpContext.RequestAborted);
        if (!reg.Ok && (reg.Message?.StartsWith("Deplao HTTP 401:") == true || reg.Message?.StartsWith("Deplao HTTP 403:") == true))
        {
            t.DeplaoApiKeyEnc = null;
            t.DeplaoWebhookId = null;
            await Db.SaveChangesAsync();
            if (await deplaoClient.EnsureProvisionedAsync(t, Db, WebhookUrlFor(t), HttpContext.RequestAborted))
            {
                secret = deplaoClient.ResolveWebhookSecret(t) ?? secret;
                reg = await deplaoClient.RegisterOrUpdateWebhookAsync(t, WebhookUrlFor(t), secret, HttpContext.RequestAborted);
            }
        }
        if (reg.Ok && !string.IsNullOrEmpty(reg.WebhookId))
            t.DeplaoWebhookId = reg.WebhookId;
        await Db.SaveChangesAsync();
        return new { ok = reg.Ok, webhookId = reg.WebhookId, message = reg.Message };
    }

    [HttpGet("recipients")]
    public async Task<object> GetRecipients([FromQuery] string? accountId)
    {
        var t = await CurrentTenantAsync();
        await deplaoClient.EnsureProvisionedAsync(t, Db, WebhookUrlFor(t), HttpContext.RequestAborted);
        var accId = string.IsNullOrWhiteSpace(accountId)
            ? (await Db.ChannelConnections.Where(c => c.IsEnabled).OrderBy(c => c.CreatedAt).Select(c => c.AccountId).FirstOrDefaultAsync(HttpContext.RequestAborted) ?? t.DeplaoAccountId)
            : accountId.Trim();
        if (string.IsNullOrWhiteSpace(accId))
            return new { ok = true, recipients = Array.Empty<DeplaoRecipient>() };

        // Ensure the requested accountId belongs to this tenant
        var ownsAccount = t.DeplaoAccountId == accId || await Db.ChannelConnections.AnyAsync(c => c.AccountId == accId, HttpContext.RequestAborted);
        if (!ownsAccount)
            throw AppException.BadRequest("forbidden_account", "Account does not belong to this workspace.");

        var (ok, recipients, needsReauth, error) = await deplaoClient.GetRecipientsAsync(t, accId, HttpContext.RequestAborted);
        if (!ok && needsReauth)
        {
            t.DeplaoApiKeyEnc = null;
            await Db.SaveChangesAsync();
            if (await deplaoClient.EnsureProvisionedAsync(t, Db, WebhookUrlFor(t), HttpContext.RequestAborted))
                (ok, recipients, _, error) = await deplaoClient.GetRecipientsAsync(t, accId, HttpContext.RequestAborted);
        }
        return new { ok, recipients, error };
    }

    [HttpPost("test")]
    public async Task<object> Test(DeplaoTestRequest req)
    {
        var t = await CurrentTenantAsync();
        if (!deplaoClient.IsConnected(t))
            throw AppException.BadRequest("deplao_not_connected", "Connect Deplao T123 first.");
        if (string.IsNullOrWhiteSpace(req.ConversationId))
            throw new AppException(400, "validation", "Enter a user/thread id.", new Dictionary<string, string[]> { ["conversationId"] = ["required"] });
        var text = string.IsNullOrWhiteSpace(req.Text) ? $"Test message from {t.Name} via Stayra + Deplao T123." : req.Text.Trim();
        var threadType = req.Type == "group" ? "group" : "user";
        var res = await deplaoClient.SendDeliveryAsync(t, req.AccountId, req.ConversationId.Trim(), text, threadType, HttpContext.RequestAborted);
        return new { ok = res.Ok, outboundId = res.OutboundId, status = res.Status, message = res.Message };
    }

    private string WebhookUrlFor(Tenant t)
    {
        var apiBase = (config["Deplao:WebhookBaseUrl"] ?? config["App:PublicApiUrl"] ?? "http://api:8080").TrimEnd('/');
        return $"{apiBase}/api/channels/deplao/{t.Slug}/webhook";
    }

    private object View(Tenant t, List<ChannelConnection> connections, string? provisionStatus = null) => new
    {
        provisionStatus,
        connected = deplaoClient.IsConnected(t),
        platformManaged = deplaoClient.HasPlatformGateway,
        configured = !string.IsNullOrEmpty(t.DeplaoApiKeyEnc) || deplaoClient.HasPlatformGateway,
        baseUrl = deplaoClient.ResolveBaseUrl(t),
        accountId = t.DeplaoAccountId,
        webhookId = t.DeplaoWebhookId,
        hasApiKey = !string.IsNullOrEmpty(t.DeplaoApiKeyEnc),
        hasWebhookSecret = !string.IsNullOrEmpty(t.DeplaoWebhookSecretEnc),
        webhookUrl = WebhookUrlFor(t),
        connections = connections.Select(c => new
        {
            id = c.Id,
            channel = c.Channel.ToString(),
            accountId = c.AccountId,
            accountName = c.AccountName,
            isEnabled = c.IsEnabled,
            allowedThreadIds = string.IsNullOrWhiteSpace(c.AllowedThreadIds)
                ? Array.Empty<string>()
                : c.AllowedThreadIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            createdAt = c.CreatedAt,
        }),
    };
}
