using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Application.Payments;
using Stayra.Domain;

namespace Stayra.Infrastructure.Payments;

public record CallbackOutcome(bool SignatureValid, bool Found, PaymentStatus? Status, string? BookingCode, string? TenantSlug, decimal Amount, PaymentKind? Kind);

public class MomoCallbackService(
    IAppDbContext db,
    ITenantContext tenantContext,
    IPaymentGateway gateway,
    PaymentService payments,
    BookingService bookings,
    TimeProvider clock,
    ILogger<MomoCallbackService> log)
{
    /// <summary>Handles both the server IPN and the browser redirect (same signed fields). Idempotent by orderId.</summary>
    public async Task<CallbackOutcome> HandleAsync(IReadOnlyDictionary<string, string> fields, CancellationToken ct = default)
    {
        tenantContext.Set(null, bypass: true);
        var orderId = fields.GetValueOrDefault("orderId") ?? "";
        var payment = await db.Payments.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.OrderId == orderId, ct);
        if (payment == null)
        {
            log.LogWarning("MoMo callback for unknown order {OrderId}", orderId);
            return new CallbackOutcome(false, false, null, null, null, 0, null);
        }
        var tenant = await db.Tenants.FirstAsync(t => t.Id == payment.TenantId, ct);
        var booking = await db.Bookings.IgnoreQueryFilters().FirstAsync(b => b.Id == payment.BookingId, ct);
        var valid = gateway.VerifyIpn(gateway.CredentialsFor(tenant), fields, fields.GetValueOrDefault("signature") ?? "");
        if (!valid)
        {
            log.LogWarning("MoMo callback signature mismatch for {OrderId}", orderId);
            return new CallbackOutcome(false, true, payment.Status, booking.Code, tenant.Slug, payment.Amount, payment.Kind);
        }

        var amountOk = long.TryParse(fields.GetValueOrDefault("amount"), out var amount) && amount == (long)payment.Amount;
        var resultCode = int.TryParse(fields.GetValueOrDefault("resultCode"), out var rc) ? rc : -1;
        long? transId = long.TryParse(fields.GetValueOrDefault("transId"), out var t) ? t : null;
        var raw = JsonSerializer.Serialize(fields);

        if (resultCode == 0 && amountOk) await payments.MarkPaidAsync(payment, transId, raw, bookings, ct);
        else if (resultCode != 0 && resultCode != 9000 && resultCode != 1000 && resultCode != 7000 && resultCode != 7002)
            await payments.MarkFailedAsync(payment, resultCode, fields.GetValueOrDefault("message") ?? "", raw, ct);

        return new CallbackOutcome(true, true, payment.Status, booking.Code, tenant.Slug, payment.Amount, payment.Kind);
    }

    /// <summary>Fallback for missed IPNs: asks MoMo for the status of recent open payments.</summary>
    public async Task<int> ReconcileAsync(CancellationToken ct = default)
    {
        tenantContext.Set(null, bypass: true);
        var now = clock.GetUtcNow();
        var open = await db.Payments.IgnoreQueryFilters()
            .Where(p => p.Status == PaymentStatus.Created && p.Provider == PaymentProvider.MoMo && p.PayUrl != null
                        && p.CreatedAt < now.AddMinutes(-1) && p.CreatedAt > now.AddDays(-2))
            .Take(50).ToListAsync(ct);
        var changed = 0;
        foreach (var p in open)
        {
            try
            {
                var tenant = await db.Tenants.FirstAsync(x => x.Id == p.TenantId, ct);
                var res = await gateway.QueryAsync(gateway.CredentialsFor(tenant), p.OrderId, p.RequestId, ct);
                if (res.ResultCode == 0 && await payments.MarkPaidAsync(p, res.TransId, null, bookings, ct)) changed++;
                else if (p.ExpiresAt is { } exp && exp < now && res.ResultCode != 0)
                {
                    p.Status = PaymentStatus.Expired;
                    await db.SaveChangesAsync(ct);
                }
            }
            catch (Exception ex) { log.LogWarning(ex, "Reconcile failed for {OrderId}", p.OrderId); }
        }
        return changed;
    }

    /// <summary>Development-only: marks a payment paid without contacting MoMo.</summary>
    public async Task<Payment> SimulateSuccessAsync(Guid paymentId, CancellationToken ct = default)
    {
        tenantContext.Set(null, bypass: true);
        var payment = await db.Payments.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == paymentId, ct) ?? throw AppException.NotFound("Payment");
        if (payment.Status is PaymentStatus.Expired or PaymentStatus.Failed) payment.Status = PaymentStatus.Created;
        await payments.MarkPaidAsync(payment, 0, JsonSerializer.Serialize(new { simulated = true, at = clock.GetUtcNow() }), bookings, ct);
        return payment;
    }
}

public class PaymentJobs(MomoCallbackService callbacks)
{
    public Task Reconcile() => callbacks.ReconcileAsync();
}
