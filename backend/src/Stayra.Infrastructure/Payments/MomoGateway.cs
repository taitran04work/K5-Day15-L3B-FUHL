using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Stayra.Application.Common;
using Stayra.Application.Payments;
using Stayra.Domain;

namespace Stayra.Infrastructure.Payments;

public class MomoOptions
{
    public string Endpoint { get; set; } = "https://test-payment.momo.vn";
    public string PartnerCode { get; set; } = "";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    /// <summary>Public base URL of the API (for IPN). Use an ngrok URL in development to receive callbacks.</summary>
    public string IpnBaseUrl { get; set; } = "http://localhost:8080";
    /// <summary>Public base URL of the web app (for the redirect after paying).</summary>
    public string ReturnBaseUrl { get; set; } = "http://localhost:5173";
    public bool Offline { get; set; }
}

/// <summary>MoMo "captureWallet" integration (developers.momo.vn, API v2). Signatures are HMAC-SHA256 over alphabetically ordered fields.</summary>
public class MomoGateway(HttpClient http, IOptions<MomoOptions> options, ISecretProtector secrets, ILogger<MomoGateway> log) : IPaymentGateway
{
    private readonly MomoOptions _o = options.Value;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    public GatewayCredentials CredentialsFor(Tenant tenant)
    {
        var access = secrets.Unprotect(tenant.MomoAccessKeyEnc);
        var secret = secrets.Unprotect(tenant.MomoSecretKeyEnc);
        if (!string.IsNullOrEmpty(tenant.MomoPartnerCode) && !string.IsNullOrEmpty(access) && !string.IsNullOrEmpty(secret))
            return new GatewayCredentials(tenant.MomoPartnerCode, access, secret);
        return new GatewayCredentials(_o.PartnerCode, _o.AccessKey, _o.SecretKey);
    }

    public static string Sign(string raw, string secretKey)
    {
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(secretKey));
        return Convert.ToHexStringLower(h.ComputeHash(Encoding.UTF8.GetBytes(raw)));
    }

    public static string CreateRawSignature(string accessKey, long amount, string extraData, string ipnUrl, string orderId,
        string orderInfo, string partnerCode, string redirectUrl, string requestId, string requestType) =>
        $"accessKey={accessKey}&amount={amount}&extraData={extraData}&ipnUrl={ipnUrl}&orderId={orderId}&orderInfo={orderInfo}" +
        $"&partnerCode={partnerCode}&redirectUrl={redirectUrl}&requestId={requestId}&requestType={requestType}";

    /// <summary>IPN / redirect signature: accessKey + the callback fields in alphabetical order.</summary>
    public static string IpnRawSignature(string accessKey, IReadOnlyDictionary<string, string> f)
    {
        string V(string k) => f.TryGetValue(k, out var v) ? v : "";
        return $"accessKey={accessKey}&amount={V("amount")}&extraData={V("extraData")}&message={V("message")}&orderId={V("orderId")}" +
               $"&orderInfo={V("orderInfo")}&orderType={V("orderType")}&partnerCode={V("partnerCode")}&payType={V("payType")}" +
               $"&requestId={V("requestId")}&responseTime={V("responseTime")}&resultCode={V("resultCode")}&transId={V("transId")}";
    }

    public bool VerifyIpn(GatewayCredentials creds, IReadOnlyDictionary<string, string> fields, string signature)
    {
        if (string.IsNullOrEmpty(signature)) return false;
        var expected = Sign(IpnRawSignature(creds.AccessKey, fields), creds.SecretKey);
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(signature.ToLowerInvariant()));
    }

    public async Task<CreatePaymentResult> CreateAsync(GatewayCredentials c, CreatePaymentRequest r, CancellationToken ct = default)
    {
        var ipnUrl = $"{_o.IpnBaseUrl.TrimEnd('/')}/api/payments/momo/ipn";
        var redirectUrl = $"{_o.ReturnBaseUrl.TrimEnd('/')}/pay/return";
        const string requestType = "captureWallet";
        if (_o.Offline || string.IsNullOrEmpty(c.SecretKey))
            return new CreatePaymentResult(false, -1, "MoMo is in offline mode", null, null, null);

        var raw = CreateRawSignature(c.AccessKey, r.Amount, r.ExtraData, ipnUrl, r.OrderId, r.OrderInfo, c.PartnerCode, redirectUrl, r.RequestId, requestType);
        var body = new
        {
            partnerCode = c.PartnerCode,
            partnerName = "Stayra",
            storeId = c.PartnerCode,
            requestId = r.RequestId,
            amount = r.Amount,
            orderId = r.OrderId,
            orderInfo = r.OrderInfo,
            redirectUrl,
            ipnUrl,
            lang = "vi",
            requestType,
            autoCapture = true,
            extraData = r.ExtraData,
            signature = Sign(raw, c.SecretKey),
        };
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(12));
        var resp = await http.PostAsJsonAsync($"{_o.Endpoint}/v2/gateway/api/create", body, Json, cts.Token);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>(cts.Token);
        var code = json.TryGetProperty("resultCode", out var rc) ? rc.GetInt32() : -1;
        var msg = json.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";
        log.LogInformation("MoMo create {OrderId} -> {Code} {Message}", r.OrderId, code, msg);
        return new CreatePaymentResult(code == 0, code, msg, Str(json, "payUrl"), Str(json, "qrCodeUrl"), Str(json, "deeplink"));
    }

    public async Task<QueryPaymentResult> QueryAsync(GatewayCredentials c, string orderId, string requestId, CancellationToken ct = default)
    {
        if (_o.Offline) return new QueryPaymentResult(false, -1, "offline", null);
        var raw = $"accessKey={c.AccessKey}&orderId={orderId}&partnerCode={c.PartnerCode}&requestId={requestId}";
        var body = new { partnerCode = c.PartnerCode, requestId, orderId, lang = "vi", signature = Sign(raw, c.SecretKey) };
        var resp = await http.PostAsJsonAsync($"{_o.Endpoint}/v2/gateway/api/query", body, Json, ct);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
        var code = json.TryGetProperty("resultCode", out var rc) ? rc.GetInt32() : -1;
        long? transId = json.TryGetProperty("transId", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt64() : null;
        return new QueryPaymentResult(code == 0, code, Str(json, "message") ?? "", transId);
    }

    public async Task<RefundResult> RefundAsync(GatewayCredentials c, string orderId, string requestId, long amount, long transId, string description, CancellationToken ct = default)
    {
        if (_o.Offline) return new RefundResult(false, -1, "offline", null);
        var raw = $"accessKey={c.AccessKey}&amount={amount}&description={description}&orderId={orderId}&partnerCode={c.PartnerCode}&requestId={requestId}&transId={transId}";
        var body = new { partnerCode = c.PartnerCode, orderId, requestId, amount, transId, lang = "vi", description, signature = Sign(raw, c.SecretKey) };
        var resp = await http.PostAsJsonAsync($"{_o.Endpoint}/v2/gateway/api/refund", body, Json, ct);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
        var code = json.TryGetProperty("resultCode", out var rc) ? rc.GetInt32() : -1;
        long? tid = json.TryGetProperty("transId", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt64() : null;
        return new RefundResult(code == 0, code, Str(json, "message") ?? "", tid);
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
