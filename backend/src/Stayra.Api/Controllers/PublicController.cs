using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Stayra.Api.Contracts;
using Stayra.Api.Infrastructure;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Application.Pricing;
using Stayra.Domain;
using Stayra.Infrastructure.Persistence;

namespace Stayra.Api.Controllers;

public record StayQuery(BookingMode Mode, string Start, string End, int Guests, Guid? RoomId);

public record PublicBookingRequest(Guid RoomId, BookingMode Mode, string Start, string End, int Guests, string GuestName, string GuestPhone,
    string? GuestEmail, string? Note);

public record LookupRequest(string Code, string Phone);
public record GuestChangeRequest(string Phone, Guid? RoomId, BookingMode? Mode, string? Start, string? End, int? Guests);
public record GuestCancelRequest(string Phone, string? Reason);
public record GuestPhoneRequest(string Phone);

public class PublicBookingValidator : AbstractValidator<PublicBookingRequest>
{
    public PublicBookingValidator()
    {
        RuleFor(x => x.GuestName).NotEmpty().WithErrorCode("required").MinimumLength(2).WithErrorCode("name_too_short").MaximumLength(120);
        RuleFor(x => x.GuestPhone).NotEmpty().WithErrorCode("required").Must(p => Phone.NormalizeVn(p) != null).WithErrorCode("phone");
        RuleFor(x => x.GuestEmail).EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.GuestEmail)).WithErrorCode("email");
        RuleFor(x => x.Guests).InclusiveBetween(1, 30).WithErrorCode("out_of_range");
        RuleFor(x => x.Note).MaximumLength(1000).WithErrorCode("too_long");
    }
}

[ApiController]
[Route("api/public/{slug}")]
[EnableRateLimiting("public")]
public class PublicController(StayraDbContext db, BookingService bookings, ChangeService changes, PricingService pricing, TimeProvider clock) : PublicControllerBase
{
    [HttpGet]
    public async Task<object> Home(string slug)
    {
        var t = CurrentTenant;
        var rooms = await db.Rooms.Include(r => r.Photos).Where(r => r.IsActive).OrderBy(r => r.SortOrder).ToListAsync();
        var faqs = await db.FaqItems.Where(f => f.Status == FaqStatus.Approved).OrderBy(f => f.SortOrder).ToListAsync();
        var policy = await changes.ActivePolicyAsync(t.Id);
        return new
        {
            tenant = PublicTenantDto.From(t),
            rooms = rooms.Select(RoomDto.From),
            faqs = faqs.Select(FaqDto.From),
            cancellation = policy is null ? null : new
            {
                rules = policy.Rules.OrderByDescending(r => r.MinHoursBeforeCheckIn).Select(r => new { r.Label, r.RefundPercent, r.AppliesTo, r.MinHoursBeforeCheckIn, r.MaxHoursBeforeCheckIn }),
                policy.NoShowRefundPercent,
                policy.Notes,
            },
        };
    }

    [HttpGet("rooms/{roomId:guid}")]
    public async Task<RoomDto> Room(string slug, Guid roomId) =>
        RoomDto.From(await db.Rooms.Include(r => r.Photos).FirstOrDefaultAsync(r => r.Id == roomId && r.IsActive) ?? throw AppException.NotFound("Room"));

    /// <summary>Days (local) that are fully booked for nightly stays, and busy hour ranges, for the date picker.</summary>
    [HttpGet("rooms/{roomId:guid}/busy")]
    public async Task<object> Busy(string slug, Guid roomId, [FromQuery] DateOnly from, [FromQuery] int days = 62)
    {
        var t = CurrentTenant;
        var start = TenantTime.ToUtc(t, from, TimeOnly.MinValue);
        var end = TenantTime.ToUtc(t, from.AddDays(Math.Clamp(days, 1, 120)), TimeOnly.MinValue);
        var now = clock.GetUtcNow();
        var list = await db.Bookings.Where(b => b.RoomId == roomId && b.StartAt < end && b.BlockedUntil > start
                && (b.Status == BookingStatus.PendingDeposit || b.Status == BookingStatus.Confirmed || b.Status == BookingStatus.CheckedIn
                    || (b.Status == BookingStatus.Hold && b.HoldExpiresAt > now)))
            .Select(b => new { b.Mode, b.StartAt, b.BlockedUntil }).ToListAsync();
        var nights = new SortedSet<DateOnly>();
        foreach (var b in list.Where(b => b.Mode == BookingMode.Nightly))
        {
            var ci = DateOnly.FromDateTime(TenantTime.ToLocal(t, b.StartAt));
            var co = DateOnly.FromDateTime(TenantTime.ToLocal(t, b.BlockedUntil));
            for (var d = ci; d < co; d = d.AddDays(1)) nights.Add(d);
        }
        var ranges = list.Select(b => new { start = TenantTime.ToLocal(t, b.StartAt).ToString("yyyy-MM-ddTHH:mm"), end = TenantTime.ToLocal(t, b.BlockedUntil).ToString("yyyy-MM-ddTHH:mm") });
        return new { bookedNights = nights.Select(d => d.ToString("yyyy-MM-dd")), busyRanges = ranges };
    }

    [HttpPost("quote")]
    public async Task<object> Quote(string slug, StayQuery q)
    {
        if (q.RoomId is not { } roomId) throw AppException.BadRequest("room_required", "Choose a room.");
        var t = CurrentTenant;
        var stay = Stay.Parse(q.Mode, q.Start, q.End);
        var quote = await pricing.QuoteAsync(t, roomId, stay, q.Guests);
        var available = quote.StartAt > clock.GetUtcNow()
            && await bookings.IsAvailableAsync(roomId, quote.StartAt, Application.Bookings.Availability.BlockedUntil(t, q.Mode, quote.EndAt));
        return new { quote, available };
    }

    [HttpPost("availability")]
    public async Task<object> Search(string slug, StayQuery q)
    {
        var (available, unavailable) = await bookings.SearchAsync(CurrentTenant, Stay.Parse(q.Mode, q.Start, q.End), q.Guests, q.RoomId);
        return new
        {
            available = available.Select(a => new { room = RoomDto.From(a.Room), quote = a.Quote }),
            unavailable = unavailable.Select(u => new { roomId = u.Room.Id, reason = u.Reason }),
        };
    }

    [HttpPost("bookings")]
    public async Task<object> CreateBooking(string slug, PublicBookingRequest req, [FromServices] IValidator<PublicBookingRequest> v)
    {
        await v.ValidateOrThrow(req);
        var result = await bookings.CreateHoldAsync(CurrentTenant, new CreateBookingInput(req.RoomId, Stay.Parse(req.Mode, req.Start, req.End), req.Guests,
            new GuestInfo(req.GuestName, req.GuestPhone, req.GuestEmail, req.Note), BookingSource.Web));
        var b = result.Booking;
        b.Room = result.Room;
        var payments = await db.Payments.Where(p => p.BookingId == b.Id).ToListAsync();
        return new { booking = GuestBookingDto.From(b, payments, null), deposit = result.Deposit is null ? null : PaymentDto.From(result.Deposit), phone = b.GuestPhone };
    }

    [HttpPost("bookings/lookup")]
    public async Task<GuestBookingDto> Lookup(string slug, LookupRequest req) => await GuestView(await Find(req.Code, req.Phone));

    [HttpPost("bookings/{code}/change-quote")]
    public async Task<ChangeQuote> ChangeQuote(string slug, string code, GuestChangeRequest req)
    {
        var b = await Find(code, req.Phone);
        return await changes.QuoteChangeAsync(CurrentTenant, b, req.RoomId, StayOf(req, b), req.Guests);
    }

    [HttpPost("bookings/{code}/change")]
    public async Task<object> Change(string slug, string code, GuestChangeRequest req)
    {
        var b = await Find(code, req.Phone);
        var outcome = await changes.RequestChangeAsync(CurrentTenant, b, req.RoomId, StayOf(req, b), req.Guests, Actors.Guest, null);
        return new { message = outcome.Message, status = outcome.Request.Status, extraPayment = outcome.ExtraPayment is null ? null : PaymentDto.From(outcome.ExtraPayment), booking = await GuestView(b) };
    }

    [HttpPost("bookings/{code}/cancel-quote")]
    public async Task<Application.Refunds.RefundQuote> CancelQuote(string slug, string code, GuestPhoneRequest req) =>
        await changes.QuoteCancellationAsync(CurrentTenant, await Find(code, req.Phone));

    [HttpPost("bookings/{code}/cancel")]
    public async Task<object> Cancel(string slug, string code, GuestCancelRequest req)
    {
        var b = await Find(code, req.Phone);
        var outcome = await changes.RequestCancellationAsync(CurrentTenant, b, Actors.Guest, req.Reason);
        return new { message = outcome.Message, status = outcome.Request.Status, refunded = outcome.Refunded, booking = await GuestView(b) };
    }

    [HttpPost("bookings/{code}/pay")]
    public async Task<PaymentDto> Pay(string slug, string code, GuestPhoneRequest req, [FromServices] Application.Payments.PaymentService payments)
    {
        var b = await Find(code, req.Phone);
        var t = CurrentTenant;
        if (b.Status is BookingStatus.Hold or BookingStatus.PendingDeposit)
        {
            var open = await db.Payments.Where(p => p.BookingId == b.Id && p.Kind == PaymentKind.Deposit && p.Status == PaymentStatus.Created)
                .OrderByDescending(p => p.CreatedAt).FirstOrDefaultAsync();
            return PaymentDto.From(open ?? await payments.CreateAsync(t, b, PaymentKind.Deposit, b.DepositAmount, b.HoldExpiresAt));
        }
        var p = await bookings.SendRemainingPaymentAsync(t, b, false) ?? throw AppException.BadRequest("nothing_due", "There's nothing left to pay for this booking.");
        return PaymentDto.From(p);
    }

    [HttpGet("payments/{paymentId:guid}")]
    public async Task<object> GetPayment(string slug, Guid paymentId)
    {
        var p = await db.Payments.Include(x => x.Booking).FirstOrDefaultAsync(x => x.Id == paymentId) ?? throw AppException.NotFound("Payment");
        return new { payment = PaymentDto.From(p), bookingStatus = p.Booking!.Status, bookingCode = p.Booking.Code };
    }

    private async Task<Booking> Find(string code, string phone) => await bookings.FindForGuestAsync(CurrentTenant.Id, code, phone);

    private async Task<GuestBookingDto> GuestView(Booking b)
    {
        if (b.Room == null || b.Room.Photos.Count == 0) b.Room = await db.Rooms.Include(r => r.Photos).FirstAsync(r => r.Id == b.RoomId);
        var payments = await db.Payments.Where(p => p.BookingId == b.Id && p.Status != Stayra.Domain.PaymentStatus.Expired).ToListAsync();
        var pending = await db.ChangeRequests.Where(r => r.BookingId == b.Id && r.Status == ChangeRequestStatus.Pending).OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync();
        return GuestBookingDto.From(b, payments, pending);
    }

    private static Stay? StayOf(GuestChangeRequest req, Booking b) =>
        req.Start != null && req.End != null ? Stay.Parse(req.Mode ?? b.Mode, req.Start, req.End) : null;
}
