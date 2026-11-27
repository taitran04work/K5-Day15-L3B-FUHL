using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Application.Payments;
using Stayra.Domain;

namespace Stayra.Infrastructure.Payments;

public record CallbackOutcome(
    bool SignatureValid,
    bool Found,
    PaymentStatus? Status,
    string? BookingCode,
    string? TenantSlug,
    decimal Amount,
    PaymentKind? Kind,
    string RspCode,
    string RspMessage);

public class VnpayCallbackService(
    IAppDbContext db,
    ITenantContext tenantContext,
    IPaymentGateway gateway,
    PaymentService payments,
    BookingService bookings,
    TimeProvider clock,
    ILogger<VnpayCallbackService> log)
{
    /// <summary>Handles both the VNPay server IPN and the browser return URL (same signed vnp_* query fields). Idempotent by vnp_TxnRef.</summary>
    public async Task<CallbackOutcome> HandleAsync(IReadOnlyDictionary<string, string> fields, CancellationToken ct = default)
    {
        tenantContext.Set(null, bypass: true);
        var orderId = fields.GetValueOrDefault("vnp_TxnRef") ?? "";
        var payment = await db.Payments.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.OrderId == orderId, ct);
        if (payment == null)
        {
            log.LogWarning("VNPay callback for unknown order {OrderId}", orderId);
            return new CallbackOutcome(false, false, null, null, null, 0, null, "01", "Order not found");
        }
        var tenant = await db.Tenants.FirstAsync(t => t.Id == payment.TenantId, ct);
        var booking = await db.Bookings.IgnoreQueryFilters().FirstAsync(b => b.Id == payment.BookingId, ct);
        var valid = gateway.VerifyIpn(gateway.CredentialsFor(tenant), fields, fields.GetValueOrDefault("vnp_SecureHash") ?? "");
        if (!valid)
        {
            log.LogWarning("VNPay callback signature mismatch for {OrderId}", orderId);
            return new CallbackOutcome(false, true, payment.Status, booking.Code, tenant.Slug, payment.Amount, payment.Kind, "97", "Checksum failed");
        }

        var amountOk = long.TryParse(fields.GetValueOrDefault("vnp_Amount"), out var rawAmount) && rawAmount == (long)payment.Amount * 100;
        if (!amountOk)
        {
            log.LogWarning("VNPay callback amount mismatch for {OrderId}: {Amount}", orderId, fields.GetValueOrDefault("vnp_Amount"));
            return new CallbackOutcome(true, true, payment.Status, booking.Code, tenant.Slug, payment.Amount, payment.Kind, "04", "Invalid amount");
        }

        if (payment.Status == PaymentStatus.Paid)
            return new CallbackOutcome(true, true, payment.Status, booking.Code, tenant.Slug, payment.Amount, payment.Kind, "02", "Order already confirmed");

        var responseCode = fields.GetValueOrDefault("vnp_ResponseCode") ?? "";
        var txStatus = fields.GetValueOrDefault("vnp_TransactionStatus") ?? responseCode;
        long? transId = long.TryParse(fields.GetValueOrDefault("vnp_TransactionNo"), out var t) ? t : null;
        var raw = JsonSerializer.Serialize(fields);

        if (responseCode == "00" && txStatus == "00")
            await payments.MarkPaidAsync(payment, transId, raw, bookings, ct);
        else if (!string.IsNullOrEmpty(responseCode) && responseCode != "00")
            await payments.MarkFailedAsync(payment, responseCode, fields.GetValueOrDefault("vnp_OrderInfo") ?? $"VNPay code {responseCode}", raw, ct);

        return new CallbackOutcome(true, true, payment.Status, booking.Code, tenant.Slug, payment.Amount, payment.Kind, "00", "Confirm Success");
    }

    /// <summary>Fallback for missed IPNs: asks VNPay QueryDR for the status of recent open payments.</summary>
    public async Task<int> ReconcileAsync(CancellationToken ct = default)
    {
        tenantContext.Set(null, bypass: true);
        var now = clock.GetUtcNow();
        var open = await db.Payments.IgnoreQueryFilters()
            .Where(p => p.Status == PaymentStatus.Created && p.Provider == PaymentProvider.VNPay && p.PayUrl != null
                        && p.CreatedAt < now.AddMinutes(-1) && p.CreatedAt > now.AddDays(-2))
            .Take(50).ToListAsync(ct);
        var changed = 0;
        foreach (var p in open)
        {
            try
            {
                var tenant = await db.Tenants.FirstAsync(x => x.Id == p.TenantId, ct);
                var res = await gateway.QueryAsync(gateway.CredentialsFor(tenant), p, Guid.NewGuid().ToString("N"), ct);
                if (res.Success && await payments.MarkPaidAsync(p, res.TransId, null, bookings, ct)) changed++;
                else if (p.ExpiresAt is { } exp && exp < now && !res.Success)
                {
                    p.Status = PaymentStatus.Expired;
                    await db.SaveChangesAsync(ct);
                }
            }
            catch (Exception ex) { log.LogWarning(ex, "Reconcile failed for {OrderId}", p.OrderId); }
        }
        return changed;
    }

    /// <summary>Development-only: marks a payment paid without contacting VNPay.</summary>
    public async Task<Payment> SimulateSuccessAsync(Guid paymentId, CancellationToken ct = default)
    {
        tenantContext.Set(null, bypass: true);
        var payment = await db.Payments.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == paymentId, ct) ?? throw AppException.NotFound("Payment");
        if (payment.Status is PaymentStatus.Expired or PaymentStatus.Failed) payment.Status = PaymentStatus.Created;
        await payments.MarkPaidAsync(payment, 0, JsonSerializer.Serialize(new { simulated = true, at = clock.GetUtcNow() }), bookings, ct);
        return payment;
    }
}

public class PaymentJobs(VnpayCallbackService callbacks)
{
    public Task Reconcile() => callbacks.ReconcileAsync();
}
