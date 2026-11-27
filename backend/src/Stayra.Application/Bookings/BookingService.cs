using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;
using Stayra.Application.Payments;
using Stayra.Application.Pricing;
using Stayra.Domain;

namespace Stayra.Application.Bookings;

public record GuestInfo(string Name, string Phone, string? Email, string? Note);

public record CreateBookingInput(Guid RoomId, Stay Stay, int Guests, GuestInfo Guest, BookingSource Source, Guid? ConversationId = null);

public record OwnerBookingInput(Guid RoomId, Stay Stay, int Guests, GuestInfo Guest, bool MarkConfirmed, decimal? AmountPaid);

public record HoldResult(Booking Booking, Room Room, Quote Quote, Payment? Deposit);

/// <summary>Thrown when Postgres' exclusion constraint rejects an overlapping booking.</summary>
public class RoomUnavailableException(string message = "That room was just booked for those dates. Please choose other dates or another room.")
    : AppException(409, "room_unavailable", message);

public interface IBookingConflictDetector
{
    bool IsOverlapViolation(Exception ex);
}

public class BookingService(
    IAppDbContext db,
    PricingService pricing,
    PaymentService payments,
    AuditService audit,
    IGuestMessenger messenger,
    IRealtimeNotifier realtime,
    IJobScheduler jobs,
    IBookingConflictDetector conflicts,
    TimeProvider clock,
    ILogger<BookingService> log,
    IEmailSender? email = null) : IPaymentEvents
{
    // ---------- Availability ----------

    public async Task<bool> IsAvailableAsync(Guid roomId, DateTimeOffset start, DateTimeOffset blockedUntil, Guid? excludeBookingId = null, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        return !await db.Bookings.IgnoreQueryFilters().AnyAsync(b =>
            b.RoomId == roomId
            && b.Id != excludeBookingId
            && (b.Status == BookingStatus.PendingDeposit || b.Status == BookingStatus.Confirmed || b.Status == BookingStatus.CheckedIn
                || (b.Status == BookingStatus.Hold && b.HoldExpiresAt > now))
            && start < b.BlockedUntil && b.StartAt < blockedUntil, ct);
    }

    public record AvailableRoom(Room Room, Quote Quote);

    public async Task<(List<AvailableRoom> Available, List<(Room Room, string Reason)> Unavailable)> SearchAsync(
        Tenant tenant, Stay stay, int guests, Guid? roomId = null, CancellationToken ct = default)
    {
        var rooms = await db.Rooms.Include(r => r.Photos)
            .Where(r => r.TenantId == tenant.Id && r.IsActive && (roomId == null || r.Id == roomId))
            .OrderBy(r => r.SortOrder).ToListAsync(ct);
        var rules = await pricing.RulesFor(tenant.Id, ct);
        var available = new List<AvailableRoom>();
        var unavailable = new List<(Room, string)>();
        foreach (var room in rooms)
        {
            Quote q;
            try { q = PricingService.Quote(tenant, room, rules, stay, guests); }
            catch (PricingException ex) { unavailable.Add((room, ex.Message)); continue; }
            var blocked = Availability.BlockedUntil(tenant, stay.Mode, q.EndAt);
            if (q.StartAt < clock.GetUtcNow()) { unavailable.Add((room, "That time is in the past.")); continue; }
            if (await IsAvailableAsync(room.Id, q.StartAt, blocked, null, ct)) available.Add(new AvailableRoom(room, q));
            else unavailable.Add((room, "Already booked for that time."));
        }
        return (available, unavailable);
    }

    // ---------- Create ----------

    public async Task<HoldResult> CreateHoldAsync(Tenant tenant, CreateBookingInput input, CancellationToken ct = default)
    {
        var phone = Phone.NormalizeVn(input.Guest.Phone)
                    ?? throw new AppException(400, "invalid_phone", "Please enter a valid Vietnamese mobile number, for example 0912 345 678.");
        if (string.IsNullOrWhiteSpace(input.Guest.Name) || input.Guest.Name.Trim().Length < 2)
            throw new AppException(400, "invalid_name", "Please enter the guest's full name.");

        var room = await db.Rooms.Include(r => r.Photos).FirstOrDefaultAsync(r => r.Id == input.RoomId && r.TenantId == tenant.Id && r.IsActive, ct)
                   ?? throw AppException.NotFound("Room");
        var quote = PricingService.Quote(tenant, room, await pricing.RulesFor(tenant.Id, ct), input.Stay, input.Guests);
        var now = clock.GetUtcNow();
        if (quote.StartAt < now) throw new AppException(400, "in_the_past", "That time is in the past.");

        var booking = new Booking
        {
            TenantId = tenant.Id,
            Code = await UniqueCodeAsync(ct),
            RoomId = room.Id,
            Mode = input.Stay.Mode,
            StartAt = quote.StartAt,
            EndAt = quote.EndAt,
            BlockedUntil = Availability.BlockedUntil(tenant, input.Stay.Mode, quote.EndAt),
            Guests = input.Guests,
            GuestName = input.Guest.Name.Trim(),
            GuestPhone = phone,
            GuestEmail = string.IsNullOrWhiteSpace(input.Guest.Email) ? null : input.Guest.Email.Trim(),
            Note = input.Guest.Note,
            Source = input.Source,
            Status = BookingStatus.Hold,
            TotalAmount = quote.Total,
            DepositAmount = quote.Deposit,
            PriceBreakdownJson = JsonSerializer.Serialize(quote, AuditService.Json),
            HoldExpiresAt = now.AddMinutes(tenant.HoldMinutes),
            ConversationId = input.ConversationId,
        };

        await InsertWithLockAsync(booking, ct);
        audit.Log(tenant.Id, input.Source == BookingSource.Owner ? Actors.System : Actors.Guest, "booking.created", nameof(Booking), booking.Id,
            new { booking.Code, booking.Status, booking.TotalAmount, input.Source });

        if (input.ConversationId is { } convId)
        {
            var conv = await db.Conversations.FirstOrDefaultAsync(c => c.Id == convId, ct);
            if (conv != null)
            {
                conv.BookingId = booking.Id;
                conv.GuestName ??= booking.GuestName;
                conv.GuestPhone ??= booking.GuestPhone;
            }
        }
        await db.SaveChangesAsync(ct);

        Payment? deposit = null;
        if (booking.DepositAmount >= 1000)
            deposit = await payments.CreateAsync(tenant, booking, PaymentKind.Deposit, booking.DepositAmount, booking.HoldExpiresAt, ct);
        else
            await TransitionAsync(tenant, booking, BookingStatus.Confirmed, Actors.System, "No deposit required", ct);

        await realtime.BookingChanged(tenant.Id, booking.Id);
        return new HoldResult(booking, room, quote, deposit);
    }

    public async Task<Booking> CreateByOwnerAsync(Tenant tenant, OwnerBookingInput input, string actor, CancellationToken ct = default)
    {
        var phone = Phone.NormalizeVn(input.Guest.Phone) ?? input.Guest.Phone.Trim();
        var room = await db.Rooms.FirstOrDefaultAsync(r => r.Id == input.RoomId && r.TenantId == tenant.Id, ct) ?? throw AppException.NotFound("Room");
        var quote = PricingService.Quote(tenant, room, await pricing.RulesFor(tenant.Id, ct), input.Stay, input.Guests);
        var booking = new Booking
        {
            TenantId = tenant.Id,
            Code = await UniqueCodeAsync(ct),
            RoomId = room.Id,
            Mode = input.Stay.Mode,
            StartAt = quote.StartAt,
            EndAt = quote.EndAt,
            BlockedUntil = Availability.BlockedUntil(tenant, input.Stay.Mode, quote.EndAt),
            Guests = input.Guests,
            GuestName = input.Guest.Name.Trim(),
            GuestPhone = phone,
            GuestEmail = input.Guest.Email,
            Note = input.Guest.Note,
            Source = BookingSource.Owner,
            Status = input.MarkConfirmed ? BookingStatus.Confirmed : BookingStatus.PendingDeposit,
            TotalAmount = quote.Total,
            DepositAmount = quote.Deposit,
            PriceBreakdownJson = JsonSerializer.Serialize(quote, AuditService.Json),
            ConfirmedAt = input.MarkConfirmed ? clock.GetUtcNow() : null,
        };
        await InsertWithLockAsync(booking, ct);
        if (input.AmountPaid is > 0)
        {
            db.Payments.Add(new Payment
            {
                TenantId = tenant.Id, BookingId = booking.Id, Kind = PaymentKind.Deposit, Amount = input.AmountPaid.Value,
                Provider = PaymentProvider.Cash, OrderId = $"{booking.Code}-CASH-{Guid.NewGuid().ToString("N")[..6]}",
                RequestId = Guid.NewGuid().ToString("N"), Status = PaymentStatus.Paid, PaidAt = clock.GetUtcNow(), Message = "Recorded by host",
            });
            booking.PaidAmount = input.AmountPaid.Value;
        }
        audit.Log(tenant.Id, actor, "booking.created", nameof(Booking), booking.Id, new { booking.Code, booking.Status, Source = "Owner" });
        await db.SaveChangesAsync(ct);
        if (booking.Status == BookingStatus.Confirmed)
        {
            ScheduleRemaining(tenant, booking);
            await SendConfirmationEmailAsync(tenant, booking, room, tenant.DefaultLanguage, ct);
        }
        await db.SaveChangesAsync(ct);
        await realtime.BookingChanged(tenant.Id, booking.Id);
        return booking;
    }

    /// <summary>
    /// Inserts inside a transaction after expiring stale holds on the same room. The Postgres exclusion
    /// constraint (room, tstzrange(start, blocked_until)) is the final guard against concurrent double booking.
    /// </summary>
    private async Task InsertWithLockAsync(Booking booking, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            // Serialize writers per room so the stale-hold sweep + insert is atomic.
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({booking.RoomId.ToString()}))", ct);
            await ExpireStaleHoldsForRoomAsync(booking.RoomId, ct);
            if (!await IsAvailableAsync(booking.RoomId, booking.StartAt, booking.BlockedUntil, null, ct))
                throw new RoomUnavailableException();
            db.Bookings.Add(booking);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception ex) when (conflicts.IsOverlapViolation(ex))
        {
            db.Bookings.Entry(booking).State = EntityState.Detached;
            throw new RoomUnavailableException();
        }
    }

    private async Task ExpireStaleHoldsForRoomAsync(Guid roomId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var stale = await db.Bookings.IgnoreQueryFilters()
            .Where(b => b.RoomId == roomId && b.Status == BookingStatus.Hold && b.HoldExpiresAt <= now).ToListAsync(ct);
        foreach (var b in stale)
        {
            b.Status = BookingStatus.Expired;
            audit.Log(b.TenantId, Actors.System, "booking.expired", nameof(Booking), b.Id, new { b.Code });
        }
        if (stale.Count > 0) await db.SaveChangesAsync(ct);
    }

    private async Task<string> UniqueCodeAsync(CancellationToken ct)
    {
        for (var i = 0; i < 10; i++)
        {
            var code = BookingCode.New();
            if (!await db.Bookings.IgnoreQueryFilters().AnyAsync(b => b.Code == code, ct)) return code;
        }
        throw new InvalidOperationException("Could not allocate a booking code.");
    }

    // ---------- State machine ----------

    public async Task TransitionAsync(Tenant tenant, Booking booking, BookingStatus to, string actor, string? note = null, CancellationToken ct = default)
    {
        var from = booking.Status;
        BookingStateMachine.EnsureCanTransition(from, to);
        booking.Status = to;
        var now = clock.GetUtcNow();
        switch (to)
        {
            case BookingStatus.Confirmed: booking.ConfirmedAt = now; booking.HoldExpiresAt = null; break;
            case BookingStatus.CheckedIn: booking.CheckedInAt = now; break;
            case BookingStatus.CheckedOut: booking.CheckedOutAt = now; break;
            case BookingStatus.Cancelled: booking.CancelledAt = now; booking.CancelReason ??= note; break;
        }
        audit.Log(tenant.Id, actor, $"booking.{to.ToString().ToLowerInvariant()}", nameof(Booking), booking.Id,
            new { booking.Code, From = from.ToString(), To = to.ToString(), Note = note });
        await db.SaveChangesAsync(ct);

        if (to is BookingStatus.Cancelled or BookingStatus.Expired or BookingStatus.NoShow)
        {
            await payments.ExpireOpenPaymentsAsync(booking.Id, ct);
            if (booking.RemainingJobId != null) { jobs.Delete(booking.RemainingJobId); booking.RemainingJobId = null; await db.SaveChangesAsync(ct); }
        }

        var conversation = await ConversationFor(booking, ct);
        Room? room = null;
        if (conversation != null || to == BookingStatus.Confirmed)
            room = await db.Rooms.IgnoreQueryFilters().FirstOrDefaultAsync(r => r.Id == booking.RoomId, ct);
        if (conversation != null)
        {
            await messenger.SendAsync(conversation.Id, MessageRole.System, StatusMessage(booking, to, conversation.Language),
                [Cards.BookingSummary(booking, room)], ct: ct);
        }
        if (to == BookingStatus.Confirmed)
            await SendConfirmationEmailAsync(tenant, booking, room, conversation?.Language ?? tenant.DefaultLanguage, ct);
        await realtime.BookingChanged(tenant.Id, booking.Id);
    }

    private async Task SendConfirmationEmailAsync(Tenant tenant, Booking booking, Room? room, string language, CancellationToken ct)
    {
        if (email == null || string.IsNullOrWhiteSpace(booking.GuestEmail)) return;
        try
        {
            var msg = BookingEmail.Confirmation(tenant, booking, room, language, email.WebBaseUrl);
            await email.SendAsync(msg, ct);
            audit.Log(tenant.Id, Actors.System, "booking.email_sent", nameof(Booking), booking.Id,
                new { to = booking.GuestEmail, delivered = email.IsEnabled });
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Failed to send confirmation email for booking {Code} to {Email}", booking.Code, booking.GuestEmail);
        }
    }

    private static string StatusMessage(Booking b, BookingStatus to, string language) =>
        GuestText.IsVietnamese(language)
            ? to switch
            {
                BookingStatus.Confirmed => $"Đặt phòng {b.Code} đã được xác nhận. Rất mong được đón tiếp bạn.",
                BookingStatus.Expired => $"Đặt phòng {b.Code} đã hết hạn giữ chỗ vì chưa nhận được tiền cọc đúng hạn.",
                BookingStatus.Cancelled => $"Đặt phòng {b.Code} đã được hủy.",
                BookingStatus.CheckedIn => $"Bạn đã nhận phòng cho đặt phòng {b.Code}. Chúc bạn có kỳ nghỉ vui vẻ.",
                BookingStatus.CheckedOut => $"Bạn đã trả phòng cho đặt phòng {b.Code}. Cảm ơn bạn đã lưu trú.",
                BookingStatus.NoShow => $"Đặt phòng {b.Code} đã được đánh dấu là khách không đến.",
                _ => $"Trạng thái đặt phòng {b.Code}: {GuestText.Status(to, language)}.",
            }
            : to switch
            {
                BookingStatus.Confirmed => $"Booking {b.Code} is confirmed. We look forward to welcoming you.",
                BookingStatus.Expired => $"The hold on booking {b.Code} expired because the deposit wasn't paid in time.",
                BookingStatus.Cancelled => $"Booking {b.Code} has been cancelled.",
                BookingStatus.CheckedIn => $"You're checked in for booking {b.Code}. Enjoy your stay.",
                BookingStatus.CheckedOut => $"You're checked out of booking {b.Code}. Thank you for staying with us.",
                BookingStatus.NoShow => $"Booking {b.Code} was marked as a no-show.",
                _ => $"Booking {b.Code} is now {GuestText.Status(to, language)}.",
            };

    private sealed record GuestConversation(Guid Id, string Language);

    private Task<GuestConversation?> ConversationFor(Booking booking, CancellationToken ct) =>
        db.Conversations.IgnoreQueryFilters()
            .Where(c => c.TenantId == booking.TenantId && (c.Id == booking.ConversationId || c.BookingId == booking.Id))
            .OrderByDescending(c => c.Id == booking.ConversationId)
            .ThenByDescending(c => c.LastMessageAt)
            .Select(c => new GuestConversation(c.Id, c.Language))
            .FirstOrDefaultAsync(ct);

    internal async Task<string> GuestLanguageAsync(Tenant tenant, Booking booking, CancellationToken ct) =>
        (await ConversationFor(booking, ct))?.Language ?? tenant.DefaultLanguage;

    // ---------- Payment events ----------

    public async Task OnPaymentPaidAsync(Payment payment, CancellationToken ct)
    {
        var booking = await db.Bookings.IgnoreQueryFilters().FirstAsync(b => b.Id == payment.BookingId, ct);
        var tenant = await db.Tenants.FirstAsync(t => t.Id == booking.TenantId, ct);
        audit.Log(tenant.Id, Actors.System, "payment.paid", nameof(Payment), payment.Id, new { payment.OrderId, payment.Amount, Kind = payment.Kind.ToString() });
        await db.SaveChangesAsync(ct);

        if (payment.Kind == PaymentKind.Deposit && booking.Status is BookingStatus.Hold or BookingStatus.PendingDeposit)
        {
            await TransitionAsync(tenant, booking, BookingStatus.Confirmed, Actors.System, "Deposit paid", ct);
            ScheduleRemaining(tenant, booking);
            await db.SaveChangesAsync(ct);
        }
        else if (payment.Kind == PaymentKind.Deposit && booking.Status is BookingStatus.Expired or BookingStatus.Cancelled)
        {
            // Paid after the hold expired: try to revive if the slot is still free, otherwise refund in full.
            if (booking.Status == BookingStatus.Expired && await IsAvailableAsync(booking.RoomId, booking.StartAt, booking.BlockedUntil, booking.Id, ct))
            {
                booking.Status = BookingStatus.Hold; // re-enter the machine legally
                await TransitionAsync(tenant, booking, BookingStatus.Confirmed, Actors.System, "Late deposit accepted", ct);
                ScheduleRemaining(tenant, booking);
                await db.SaveChangesAsync(ct);
            }
            else
            {
                await payments.RefundAsync(tenant, booking, payment.Amount, "Late payment for an expired booking", ct);
                await NotifyGuest(tenant, booking, language => GuestText.IsVietnamese(language)
                    ? $"Chúng tôi nhận được khoản thanh toán sau khi đặt phòng {booking.Code} hết hạn và đã hoàn lại toàn bộ số tiền."
                    : $"We received a payment for booking {booking.Code} after it expired, so it has been refunded in full.", ct);
            }
        }
        else
        {
            var room = await db.Rooms.IgnoreQueryFilters().FirstOrDefaultAsync(r => r.Id == booking.RoomId, ct);
            await NotifyGuest(tenant, booking, language => GuestText.IsVietnamese(language)
                ? $"Đã nhận {GuestText.Amount(payment.Amount, language)} cho đặt phòng {booking.Code}. Cảm ơn bạn."
                : $"Payment of {GuestText.Amount(payment.Amount, language)} received for booking {booking.Code}. Thank you.",
                ct, Cards.BookingSummary(booking, room));
            if (booking.Balance <= booking.CreditAmount && booking.RemainingJobId != null)
            {
                jobs.Delete(booking.RemainingJobId);
                booking.RemainingJobId = null;
                await db.SaveChangesAsync(ct);
            }
        }
        await realtime.BookingChanged(tenant.Id, booking.Id);
    }

    internal async Task NotifyGuest(Tenant tenant, Booking booking, Func<string, string> translate, CancellationToken ct, params Card[] cards)
    {
        var conversation = await ConversationFor(booking, ct);
        var text = translate(conversation?.Language ?? tenant.DefaultLanguage);
        if (conversation != null) await messenger.SendAsync(conversation.Id, MessageRole.System, text, cards, ct: ct);
        else log.LogInformation("[SMS stub] to {Phone}: {Text}", booking.GuestPhone, text);
    }

    // ---------- Remaining payment ----------

    public DateTimeOffset RemainingDueAt(Tenant tenant, Booking b) => tenant.RemainingPaymentTrigger switch
    {
        RemainingPaymentTrigger.HoursBeforeCheckIn => b.StartAt.AddHours(-tenant.RemainingPaymentHours),
        RemainingPaymentTrigger.AtCheckIn => b.StartAt,
        _ => b.EndAt.AddHours(-1),
    };

    public void ScheduleRemaining(Tenant tenant, Booking booking)
    {
        if (booking.TotalAmount - booking.PaidAmount <= 0) return;
        if (booking.RemainingJobId != null) jobs.Delete(booking.RemainingJobId);
        var at = RemainingDueAt(tenant, booking);
        booking.RemainingJobId = at <= clock.GetUtcNow()
            ? jobs.Enqueue<BookingJobs>(j => j.SendRemainingPayment(booking.Id, false))
            : jobs.Schedule<BookingJobs>(j => j.SendRemainingPayment(booking.Id, false), at);
    }

    /// <summary>Creates (or reuses) the open "Remaining" payment and sends it to the guest's channel.</summary>
    public async Task<Payment?> SendRemainingPaymentAsync(Tenant tenant, Booking booking, bool isReminder, CancellationToken ct = default)
    {
        if (booking.Status is not (BookingStatus.Confirmed or BookingStatus.CheckedIn)) return null;
        var balance = booking.TotalAmount - booking.PaidAmount + booking.RefundAmount - booking.CreditAmount;
        if (balance < 1000) return null;

        var open = await db.Payments.IgnoreQueryFilters()
            .Where(p => p.BookingId == booking.Id && p.Kind == PaymentKind.Remaining && p.Status == PaymentStatus.Created && p.Amount == balance)
            .OrderByDescending(p => p.CreatedAt).FirstOrDefaultAsync(ct);
        var payment = open ?? await payments.CreateAsync(tenant, booking, PaymentKind.Remaining, balance, null, ct);

        var conversation = await ConversationFor(booking, ct);
        var language = conversation?.Language ?? tenant.DefaultLanguage;
        var amount = GuestText.Amount(balance, language);
        var name = booking.GuestName.Split(' ').Last();
        var text = (GuestText.IsVietnamese(language), isReminder) switch
        {
            (true, true) => $"Đặt phòng {booking.Code} còn {amount} chưa thanh toán. Bạn có thể thanh toán qua MoMo bằng liên kết bên dưới.",
            (true, false) => $"Chào {name}, số tiền còn phải thanh toán cho đặt phòng {booking.Code} là {amount}. Bạn có thể thanh toán qua MoMo bằng liên kết bên dưới.",
            (false, true) => $"A friendly reminder: the remaining balance of {amount} for booking {booking.Code} is still open. You can pay securely with MoMo below.",
            _ => $"Hi {name}, your remaining balance for booking {booking.Code} is {amount}. You can pay securely with MoMo below.",
        };
        if (conversation != null) await messenger.SendAsync(conversation.Id, MessageRole.Bot, text, [Cards.PaymentCard(payment, booking.Code)], ct: ct);
        else log.LogInformation("[SMS stub] to {Phone}: {Text} {Url}", booking.GuestPhone, text, payment.PayUrl);

        audit.Log(tenant.Id, Actors.Bot, isReminder ? "payment.reminder_sent" : "payment.remaining_sent", nameof(Payment), payment.Id, new { booking.Code, balance });
        if (tenant.RemainingReminderHours > 0)
            booking.RemainingJobId = jobs.Schedule<BookingJobs>(j => j.SendRemainingPayment(booking.Id, true), clock.GetUtcNow().AddHours(tenant.RemainingReminderHours));
        await db.SaveChangesAsync(ct);
        return payment;
    }

    // ---------- Check-in / out ----------

    public async Task CheckInAsync(Tenant tenant, Booking booking, string actor, CancellationToken ct = default) =>
        await TransitionAsync(tenant, booking, BookingStatus.CheckedIn, actor, null, ct);

    /// <summary>Owner check-out. If a balance remains and <paramref name="settledInCash"/> is false, sends the payment link instead of blocking.</summary>
    public async Task<Payment?> CheckOutAsync(Tenant tenant, Booking booking, string actor, bool settledInCash, CancellationToken ct = default)
    {
        var balance = booking.TotalAmount - booking.PaidAmount + booking.RefundAmount - booking.CreditAmount;
        Payment? link = null;
        if (balance >= 1000)
        {
            if (settledInCash)
            {
                db.Payments.Add(new Payment
                {
                    TenantId = tenant.Id, BookingId = booking.Id, Kind = PaymentKind.Remaining, Amount = balance, Provider = PaymentProvider.Cash,
                    OrderId = $"{booking.Code}-CASH-{Guid.NewGuid().ToString("N")[..6]}", RequestId = Guid.NewGuid().ToString("N"),
                    Status = PaymentStatus.Paid, PaidAt = clock.GetUtcNow(), Message = "Settled at check-out",
                });
                booking.PaidAmount += balance;
            }
            else link = await SendRemainingPaymentAsync(tenant, booking, false, ct);
        }
        if (booking.Status == BookingStatus.Confirmed) await TransitionAsync(tenant, booking, BookingStatus.CheckedIn, actor, "Checked in at check-out", ct);
        await TransitionAsync(tenant, booking, BookingStatus.CheckedOut, actor, null, ct);
        return link;
    }

    // ---------- Holds ----------

    public async Task<int> ExpireHoldsAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var expired = await db.Bookings.IgnoreQueryFilters()
            .Where(b => b.Status == BookingStatus.Hold && b.HoldExpiresAt <= now).ToListAsync(ct);
        foreach (var b in expired)
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Id == b.TenantId, ct);
            await TransitionAsync(tenant, b, BookingStatus.Expired, Actors.System, "Hold expired", ct);
        }
        return expired.Count;
    }

    public async Task<Booking> FindForGuestAsync(Guid tenantId, string code, string phone, string email, CancellationToken ct = default)
    {
        var norm = BookingCode.Normalize(code);
        var normEmail = (email ?? "").Trim();
        var booking = await db.Bookings.Include(b => b.Room).ThenInclude(r => r!.Photos)
            .FirstOrDefaultAsync(b => b.TenantId == tenantId && b.Code == norm, ct);
        if (booking == null
            || !Phone.Matches(booking.GuestPhone, phone)
            || string.IsNullOrWhiteSpace(normEmail)
            || string.IsNullOrWhiteSpace(booking.GuestEmail)
            || !string.Equals(booking.GuestEmail.Trim(), normEmail, StringComparison.OrdinalIgnoreCase))
            throw new AppException(404, "booking_not_found", "We couldn't find a booking with that code, email, and phone number.");
        return booking;
    }
}
