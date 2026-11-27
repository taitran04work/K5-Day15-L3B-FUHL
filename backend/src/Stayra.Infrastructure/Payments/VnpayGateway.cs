using System.Globalization;
using System.Net;
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

public class VnpayOptions
{
    public string PayUrl { get; set; } = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
    public string ApiUrl { get; set; } = "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction";
    public string TmnCode { get; set; } = "";
    public string HashSecret { get; set; } = "";
    /// <summary>Public base URL of the API (for IPN). Use an ngrok URL in development to receive callbacks.</summary>
    public string IpnBaseUrl { get; set; } = "http://localhost:8080";
    /// <summary>Public base URL of the web app (for the redirect after paying).</summary>
    public string ReturnBaseUrl { get; set; } = "http://localhost:5173";
    public bool Offline { get; set; }
}

/// <summary>VNPay Gateway v2.1.0 integration (sandbox.vnpayment.vn). Signatures are HMAC-SHA512.</summary>
public class VnpayGateway(HttpClient http, IOptions<VnpayOptions> options, ISecretProtector secrets, ILogger<VnpayGateway> log) : IPaymentGateway
{
    private readonly VnpayOptions _o = options.Value;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    public GatewayCredentials CredentialsFor(Tenant tenant)
    {
        var secret = secrets.Unprotect(tenant.VnpayHashSecretEnc);
        if (!string.IsNullOrEmpty(tenant.VnpayTmnCode) && !string.IsNullOrEmpty(secret))
            return new GatewayCredentials(tenant.VnpayTmnCode, secret);
        return new GatewayCredentials(_o.TmnCode, _o.HashSecret);
    }

    public static string Sign(string raw, string hashSecret)
    {
        using var h = new HMACSHA512(Encoding.UTF8.GetBytes(hashSecret));
        return Convert.ToHexStringLower(h.ComputeHash(Encoding.UTF8.GetBytes(raw)));
    }

    /// <summary>Builds the canonical VNPay query string sorted alphabetically by key using form URL encoding.</summary>
    public static string BuildQueryData(IEnumerable<KeyValuePair<string, string>> fields) =>
        string.Join("&", fields
            .Where(kv => kv.Key.StartsWith("vnp_", StringComparison.Ordinal)
                      && kv.Key != "vnp_SecureHash"
                      && kv.Key != "vnp_SecureHashType"
                      && !string.IsNullOrEmpty(kv.Value))
            .OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => $"{WebUtility.UrlEncode(kv.Key)}={WebUtility.UrlEncode(kv.Value)}"));

    public bool VerifyIpn(GatewayCredentials creds, IReadOnlyDictionary<string, string> fields, string signature)
    {
        if (string.IsNullOrEmpty(signature) || string.IsNullOrEmpty(creds.HashSecret)) return false;
        var expected = Sign(BuildQueryData(fields), creds.HashSecret);
        var actual = signature.Trim().ToLowerInvariant();
        if (expected.Length != actual.Length) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(actual));
    }

    public Task<CreatePaymentResult> CreateAsync(GatewayCredentials c, CreatePaymentRequest r, CancellationToken ct = default)
    {
        if (_o.Offline || string.IsNullOrEmpty(c.TmnCode) || string.IsNullOrEmpty(c.HashSecret))
            return Task.FromResult(new CreatePaymentResult(false, "offline", "VNPay is in offline mode", null, null, null));

        var returnUrl = $"{_o.ReturnBaseUrl.TrimEnd('/')}/pay/return";
        var fields = new Dictionary<string, string>
        {
            ["vnp_Version"] = "2.1.0",
            ["vnp_Command"] = "pay",
            ["vnp_TmnCode"] = c.TmnCode,
            ["vnp_Amount"] = (r.Amount * 100).ToString(CultureInfo.InvariantCulture),
            ["vnp_CurrCode"] = "VND",
            ["vnp_TxnRef"] = r.OrderId,
            ["vnp_OrderInfo"] = r.OrderInfo,
            ["vnp_OrderType"] = "other",
            ["vnp_Locale"] = "vn",
            ["vnp_ReturnUrl"] = returnUrl,
            ["vnp_IpAddr"] = NormalizeIp(r.IpAddr),
            ["vnp_CreateDate"] = VnTime(r.CreatedAt),
        };
        if (r.ExpiresAt is { } exp) fields["vnp_ExpireDate"] = VnTime(exp);

        var query = BuildQueryData(fields);
        var hash = Sign(query, c.HashSecret);
        var payUrl = $"{_o.PayUrl.TrimEnd('?')}?{query}&vnp_SecureHash={hash}";
        log.LogInformation("VNPay create {OrderId} -> URL generated", r.OrderId);
        return Task.FromResult(new CreatePaymentResult(true, "00", "OK", payUrl, null, null));
    }

    public async Task<QueryPaymentResult> QueryAsync(GatewayCredentials c, Payment payment, string requestId, CancellationToken ct = default)
    {
        if (_o.Offline || string.IsNullOrEmpty(c.TmnCode) || string.IsNullOrEmpty(c.HashSecret))
            return new QueryPaymentResult(false, "offline", "offline", null);

        var txDate = VnTime(payment.CreatedAt);
        var createDate = VnTime(DateTimeOffset.UtcNow);
        const string ip = "127.0.0.1";
        var orderInfo = $"Query {payment.OrderId}";
        var raw = string.Join("|", requestId, "2.1.0", "querydr", c.TmnCode, payment.OrderId, txDate, createDate, ip, orderInfo);
        var body = new
        {
            vnp_RequestId = requestId,
            vnp_Version = "2.1.0",
            vnp_Command = "querydr",
            vnp_TmnCode = c.TmnCode,
            vnp_TxnRef = payment.OrderId,
            vnp_OrderInfo = orderInfo,
            vnp_TransactionDate = txDate,
            vnp_CreateDate = createDate,
            vnp_IpAddr = ip,
            vnp_SecureHash = Sign(raw, c.HashSecret),
        };
        var resp = await http.PostAsJsonAsync(_o.ApiUrl, body, Json, ct);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
        var code = Str(json, "vnp_ResponseCode") ?? "-1";
        var txStatus = Str(json, "vnp_TransactionStatus") ?? "";
        var msg = Str(json, "vnp_Message") ?? "";
        long? transId = long.TryParse(Str(json, "vnp_TransactionNo"), out var t) ? t : null;
        return new QueryPaymentResult(code == "00" && txStatus == "00", code, msg, transId);
    }

    public async Task<RefundResult> RefundAsync(GatewayCredentials c, Payment originalPayment, Payment refundPayment, long amount, string description, CancellationToken ct = default)
    {
        if (_o.Offline || string.IsNullOrEmpty(c.TmnCode) || string.IsNullOrEmpty(c.HashSecret))
            return new RefundResult(false, "offline", "offline", null);

        var txType = amount < (long)originalPayment.Amount ? "03" : "02";
        var vnpAmount = (amount * 100).ToString(CultureInfo.InvariantCulture);
        var txNo = (originalPayment.TransId ?? 0).ToString(CultureInfo.InvariantCulture);
        var txDate = VnTime(originalPayment.PaidAt ?? originalPayment.CreatedAt);
        var createDate = VnTime(DateTimeOffset.UtcNow);
        const string createBy = "Stayra";
        const string ip = "127.0.0.1";
        var raw = string.Join("|", refundPayment.RequestId, "2.1.0", "refund", c.TmnCode, txType, originalPayment.OrderId, vnpAmount, txNo, txDate, createBy, createDate, ip, description);
        var body = new
        {
            vnp_RequestId = refundPayment.RequestId,
            vnp_Version = "2.1.0",
            vnp_Command = "refund",
            vnp_TmnCode = c.TmnCode,
            vnp_TransactionType = txType,
            vnp_TxnRef = originalPayment.OrderId,
            vnp_Amount = vnpAmount,
            vnp_OrderInfo = description,
            vnp_TransactionNo = txNo,
            vnp_TransactionDate = txDate,
            vnp_CreateBy = createBy,
            vnp_CreateDate = createDate,
            vnp_IpAddr = ip,
            vnp_SecureHash = Sign(raw, c.HashSecret),
        };
        var resp = await http.PostAsJsonAsync(_o.ApiUrl, body, Json, ct);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
        var code = Str(json, "vnp_ResponseCode") ?? "-1";
        var msg = Str(json, "vnp_Message") ?? "";
        long? tid = long.TryParse(Str(json, "vnp_TransactionNo"), out var t) ? t : null;
        return new RefundResult(code == "00", code, msg, tid);
    }

    private static string VnTime(DateTimeOffset dt) => dt.ToOffset(TimeSpan.FromHours(7)).ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);

    private static string NormalizeIp(string? ip) =>
        string.IsNullOrWhiteSpace(ip) || ip.Contains(':') ? "127.0.0.1" : ip;

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) ? v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetRawText(),
            _ => null,
        } : null;
}
