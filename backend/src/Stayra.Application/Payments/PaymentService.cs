using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Application.Payments;

public record GatewayCredentials(string PartnerCode, string AccessKey, string SecretKey);

public record CreatePaymentRequest(string OrderId, string RequestId, long Amount, string OrderInfo, string ExtraData);
public record CreatePaymentResult(bool Success, int ResultCode, string Message, string? PayUrl, string? QrCodeUrl, string? Deeplink);
public record QueryPaymentResult(bool Success, int ResultCode, string Message, long? TransId);
public record RefundResult(bool Success, int ResultCode, string Message, long? TransId);

public interface IPaymentGateway
{
    Task<CreatePaymentResult> CreateAsync(GatewayCredentials creds, CreatePaymentRequest req, CancellationToken ct = default);
    Task<QueryPaymentResult> QueryAsync(GatewayCredentials creds, string orderId, string requestId, CancellationToken ct = default);
    Task<RefundResult> RefundAsync(GatewayCredentials creds, string orderId, string requestId, long amount, long transId, string description, CancellationToken ct = default);
    bool VerifyIpn(GatewayCredentials creds, IReadOnlyDictionary<string, string> fields, string signature);
    GatewayCredentials CredentialsFor(Tenant tenant);
}

/// <summary>Raised to BookingService so payment logic doesn't depend on booking workflow directly.</summary>
public interface IPaymentEvents
{
    Task OnPaymentPaidAsync(Payment payment, CancellationToken ct);
}

public class PaymentService(IAppDbContext db, IPaymentGateway gateway, TimeProvider clock, ILogger<PaymentService> log)
{
    public async Task<Payment> CreateAsync(Tenant tenant, Booking booking, PaymentKind kind, decimal amount, DateTimeOffset? expiresAt, CancellationToken ct = default)
    {
        if (amount < 1000) throw AppException.BadRequest("amount_too_small", "The amount is too small to pay online.");
        var n = await db.Payments.CountAsync(p => p.BookingId == booking.Id, ct) + 1;
        var payment = new Payment
        {
            TenantId = tenant.Id,
            BookingId = booking.Id,
            Kind = kind,
            Amount = amount,
            Provider = PaymentProvider.MoMo,
            OrderId = $"{booking.Code}-{kind.ToString()[0]}{n}-{Guid.NewGuid().ToString("N")[..6]}",
            RequestId = Guid.NewGuid().ToString("N"),
            ExpiresAt = expiresAt,
        };
        db.Payments.Add(payment);

        var label = kind switch
        {
            PaymentKind.Deposit => "Deposit",
            PaymentKind.Remaining => "Remaining balance",
            PaymentKind.Extra => "Booking change",
            _ => "Payment",
        };
        try
        {
            var res = await gateway.CreateAsync(gateway.CredentialsFor(tenant),
                new CreatePaymentRequest(payment.OrderId, payment.RequestId, (long)amount, $"{label} {booking.Code} - {tenant.Name}", ""), ct);
            payment.PayUrl = res.PayUrl;
            payment.QrCodeUrl = res.QrCodeUrl;
            payment.Deeplink = res.Deeplink;
            payment.Message = res.Message;
            if (!res.Success)
            {
                log.LogWarning("MoMo create failed for {OrderId}: {Code} {Message}", payment.OrderId, res.ResultCode, res.Message);
            }
        }
        catch (Exception ex)
        {
            // Network failure must not lose the booking; the payment stays Created and can be simulated / retried.
            log.LogWarning(ex, "MoMo create threw for {OrderId}", payment.OrderId);
            payment.Message = "Payment provider unreachable";
        }
        await db.SaveChangesAsync(ct);
        return payment;
    }

    /// <summary>Idempotent: marking an already-paid payment again is a no-op. Returns true when the state changed.</summary>
    public async Task<bool> MarkPaidAsync(Payment payment, long? transId, string? rawJson, IPaymentEvents events, CancellationToken ct = default)
    {
        if (payment.Status == PaymentStatus.Paid) return false;
        if (payment.Status is PaymentStatus.Refunded) return false;
        payment.Status = PaymentStatus.Paid;
        payment.TransId = transId;
        payment.PaidAt = clock.GetUtcNow();
        if (rawJson != null) payment.RawCallbackJson = rawJson;

        var booking = await db.Bookings.IgnoreQueryFilters().FirstAsync(b => b.Id == payment.BookingId, ct);
        booking.PaidAmount += payment.Amount;
        await db.SaveChangesAsync(ct);
        await events.OnPaymentPaidAsync(payment, ct);
        return true;
    }

    public async Task MarkFailedAsync(Payment payment, int resultCode, string message, string? rawJson, CancellationToken ct = default)
    {
        if (payment.Status != PaymentStatus.Created) return;
        payment.Status = PaymentStatus.Failed;
        payment.Message = $"{resultCode}: {message}";
        if (rawJson != null) payment.RawCallbackJson = rawJson;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Refunds up to <paramref name="amount"/> across paid MoMo payments (largest first). Returns the amount actually refunded.</summary>
    public async Task<decimal> RefundAsync(Tenant tenant, Booking booking, decimal amount, string reason, CancellationToken ct = default)
    {
        if (amount <= 0) return 0;
        var paid = await db.Payments
            .Where(p => p.BookingId == booking.Id && p.Status == PaymentStatus.Paid && p.Kind != PaymentKind.Refund)
            .OrderByDescending(p => p.Amount).ToListAsync(ct);
        var alreadyRefunded = await db.Payments
            .Where(p => p.BookingId == booking.Id && p.Kind == PaymentKind.Refund && p.Status == PaymentStatus.Refunded)
            .GroupBy(p => p.RefundOfPaymentId).Select(g => new { g.Key, Sum = g.Sum(x => x.Amount) })
            .ToDictionaryAsync(x => x.Key ?? Guid.Empty, x => x.Sum, ct);

        var remaining = amount;
        decimal refunded = 0;
        foreach (var src in paid)
        {
            if (remaining <= 0) break;
            var available = src.Amount - alreadyRefunded.GetValueOrDefault(src.Id);
            if (available <= 0) continue;
            var part = Math.Min(available, remaining);
            var refund = new Payment
            {
                TenantId = tenant.Id,
                BookingId = booking.Id,
                Kind = PaymentKind.Refund,
                Amount = part,
                Provider = src.Provider,
                RefundOfPaymentId = src.Id,
                OrderId = $"{booking.Code}-R-{Guid.NewGuid().ToString("N")[..8]}",
                RequestId = Guid.NewGuid().ToString("N"),
                Message = reason,
            };
            db.Payments.Add(refund);

            var ok = true;
            if (src.Provider == PaymentProvider.MoMo && src.TransId is { } tid && tid > 0)
            {
                try
                {
                    var res = await gateway.RefundAsync(gateway.CredentialsFor(tenant), refund.OrderId, refund.RequestId, (long)part, tid, reason, ct);
                    ok = res.Success;
                    refund.TransId = res.TransId;
                    refund.RawCallbackJson = JsonSerializer.Serialize(res);
                    refund.Message = res.Message;
                }
                catch (Exception ex)
                {
                    log.LogWarning(ex, "MoMo refund failed for {OrderId}", refund.OrderId);
                    ok = false;
                    refund.Message = "Payment provider unreachable — refund manually";
                }
            }
            // Simulated / cash payments (no MoMo transId) are recorded as refunded for the host to settle manually.
            refund.Status = ok ? PaymentStatus.Refunded : PaymentStatus.Failed;
            refund.PaidAt = clock.GetUtcNow();
            if (ok)
            {
                refunded += part;
                remaining -= part;
            }
        }
        booking.RefundAmount += refunded;
        await db.SaveChangesAsync(ct);
        return refunded;
    }

    public async Task ExpireOpenPaymentsAsync(Guid bookingId, CancellationToken ct = default)
    {
        var open = await db.Payments.IgnoreQueryFilters()
            .Where(p => p.BookingId == bookingId && p.Status == PaymentStatus.Created).ToListAsync(ct);
        foreach (var p in open) p.Status = PaymentStatus.Expired;
        await db.SaveChangesAsync(ct);
    }
}
