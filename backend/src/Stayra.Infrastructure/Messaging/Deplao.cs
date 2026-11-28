using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Infrastructure.Messaging;

public class DeplaoOptions
{
    public string DefaultBaseUrl { get; set; } = "http://127.0.0.1:27800/api/v1";
    public string ApiKey { get; set; } = "";
    public string WebhookSecret { get; set; } = "";
    public string WebPassword { get; set; } = "";
}

public record DeplaoAccount(string Id, string Channel, string Name, bool Online, string? Status);
public record DeplaoRecipient(string ThreadId, string DisplayName, string Type, string? Phone);
public record DeplaoDeliveryResult(bool Ok, string? OutboundId, string? Status, string Message);
public record DeplaoWebhookRegistration(bool Ok, string? WebhookId, string Message);

public static class DeplaoSignature
{
    public const int MaxSkewSeconds = 300;

    /// <summary>Computes `v1=&lt;hex HMAC-SHA256(secret, timestamp + "." + rawBody)&gt;`.</summary>
    public static string Compute(string secret, string timestamp, ReadOnlySpan<byte> rawBody)
    {
        var prefix = Encoding.UTF8.GetBytes(timestamp + ".");
        var payload = new byte[prefix.Length + rawBody.Length];
        prefix.CopyTo(payload, 0);
        rawBody.CopyTo(payload.AsSpan(prefix.Length));
        var hash = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), payload);
        return "v1=" + Convert.ToHexStringLower(hash);
    }

    public static bool Verify(string? signatureHeader, string? timestampHeader, ReadOnlySpan<byte> rawBody, string? secret, TimeProvider clock)
    {
        if (string.IsNullOrWhiteSpace(signatureHeader) || string.IsNullOrWhiteSpace(timestampHeader) || string.IsNullOrWhiteSpace(secret))
            return false;
        if (!long.TryParse(timestampHeader.Trim(), out var ts))
            return false;
        if (Math.Abs(clock.GetUtcNow().ToUnixTimeSeconds() - ts) > MaxSkewSeconds)
            return false;

        var expected = Compute(secret, timestampHeader.Trim(), rawBody);
        var provided = signatureHeader.Trim().ToLowerInvariant();
        if (expected.Length != provided.Length) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(provided));
    }
}

public class DeplaoClient(HttpClient http, IOptions<DeplaoOptions> options, ISecretProtector secrets, ILogger<DeplaoClient> log)
{
    public bool HasPlatformGateway => !string.IsNullOrWhiteSpace(options.Value.ApiKey);

    public string ResolveBaseUrl(Tenant t) =>
        NormalizeBaseUrl(!string.IsNullOrWhiteSpace(t.DeplaoBaseUrl) ? t.DeplaoBaseUrl : options.Value.DefaultBaseUrl);

    public string? ResolveApiKey(Tenant t) =>
        !string.IsNullOrWhiteSpace(t.DeplaoApiKeyEnc) ? secrets.Unprotect(t.DeplaoApiKeyEnc) : (string.IsNullOrWhiteSpace(options.Value.ApiKey) ? null : options.Value.ApiKey);

    public string? ResolveWebhookSecret(Tenant? t) =>
        t != null && !string.IsNullOrWhiteSpace(t.DeplaoWebhookSecretEnc)
            ? secrets.Unprotect(t.DeplaoWebhookSecretEnc)
            : (string.IsNullOrWhiteSpace(options.Value.WebhookSecret) ? null : options.Value.WebhookSecret);

    public bool IsConnected(Tenant t) => !string.IsNullOrWhiteSpace(ResolveApiKey(t));

    /// <summary>Automatically provisions a per-tenant Deplao API key and webhook using DEPLAO_WEB_PASSWORD.</summary>
    public async Task<bool> EnsureProvisionedAsync(Tenant t, IAppDbContext db, string? webhookUrl = null, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(t.DeplaoApiKeyEnc)) return true;
        if (string.IsNullOrWhiteSpace(options.Value.WebPassword)) return false;

        var baseUrl = ResolveBaseUrl(t);
        var rootUrl = baseUrl.EndsWith("/api/v1", StringComparison.OrdinalIgnoreCase) ? baseUrl[..^7] : baseUrl;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{rootUrl}/api/browser/provision-key")
            {
                Content = JsonContent.Create(new { tenantSlug = t.Slug }),
            };
            req.Headers.Add("X-Deplao-Admin-Password", options.Value.WebPassword);
            var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var errBody = await resp.Content.ReadAsStringAsync(ct);
                log.LogWarning("Deplao provision-key failed for {Tenant} at {Url}: HTTP {Status} {Body}", t.Slug, rootUrl, (int)resp.StatusCode, errBody);
                return false;
            }
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
            var apiKey = Str(json, "apiKey");
            if (string.IsNullOrWhiteSpace(apiKey)) return false;

            t.DeplaoBaseUrl = baseUrl;
            t.DeplaoApiKeyEnc = secrets.Protect(apiKey);
            if (string.IsNullOrWhiteSpace(t.DeplaoWebhookSecretEnc))
                t.DeplaoWebhookSecretEnc = secrets.Protect("whsec_" + Guid.NewGuid().ToString("N"));
            await db.SaveChangesAsync(ct);

            if (!string.IsNullOrWhiteSpace(webhookUrl) && string.IsNullOrWhiteSpace(t.DeplaoWebhookId))
            {
                var secret = secrets.Unprotect(t.DeplaoWebhookSecretEnc) ?? "";
                var reg = await RegisterOrUpdateWebhookAsync(t, webhookUrl, secret, ct);
                if (reg.Ok && !string.IsNullOrWhiteSpace(reg.WebhookId))
                {
                    t.DeplaoWebhookId = reg.WebhookId;
                    await db.SaveChangesAsync(ct);
                }
            }
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Deplao auto-provision failed for {Tenant} at {Url}", t.Slug, rootUrl);
            return false;
        }
    }

    public static ChannelType? MapChannel(string? raw) => (raw ?? "").Trim().ToLowerInvariant() switch
    {
        "zalo" => ChannelType.Zalo,
        "facebook" or "messenger" => ChannelType.Facebook,
        "telegram" or "telegram_bot" => ChannelType.Telegram,
        _ => null,
    };

    public string NormalizeBaseUrl(string? baseUrl)
    {
        var raw = string.IsNullOrWhiteSpace(baseUrl) ? options.Value.DefaultBaseUrl : baseUrl.Trim();
        raw = raw.TrimEnd('/');
        if (!raw.EndsWith("/api/v1", StringComparison.OrdinalIgnoreCase))
            raw += "/api/v1";
        return raw;
    }

    public async Task<(bool Ok, List<DeplaoAccount> Accounts, string? Error)> GetAccountsAsync(string baseUrl, string apiKey, CancellationToken ct = default)
    {
        try
        {
            var url = $"{NormalizeBaseUrl(baseUrl)}/accounts";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var errBody = await resp.Content.ReadAsStringAsync(ct);
                return (false, [], $"HTTP {(int)resp.StatusCode}: {errBody}");
            }
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
            var list = new List<DeplaoAccount>();
            var arr = json.ValueKind == JsonValueKind.Array
                ? json
                : json.TryGetProperty("accounts", out var a) && a.ValueKind == JsonValueKind.Array
                    ? a
                    : json.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Array
                        ? d
                        : default;
            if (arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in arr.EnumerateArray())
                {
                    var id = Str(item, "id") ?? Str(item, "account_id") ?? "";
                    if (string.IsNullOrEmpty(id)) continue;
                    var channel = Str(item, "channel") ?? "zalo";
                    var name = Str(item, "name") ?? Str(item, "display_name") ?? id;
                    var status = Str(item, "status");
                    var online = item.TryGetProperty("online", out var on) && on.ValueKind == JsonValueKind.True
                        || string.Equals(status, "online", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(status, "connected", StringComparison.OrdinalIgnoreCase);
                    list.Add(new DeplaoAccount(id, channel, name, online, status));
                }
            }
            return (true, list, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Deplao GetAccounts failed for {Url}", baseUrl);
            return (false, [], ex.Message);
        }
    }

    public async Task<DeplaoDeliveryResult> SendDeliveryAsync(Tenant t, string? accountId, string conversationId, string text, string threadType = "user", CancellationToken ct = default)
    {
        var apiKey = ResolveApiKey(t);
        if (string.IsNullOrWhiteSpace(apiKey))
            return new(false, null, null, "Deplao T123 is not connected.");

        var baseUrl = ResolveBaseUrl(t);
        var resolvedAccount = !string.IsNullOrWhiteSpace(accountId) ? accountId : t.DeplaoAccountId;
        if (string.IsNullOrWhiteSpace(resolvedAccount))
        {
            var (ok, accounts, _) = await GetAccountsAsync(baseUrl, apiKey, ct);
            if (ok)
            {
                var zaloAcc = accounts.FirstOrDefault(a => a.Online) ?? accounts.FirstOrDefault();
                resolvedAccount = zaloAcc?.Id;
            }
        }
        if (string.IsNullOrWhiteSpace(resolvedAccount))
            return new(false, null, null, "No Zalo account configured in Deplao T123.");

        var outboundId = $"stayra-{Guid.NewGuid():N}";
        var body = new
        {
            outbound_id = outboundId,
            account_id = resolvedAccount,
            conversation_id = conversationId,
            text = text.Length > 2000 ? text[..2000] : text,
            thread_type = threadType,
        };

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/deliveries") { Content = JsonContent.Create(body) };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            var resp = await http.SendAsync(req, ct);
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                log.LogWarning("Deplao delivery failed ({Status}): {Body}", (int)resp.StatusCode, raw);
                return new(false, outboundId, "FAILED", $"Deplao HTTP {(int)resp.StatusCode}: {raw}");
            }
            string? status = "PENDING";
            try
            {
                var json = JsonSerializer.Deserialize<JsonElement>(raw);
                status = Str(json, "status") ?? (json.TryGetProperty("delivery", out var dlv) ? Str(dlv, "status") : null) ?? "PENDING";
            }
            catch (JsonException) { }
            return new(true, outboundId, status, "Queued in Deplao T123");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Deplao delivery request error");
            return new(false, outboundId, "FAILED", ex.Message);
        }
    }

    public async Task<DeplaoWebhookRegistration> RegisterOrUpdateWebhookAsync(Tenant t, string webhookUrl, string secret, CancellationToken ct = default)
    {
        var apiKey = ResolveApiKey(t);
        if (string.IsNullOrWhiteSpace(apiKey))
            return new(false, null, "Deplao T123 is not connected.");

        var baseUrl = ResolveBaseUrl(t);
        var events = new[] { "message.received", "message.sent" };

        try
        {
            // Reuse a subscription that already points at this URL (its id may never have been stored) and drop
            // duplicates — each extra subscription would deliver every guest message again.
            if (string.IsNullOrWhiteSpace(t.DeplaoWebhookId))
            {
                var existing = await ListWebhookIdsForUrlAsync(baseUrl, apiKey, webhookUrl, ct);
                if (existing.Count > 0)
                {
                    t.DeplaoWebhookId = existing[0];
                    foreach (var dup in existing.Skip(1))
                    {
                        using var del = new HttpRequestMessage(HttpMethod.Delete, $"{baseUrl}/webhooks/{Uri.EscapeDataString(dup)}");
                        del.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                        await http.SendAsync(del, ct);
                    }
                }
            }

            if (!string.IsNullOrWhiteSpace(t.DeplaoWebhookId))
            {
                var patchBody = new
                {
                    name = $"Stayra ({t.Slug})",
                    url = webhookUrl,
                    events,
                    active = true,
                    account_ids = string.IsNullOrWhiteSpace(t.DeplaoAccountId) ? null : new[] { t.DeplaoAccountId },
                };
                using var patchReq = new HttpRequestMessage(HttpMethod.Patch, $"{baseUrl}/webhooks/{Uri.EscapeDataString(t.DeplaoWebhookId)}")
                {
                    Content = JsonContent.Create(patchBody),
                };
                patchReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                var patchResp = await http.SendAsync(patchReq, ct);
                if (patchResp.IsSuccessStatusCode)
                    return new(true, t.DeplaoWebhookId, "Webhook updated on Deplao T123.");
            }

            var createBody = new
            {
                name = $"Stayra ({t.Slug})",
                url = webhookUrl,
                events,
                secret,
                account_ids = string.IsNullOrWhiteSpace(t.DeplaoAccountId) ? null : new[] { t.DeplaoAccountId },
            };
            using var createReq = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/webhooks")
            {
                Content = JsonContent.Create(createBody),
            };
            createReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            var createResp = await http.SendAsync(createReq, ct);
            var raw = await createResp.Content.ReadAsStringAsync(ct);
            if (!createResp.IsSuccessStatusCode)
                return new(false, null, $"Deplao HTTP {(int)createResp.StatusCode}: {raw}");

            var json = JsonSerializer.Deserialize<JsonElement>(raw);
            // Deplao wraps responses as { data: { id, ... } }
            var payload = json.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object ? d : json;
            var id = Str(payload, "id") ?? (payload.TryGetProperty("webhook", out var wh) ? Str(wh, "id") : null);
            return new(true, id, "Webhook registered on Deplao T123.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Deplao webhook registration failed");
            return new(false, null, ex.Message);
        }
    }

    /// <summary>Ids of this key's webhook subscriptions whose url equals <paramref name="url"/>.</summary>
    private async Task<List<string>> ListWebhookIdsForUrlAsync(string baseUrl, string apiKey, string url, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/webhooks");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        var resp = await http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode) return [];
        var json = JsonSerializer.Deserialize<JsonElement>(await resp.Content.ReadAsStringAsync(ct));
        var list = json.ValueKind == JsonValueKind.Array ? json
            : json.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Array ? d
            : json.TryGetProperty("data", out var d2) && d2.ValueKind == JsonValueKind.Object && d2.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array ? items
            : default;
        if (list.ValueKind != JsonValueKind.Array) return [];
        return list.EnumerateArray()
            .Where(w => string.Equals(Str(w, "url")?.TrimEnd('/'), url.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
            .Select(w => Str(w, "id"))
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id!)
            .ToList();
    }

    public async Task<(bool Ok, string? TempId, bool Forbidden, string? Error)> StartZaloQrAsync(Tenant t, CancellationToken ct = default)
    {
        var apiKey = ResolveApiKey(t);
        if (string.IsNullOrWhiteSpace(apiKey)) return (false, null, false, "Deplao API key is not configured.");
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{ResolveBaseUrl(t)}/accounts/zalo/qr")
            {
                Content = JsonContent.Create(new { }),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            var resp = await http.SendAsync(req, ct);
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if ((int)resp.StatusCode is 401 or 403) return (false, null, true, raw);
            if (!resp.IsSuccessStatusCode) return (false, null, false, $"HTTP {(int)resp.StatusCode}: {raw}");
            var json = JsonSerializer.Deserialize<JsonElement>(raw);
            var payload = json.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object ? d : json;
            return (true, Str(payload, "temp_id"), false, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "StartZaloQrAsync failed");
            return (false, null, false, ex.Message);
        }
    }

    public async Task<(bool Ok, string Status, string? QrDataUrl, string? Message, string? AccountId, string? AccountName, string? Error)> GetZaloQrStatusAsync(Tenant t, string tempId, CancellationToken ct = default)
    {
        var apiKey = ResolveApiKey(t);
        if (string.IsNullOrWhiteSpace(apiKey)) return (false, "error", null, null, null, null, "Deplao API key is not configured.");
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"{ResolveBaseUrl(t)}/accounts/zalo/qr/{Uri.EscapeDataString(tempId)}");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            var resp = await http.SendAsync(req, ct);
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode) return (false, "error", null, null, null, null, $"HTTP {(int)resp.StatusCode}: {raw}");
            var json = JsonSerializer.Deserialize<JsonElement>(raw);
            var payload = json.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object ? d : json;
            return (
                true,
                Str(payload, "status") ?? "waiting",
                Str(payload, "qr_data_url"),
                Str(payload, "message"),
                Str(payload, "account_id"),
                Str(payload, "account_name"),
                null
            );
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "GetZaloQrStatusAsync failed");
            return (false, "error", null, null, null, null, ex.Message);
        }
    }

    public async Task AbortZaloQrAsync(Tenant t, string tempId, CancellationToken ct = default)
    {
        var apiKey = ResolveApiKey(t);
        if (string.IsNullOrWhiteSpace(apiKey)) return;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{ResolveBaseUrl(t)}/accounts/zalo/qr/{Uri.EscapeDataString(tempId)}/abort")
            {
                Content = JsonContent.Create(new { }),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            await http.SendAsync(req, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogDebug(ex, "AbortZaloQrAsync failed");
        }
    }

    public async Task<(bool Ok, List<DeplaoRecipient> Recipients, bool NeedsReauth, string? Error)> GetRecipientsAsync(Tenant t, string accountId, CancellationToken ct = default)
    {
        var apiKey = ResolveApiKey(t);
        if (string.IsNullOrWhiteSpace(apiKey)) return (false, [], false, "Deplao API key is not configured.");
        try
        {
            var url = $"{ResolveBaseUrl(t)}/accounts/{Uri.EscapeDataString(accountId)}/conversations?limit=50";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            var resp = await http.SendAsync(req, ct);
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if ((int)resp.StatusCode is 401 or 403) return (false, [], true, raw);
            if (!resp.IsSuccessStatusCode) return (false, [], false, $"HTTP {(int)resp.StatusCode}: {raw}");

            var json = JsonSerializer.Deserialize<JsonElement>(raw);
            var list = new List<DeplaoRecipient>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            void ParseArray(JsonElement rootEl, string? defaultType = null)
            {
                JsonElement arr = default;
                if (rootEl.ValueKind == JsonValueKind.Array) arr = rootEl;
                else if (rootEl.TryGetProperty("data", out var d))
                {
                    if (d.ValueKind == JsonValueKind.Array) arr = d;
                    else if (d.ValueKind == JsonValueKind.Object && d.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array) arr = items;
                }
                else if (rootEl.TryGetProperty("items", out var items2) && items2.ValueKind == JsonValueKind.Array) arr = items2;

                if (arr.ValueKind != JsonValueKind.Array) return;
                foreach (var item in arr.EnumerateArray())
                {
                    var tid = Str(item, "thread_id") ?? Str(item, "group_id") ?? Str(item, "id");
                    if (string.IsNullOrWhiteSpace(tid) || !seen.Add(tid)) continue;
                    var name = Str(item, "display_name") ?? Str(item, "name") ?? tid;
                    var type = Str(item, "type") ?? defaultType ?? "user";
                    var phone = Str(item, "phone");
                    list.Add(new DeplaoRecipient(tid, string.IsNullOrWhiteSpace(name) ? tid : name, type, phone));
                }
            }

            ParseArray(json);

            // Also fetch groups so Zalo groups always appear even if not in recent 50 conversations
            try
            {
                using var grpReq = new HttpRequestMessage(HttpMethod.Get, $"{ResolveBaseUrl(t)}/accounts/{Uri.EscapeDataString(accountId)}/groups?limit=50");
                grpReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                var grpResp = await http.SendAsync(grpReq, ct);
                if (grpResp.IsSuccessStatusCode)
                {
                    var grpJson = await grpResp.Content.ReadFromJsonAsync<JsonElement>(ct);
                    ParseArray(grpJson, "group");
                }
            }
            catch { /* ignore group fetch fallback */ }

            return (true, list, false, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "GetRecipientsAsync failed");
            return (false, [], false, ex.Message);
        }
    }

    private static string? Str(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
