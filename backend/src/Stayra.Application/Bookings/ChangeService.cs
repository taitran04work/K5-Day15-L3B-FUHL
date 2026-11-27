using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stayra.Application.Common;
using Stayra.Application.Payments;
using Stayra.Application.Pricing;
using Stayra.Application.Refunds;
using Stayra.Domain;

namespace Stayra.Application.Bookings;

public record ChangeQuote(
    bool Available,
    string? UnavailableReason,
    Guid RoomId,
    string RoomName,
    DateTimeOffset StartAt,
    DateTimeOffset EndAt,
    decimal OldTotal,
    decimal NewTotal,
    decimal PriceDiff,
    decimal AmountToPay,
    decimal AmountToRefund,
    decimal CreditAmount,
    bool RequiresApproval,
    string Explanation,
    Quote? Quote);

public record ChangePayload(Guid RoomId, BookingMode Mode, string Start, string End, int Guests);

public record ChangeOutcome(BookingChangeRequest Request, Booking Booking, Payment? ExtraPayment, decimal Refunded, string Message);

public class ChangeService(
    IAppDbContext db,
    BookingService bookings,
    PricingService pricing,
    PaymentService payments,
    AuditService audit,
    IRealtimeNotifier realtime,
    IBookingConflictDetector conflicts,
    TimeProvider clock)
{
    public Task<RefundPolicy?> ActivePolicyAsync(Guid tenantId, CancellationToken ct = default) =>
        db.RefundPolicies.Where(p => p.TenantId == tenantId && p.Status == RefundPolicyStatus.Active)
            .OrderByDescending(p => p.Version).FirstOrDefaultAsync(ct);

    // ---------- Change room / dates ----------

    public async Task<ChangeQuote> QuoteChangeAsync(Tenant tenant, Booking booking, Guid? newRoomId, Stay? newStay, int? guests, CancellationToken ct = default, string? language = null)
    {
        language ??= await bookings.GuestLanguageAsync(tenant, booking, ct);
        var vi = GuestText.IsVietnamese(language);
        EnsureModifiable(booking, language);
        var roomId = newRoomId ?? booking.RoomId;
        var room = await db.Rooms.FirstOrDefaultAsync(r => r.Id == roomId && r.TenantId == tenant.Id && r.IsActive, ct) ?? throw AppException.NotFound("Room");
        var stay = newStay ?? Stay.FromBooking(tenant, booking);
        if (stay.Mode == BookingMode.Nightly && !room.SupportsNightly && newStay == null && booking.Mode == BookingMode.Nightly)
            throw AppException.BadRequest("mode_not_supported", vi ? $"Phòng {room.Name} không nhận đặt theo đêm." : $"{room.Name} can't be booked by the night.");

        var quote = PricingService.Quote(tenant, room, await pricing.RulesFor(tenant.Id, ct), stay, guests ?? booking.Guests);
        if (quote.StartAt < clock.GetUtcNow()) throw AppException.BadRequest("in_the_past", vi ? "Thời gian mới đã qua." : "The new time is in the past.");
        var blocked = Availability.BlockedUntil(tenant, stay.Mode, quote.EndAt);
        var available = await bookings.IsAvailableAsync(room.Id, quote.StartAt, blocked, booking.Id, ct);

        var diff = quote.Total - booking.TotalAmount;
        var netPaid = booking.PaidAmount - booking.RefundAmount;
        var overpaid = Math.Max(0, netPaid - quote.Total);
        decimal toPay = 0, toRefund = 0, credit = 0;
        // Guests who already paid beyond the deposit settle a price increase now.
        if (diff > 0 && netPaid > booking.DepositAmount) toPay = diff;
        if (diff < 0 && overpaid > 0)
        {
            if (tenant.LowerPriceHandling == LowerPriceHandling.Refund) toRefund = overpaid;
            else credit = overpaid;
        }

        return new ChangeQuote(available, available ? null : vi ? "Phòng này đã có khách đặt trong thời gian bạn chọn." : "That room is already booked for those dates.",
            room.Id, room.Name, quote.StartAt, quote.EndAt, booking.TotalAmount, quote.Total, diff, toPay, toRefund, credit,
            !tenant.AutoApproveChanges, DescribePriceChange(diff, toPay, toRefund, credit, language), quote);
    }

    private static string DescribePriceChange(decimal diff, decimal toPay, decimal toRefund, decimal credit, string language)
    {
        var difference = GuestText.Amount(Math.Abs(diff), language);
        if (GuestText.IsVietnamese(language))
        {
            if (diff > 0)
                return toPay > 0
                    ? $"Kỳ lưu trú mới đắt hơn {difference}. Bạn sẽ nhận được liên kết VNPay để thanh toán phần chênh lệch."
                    : $"Kỳ lưu trú mới đắt hơn {difference}. Khoản chênh lệch được cộng vào số tiền còn phải thanh toán.";
            if (diff == 0) return "Giá không thay đổi.";
            var lowerPrice = $"Kỳ lưu trú mới rẻ hơn {difference}.";
            if (toRefund > 0) return $"{lowerPrice} Bạn sẽ được hoàn lại {GuestText.Amount(toRefund, language)} qua VNPay.";
            if (credit > 0) return $"{lowerPrice} Khoản {GuestText.Amount(credit, language)} sẽ được giữ lại để cấn trừ vào kỳ lưu trú.";
            return $"{lowerPrice} Số tiền còn phải thanh toán giảm tương ứng.";
        }

        if (diff > 0)
            return toPay > 0
                ? $"The new stay costs {difference} more. You'll get a VNPay link to pay the difference."
                : $"The new stay costs {difference} more. This is added to your remaining balance.";
        if (diff == 0) return "The price stays the same.";
        var cheaperStay = $"The new stay costs {difference} less.";
        if (toRefund > 0) return $"{cheaperStay} {GuestText.Amount(toRefund, language)} you've already paid will be refunded to VNPay.";
        if (credit > 0) return $"{cheaperStay} {GuestText.Amount(credit, language)} will be kept as credit for your stay.";
        return $"{cheaperStay} Your remaining balance goes down accordingly.";
    }

    public async Task<ChangeOutcome> RequestChangeAsync(Tenant tenant, Booking booking, Guid? newRoomId, Stay? newStay, int? guests, string actor, string? reason,
        CancellationToken ct = default, string? language = null)
    {
        language ??= await bookings.GuestLanguageAsync(tenant, booking, ct);
        var q = await QuoteChangeAsync(tenant, booking, newRoomId, newStay, guests, ct, language);
        if (!q.Available) throw new RoomUnavailableException(q.UnavailableReason!);
        var stay = newStay ?? Stay.FromBooking(tenant, booking);
        var payload = new ChangePayload(q.RoomId, stay.Mode,
            stay.Mode == BookingMode.Nightly ? stay.CheckIn.ToString("yyyy-MM-dd") : stay.StartLocal.ToString("yyyy-MM-ddTHH:mm"),
            stay.Mode == BookingMode.Nightly ? stay.CheckOut.ToString("yyyy-MM-dd") : stay.EndLocal.ToString("yyyy-MM-ddTHH:mm"),
            guests ?? booking.Guests);

        var req = new BookingChangeRequest
        {
            TenantId = tenant.Id,
            BookingId = booking.Id,
            Type = q.RoomId != booking.RoomId ? ChangeRequestType.ChangeRoom : ChangeRequestType.ChangeDates,
            PayloadJson = JsonSerializer.Serialize(payload, AuditService.Json),
            PriceDiff = q.PriceDiff,
            RefundQuote = q.AmountToRefund,
            Explanation = q.Explanation,
            Reason = reason,
        };
        db.ChangeRequests.Add(req);
        audit.Log(tenant.Id, actor, "change.requested", nameof(BookingChangeRequest), req.Id, payload);
        await db.SaveChangesAsync(ct);

        if (!tenant.AutoApproveChanges)
        {
            await realtime.BookingChanged(tenant.Id, booking.Id);
            return new ChangeOutcome(req, booking, null, 0, GuestText.IsVietnamese(language)
                ? "Yêu cầu thay đổi của bạn đã được gửi cho chủ nhà duyệt. Chúng tôi sẽ nhắn cho bạn ngay khi có phản hồi."
                : "Your change request was sent to the host for approval. We'll message you as soon as they respond.");
        }
        return await ApplyChangeAsync(tenant, req, booking, Actors.System, auto: true, ct, language);
    }

    public async Task<ChangeOutcome> ApplyChangeAsync(Tenant tenant, BookingChangeRequest req, Booking booking, string actor, bool auto,
        CancellationToken ct = default, string? language = null)
    {
        language ??= await bookings.GuestLanguageAsync(tenant, booking, ct);
        var p = JsonSerializer.Deserialize<ChangePayload>(req.PayloadJson, AuditService.Json)!;
        var stay = Stay.Parse(p.Mode, p.Start, p.End);
        var q = await QuoteChangeAsync(tenant, booking, p.RoomId, stay, p.Guests, ct, language);
        if (!q.Available) throw new RoomUnavailableException(q.UnavailableReason!);

        var old = new { booking.RoomId, booking.StartAt, booking.EndAt, booking.TotalAmount };
        booking.RoomId = q.RoomId;
        booking.Mode = stay.Mode;
        booking.StartAt = q.StartAt;
        booking.EndAt = q.EndAt;
        booking.BlockedUntil = Availability.BlockedUntil(tenant, stay.Mode, q.EndAt);
        booking.Guests = p.Guests;
        booking.TotalAmount = q.NewTotal;
        booking.PriceBreakdownJson = JsonSerializer.Serialize(q.Quote, AuditService.Json);
        booking.CreditAmount += q.CreditAmount;
        req.Status = auto ? ChangeRequestStatus.Auto : ChangeRequestStatus.Approved;
        req.DecidedBy = actor;
        req.DecidedAt = clock.GetUtcNow();
        audit.Log(tenant.Id, actor, "booking.changed", nameof(Booking), booking.Id, new { Old = old, New = new { booking.RoomId, booking.StartAt, booking.EndAt, booking.TotalAmount } });
        try { await db.SaveChangesAsync(ct); }
        catch (Exception ex) when (conflicts.IsOverlapViolation(ex))
        {
            throw GuestText.IsVietnamese(language)
                ? new RoomUnavailableException("Phòng vừa có khách đặt cho những ngày đó. Vui lòng chọn ngày hoặc phòng khác.")
                : new RoomUnavailableException();
        }

        Payment? extra = null;
        decimal refunded = 0;
        if (q.AmountToPay >= 1000) extra = await payments.CreateAsync(tenant, booking, PaymentKind.Extra, q.AmountToPay, null, ct);
        if (q.AmountToRefund > 0) refunded = await payments.RefundAsync(tenant, booking, q.AmountToRefund, $"Price difference after change {booking.Code}", ct);
        if (booking.Status == BookingStatus.Confirmed) bookings.ScheduleRemaining(tenant, booking);
        await db.SaveChangesAsync(ct);

        var room = await db.Rooms.FirstAsync(r => r.Id == booking.RoomId, ct);
        string Message(string recipientLanguage)
        {
            var summary = GuestText.IsVietnamese(recipientLanguage)
                ? $"Đặt phòng {booking.Code} đã được cập nhật: {room.Name}."
                : $"Booking {booking.Code} was updated: {room.Name}.";
            return $"{summary} {DescribePriceChange(q.PriceDiff, q.AmountToPay, q.AmountToRefund, q.CreditAmount, recipientLanguage)}";
        }

        var cards = new List<Card> { Cards.BookingSummary(booking, room) };
        if (extra != null) cards.Add(Cards.PaymentCard(extra, booking.Code));
        await bookings.NotifyGuest(tenant, booking, Message, ct, [.. cards]);
        await realtime.BookingChanged(tenant.Id, booking.Id);
        return new ChangeOutcome(req, booking, extra, refunded, Message(language));
    }

    // ---------- Cancellation ----------

    public async Task<RefundQuote> QuoteCancellationAsync(Tenant tenant, Booking booking, CancellationToken ct = default, string? language = null)
    {
        language ??= await bookings.GuestLanguageAsync(tenant, booking, ct);
        if (booking.Status is BookingStatus.Hold or BookingStatus.PendingDeposit && booking.PaidAmount <= 0)
            return new RefundQuote(true, false, 0, 0, null, null, (booking.StartAt - clock.GetUtcNow()).TotalHours, null,
                GuestText.IsVietnamese(language)
                    ? "Đặt phòng này chưa được thanh toán nên bạn có thể hủy miễn phí."
                    : "No payment has been made yet, so this booking can be cancelled free of charge.");
        EnsureModifiable(booking, language);
        return RefundEngine.Quote(await ActivePolicyAsync(tenant.Id, ct), booking, clock.GetUtcNow(), language: language);
    }

    public async Task<ChangeOutcome> RequestCancellationAsync(Tenant tenant, Booking booking, string actor, string? reason,
        CancellationToken ct = default, string? language = null)
    {
        language ??= await bookings.GuestLanguageAsync(tenant, booking, ct);
        var quote = await QuoteCancellationAsync(tenant, booking, ct, language);
        var req = new BookingChangeRequest
        {
            TenantId = tenant.Id,
            BookingId = booking.Id,
            Type = ChangeRequestType.Cancel,
            PayloadJson = JsonSerializer.Serialize(quote, AuditService.Json),
            RefundQuote = quote.RefundAmount,
            Explanation = quote.Explanation,
            Reason = reason,
        };
        db.ChangeRequests.Add(req);
        audit.Log(tenant.Id, actor, "cancellation.requested", nameof(BookingChangeRequest), req.Id, new { booking.Code, quote.RefundAmount, quote.RuleLabel });
        await db.SaveChangesAsync(ct);

        var autoOk = quote.Covered && !quote.RequiresApproval && (tenant.AutoApproveCancellations || booking.PaidAmount <= 0);
        if (!autoOk)
        {
            await realtime.BookingChanged(tenant.Id, booking.Id);
            return new ChangeOutcome(req, booking, null, 0,
                GuestText.IsVietnamese(language)
                    ? $"Yêu cầu hủy đặt phòng của bạn đã được gửi cho chủ nhà. {quote.Explanation}"
                    : $"Your cancellation request was sent to the host. {quote.Explanation}");
        }
        var outcome = await ApplyCancellationAsync(tenant, req, booking, quote.RefundAmount, Actors.System, auto: true, ct, language);
        return quote.RefundAmount > 0 ? outcome : outcome with { Message = $"{outcome.Message} {quote.Explanation}" };
    }

    public async Task<ChangeOutcome> ApplyCancellationAsync(Tenant tenant, BookingChangeRequest req, Booking booking, decimal refundAmount, string actor, bool auto,
        CancellationToken ct = default, string? language = null)
    {
        language ??= await bookings.GuestLanguageAsync(tenant, booking, ct);
        req.Status = auto ? ChangeRequestStatus.Auto : ChangeRequestStatus.Approved;
        req.DecidedBy = actor;
        req.DecidedAt = clock.GetUtcNow();
        req.RefundQuote = refundAmount;
        booking.CancelReason = req.Reason;
        await db.SaveChangesAsync(ct);

        var refunded = await payments.RefundAsync(tenant, booking, refundAmount, $"Cancellation {booking.Code}", ct);
        await bookings.TransitionAsync(tenant, booking, BookingStatus.Cancelled, actor, req.Reason, ct);
        string Message(string recipientLanguage)
        {
            var vi = GuestText.IsVietnamese(recipientLanguage);
            var summary = vi ? $"Đặt phòng {booking.Code} đã được hủy." : $"Booking {booking.Code} is cancelled.";
            if (refunded > 0)
            {
                var amount = GuestText.Amount(refunded, recipientLanguage);
                return vi ? $"{summary} {amount} đã được hoàn qua VNPay của bạn." : $"{summary} A refund of {amount} has been sent via VNPay.";
            }
            if (refundAmount > 0)
            {
                var amount = GuestText.Amount(refundAmount, recipientLanguage);
                return vi ? $"{summary} Chủ nhà sẽ xử lý khoản hoàn tiền {amount}." : $"{summary} The refund of {amount} will be processed by the host.";
            }
            return summary;
        }

        // The status change already posts "cancelled"; only add a second notice when there is refund news.
        if (refunded > 0 || refundAmount > 0) await bookings.NotifyGuest(tenant, booking, Message, ct);
        return new ChangeOutcome(req, booking, null, refunded, Message(language));
    }

    public async Task RejectAsync(Tenant tenant, BookingChangeRequest req, Booking booking, string actor, string? note, CancellationToken ct = default)
    {
        if (req.Status != ChangeRequestStatus.Pending) throw AppException.Conflict("already_decided", "This request was already decided.");
        req.Status = ChangeRequestStatus.Rejected;
        req.DecidedBy = actor;
        req.DecidedAt = clock.GetUtcNow();
        audit.Log(tenant.Id, actor, "change.rejected", nameof(BookingChangeRequest), req.Id, new { note });
        await db.SaveChangesAsync(ct);
        await bookings.NotifyGuest(tenant, booking, language =>
        {
            var vi = GuestText.IsVietnamese(language);
            var cancellation = req.Type == ChangeRequestType.Cancel;
            var action = vi ? (cancellation ? "hủy" : "thay đổi") : (cancellation ? "cancellation" : "change");
            var message = vi
                ? $"Chủ nhà không thể duyệt yêu cầu {action} đặt phòng {booking.Code}."
                : $"The host couldn't approve your {action} request for booking {booking.Code}.";
            if (!string.IsNullOrWhiteSpace(note))
                message += vi ? $" Ghi chú từ chủ nhà: {note}" : $" Note from the host: {note}";
            return message;
        }, ct);
        await realtime.BookingChanged(tenant.Id, booking.Id);
    }

    private static void EnsureModifiable(Booking b, string language)
    {
        if (!BookingStateMachine.IsModifiable(b.Status))
            throw AppException.Conflict("not_modifiable", GuestText.IsVietnamese(language)
                ? $"Không thể thay đổi đặt phòng {b.Code} (trạng thái: {GuestText.Status(b.Status, language)})."
                : $"Booking {b.Code} can no longer be changed ({b.Status}).");
    }
}
