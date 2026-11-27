using System.Globalization;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Infrastructure.Messaging;

public class ZaloOptions
{
    public string ApiBase { get; set; } = "https://openapi.zalo.me";
    public string OAuthBase { get; set; } = "https://oauth.zaloapp.com";
    public string WebBaseUrl { get; set; } = "http://localhost:5173";
}

public static class ZaloSignature
{
    /// <summary>mac = sha256(appId + data + timestamp + OASecretKey), hex lowercase.</summary>
    public static string Compute(string appId, string data, string timestamp, string oaSecretKey)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(appId + data + timestamp + oaSecretKey));
        return Convert.ToHexStringLower(bytes);
    }

    public static bool Verify(string? header, string appId, string data, string timestamp, string oaSecretKey)
    {
        if (string.IsNullOrWhiteSpace(header)) return false;
        var provided = header.Trim();
        if (provided.StartsWith("mac=", StringComparison.OrdinalIgnoreCase)) provided = provided[4..];
        var expected = Compute(appId, data, timestamp, oaSecretKey);
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(provided.ToLowerInvariant()));
    }
}

public class ZaloClient(HttpClient http, IOptions<ZaloOptions> options, ISecretProtector secrets, IAppDbContext db, TimeProvider clock, ILogger<ZaloClient> log)
{
    private readonly ZaloOptions _o = options.Value;

    public bool IsConnected(Tenant t) => !string.IsNullOrEmpty(t.ZaloAccessTokenEnc) && !string.IsNullOrEmpty(t.ZaloOaId);

    public async Task<string?> AccessTokenAsync(Tenant t, CancellationToken ct)
    {
        if (t.ZaloTokenExpiresAt is { } exp && exp < clock.GetUtcNow().AddMinutes(5) && !string.IsNullOrEmpty(t.ZaloRefreshTokenEnc))
            await RefreshAsync(t, ct);
        return secrets.Unprotect(t.ZaloAccessTokenEnc);
    }

    /// <summary>OA token refresh (OAuth v4). Access tokens last ~25h, refresh tokens rotate on every use.</summary>
    public async Task<bool> RefreshAsync(Tenant t, CancellationToken ct)
    {
        var refresh = secrets.Unprotect(t.ZaloRefreshTokenEnc);
        var appSecret = secrets.Unprotect(t.ZaloAppSecretEnc);
        if (string.IsNullOrEmpty(refresh) || string.IsNullOrEmpty(appSecret) || string.IsNullOrEmpty(t.ZaloAppId)) return false;
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_o.OAuthBase}/v4/oa/access_token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["refresh_token"] = refresh, ["app_id"] = t.ZaloAppId, ["grant_type"] = "refresh_token",
            }),
        };
        req.Headers.Add("secret_key", appSecret);
        var resp = await http.SendAsync(req, ct);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
        if (!json.TryGetProperty("access_token", out var at))
        {
            log.LogWarning("Zalo token refresh failed for tenant {Tenant}: {Body}", t.Slug, json.ToString());
            return false;
        }
        t.ZaloAccessTokenEnc = secrets.Protect(at.GetString());
        if (json.TryGetProperty("refresh_token", out var rt)) t.ZaloRefreshTokenEnc = secrets.Protect(rt.GetString());
        var expiresIn = json.TryGetProperty("expires_in", out var ei)
            ? (ei.ValueKind == JsonValueKind.String ? int.Parse(ei.GetString()!, CultureInfo.InvariantCulture) : ei.GetInt32())
            : 90000;
        t.ZaloTokenExpiresAt = clock.GetUtcNow().AddSeconds(expiresIn);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<(bool Ok, string Message)> SendTextAsync(Tenant t, string userId, string text, CancellationToken ct)
    {
        var token = await AccessTokenAsync(t, ct);
        if (string.IsNullOrEmpty(token)) return (false, "Zalo OA is not connected");
        var body = new { recipient = new { user_id = userId }, message = new { text = text.Length > 2000 ? text[..2000] : text } };
        return await PostAsync(token, body, ct);
    }

    public async Task<(bool Ok, string Message)> SendImageAsync(Tenant t, string userId, string imageUrl, string? caption, CancellationToken ct)
    {
        var token = await AccessTokenAsync(t, ct);
        if (string.IsNullOrEmpty(token)) return (false, "Zalo OA is not connected");
        var body = new
        {
            recipient = new { user_id = userId },
            message = new
            {
                text = caption,
                attachment = new { type = "template", payload = new { template_type = "media", elements = new[] { new { media_type = "image", url = imageUrl } } } },
            },
        };
        return await PostAsync(token, body, ct);
    }

    private async Task<(bool, string)> PostAsync(string token, object body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_o.ApiBase}/v3.0/oa/message/cs") { Content = JsonContent.Create(body) };
        req.Headers.Add("access_token", token);
        var resp = await http.SendAsync(req, ct);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
        var error = json.TryGetProperty("error", out var e) ? e.GetInt32() : -1;
        var message = json.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";
        if (error != 0) log.LogWarning("Zalo send failed: {Error} {Message}", error, message);
        return (error == 0, message);
    }
}

/// <summary>Delivers outbound messages for Deplao-compatible channels (Zalo, Facebook, Telegram) and falls back to Zalo OA for Zalo.</summary>
public class DeplaoChannelAdapter(ChannelType channel, ZaloClient zalo, DeplaoClient deplao, IOptions<ZaloOptions> options, ILogger<DeplaoChannelAdapter> log) : IChannelAdapter
{
    public ChannelType Channel => channel;

    public async Task DeliverAsync(Tenant tenant, Conversation conversation, Message message, IReadOnlyList<Card> cards, CancellationToken ct)
    {
        if (message.Role is MessageRole.Guest or MessageRole.Tool) return;
        if (string.IsNullOrEmpty(conversation.ExternalUserId)) return;
        // Simulator conversations are delivered only over SignalR.
        if (conversation.ExternalUserId.StartsWith("sim-")) return;

        var text = (message.Content + RenderCardsAsText(cards, tenant, options.Value.WebBaseUrl, conversation.Language)).Trim();
        var imageUrls = ImagesOf(cards).Where(u => u.StartsWith("http")).Take(3).ToList();

        if (deplao.IsConnected(tenant))
        {
            var fullText = imageUrls.Count > 0 ? $"{text}\n{string.Join("\n", imageUrls)}" : text;
            var res = await deplao.SendDeliveryAsync(tenant, conversation.ExternalAccountId, conversation.ExternalUserId, fullText.Trim(), "user", ct);
            if (!res.Ok) log.LogWarning("Deplao delivery failed for {Channel} conversation {Id}: {Msg}", channel, conversation.Id, res.Message);
            return;
        }

        if (channel != ChannelType.Zalo || !zalo.IsConnected(tenant)) return;

        await zalo.SendTextAsync(tenant, conversation.ExternalUserId, text, ct);
        foreach (var url in imageUrls)
        {
            var (ok, msg) = await zalo.SendImageAsync(tenant, conversation.ExternalUserId, url, null, ct);
            if (!ok) log.LogDebug("Zalo image skipped: {Msg}", msg);
        }
    }

    public static string RenderCardsAsText(IReadOnlyList<Card> cards, Tenant tenant, string webBase, string language = "en")
    {
        var vi = GuestText.IsVietnamese(language);
        var sb = new StringBuilder();
        foreach (var card in cards)
        {
            var d = JsonSerializer.SerializeToElement(card.Data, MessageDto.Json);
            switch (card.Type)
            {
                case "room_card":
                    foreach (var r in d.GetProperty("rooms").EnumerateArray())
                    {
                        var price = r.TryGetProperty("total", out var tot) && tot.ValueKind == JsonValueKind.Number
                            ? (vi ? $"tổng {GuestText.Amount(tot.GetDecimal(), language)}" : $"{GuestText.Amount(tot.GetDecimal(), language)} total")
                            : r.TryGetProperty("nightlyPrice", out var np) && np.ValueKind == JsonValueKind.Number
                                ? (vi ? $"từ {GuestText.Amount(np.GetDecimal(), language)}/đêm" : $"from {GuestText.Amount(np.GetDecimal(), language)}/night")
                                : "";
                        sb.Append($"\n• {r.GetProperty("name").GetString()}");
                        if (price.Length > 0) sb.Append($" · {price}");
                    }
                    break;
                case "quote":
                    var total = GuestText.Amount(d.GetProperty("total").GetDecimal(), language);
                    var deposit = GuestText.Amount(d.GetProperty("deposit").GetDecimal(), language);
                    sb.Append(vi ? $"\nTổng cộng: {total} · Tiền cọc: {deposit}" : $"\nTotal: {total} · Deposit: {deposit}");
                    break;
                case "booking_summary":
                    var rawStatus = d.GetProperty("status").GetString();
                    var statusLabel = Enum.TryParse<BookingStatus>(rawStatus, out var status) ? GuestText.Status(status, language) : rawStatus;
                    sb.Append($"\n{(vi ? "Đặt phòng" : "Booking")} {d.GetProperty("code").GetString()} · {d.GetProperty("roomName").GetString()} · {statusLabel}");
                    break;
                case "payment":
                    var url = d.TryGetProperty("payUrl", out var pu) && pu.ValueKind == JsonValueKind.String ? pu.GetString() : $"{webBase}/h/{tenant.Slug}/manage";
                    var amount = GuestText.Amount(d.GetProperty("amount").GetDecimal(), language);
                    sb.Append(vi ? $"\nThanh toán {amount} qua VNPay: {url}" : $"\nPay {amount} with VNPay: {url}");
                    break;
            }
        }
        return sb.ToString();
    }

    private static IEnumerable<string> ImagesOf(IReadOnlyList<Card> cards)
    {
        foreach (var card in cards)
        {
            var d = JsonSerializer.SerializeToElement(card.Data, MessageDto.Json);
            if (card.Type == "gallery")
                foreach (var p in d.GetProperty("photos").EnumerateArray()) yield return p.GetProperty("url").GetString() ?? "";
            if (card.Type == "room_card")
                foreach (var r in d.GetProperty("rooms").EnumerateArray())
                    if (r.TryGetProperty("coverUrl", out var c) && c.ValueKind == JsonValueKind.String) yield return c.GetString()!;
        }
    }
}
