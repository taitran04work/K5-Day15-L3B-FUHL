using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stayra.Api.Contracts;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Messaging;

namespace Stayra.Api.Controllers;

public record OwnerBookingRequest(Guid RoomId, BookingMode Mode, string Start, string End, int Guests, string GuestName, string GuestPhone,
    string? GuestEmail, string? Note, bool MarkConfirmed, decimal? AmountPaid);

public record OwnerChangeRequest(Guid? RoomId, BookingMode? Mode, string? Start, string? End, int? Guests);
public record OwnerCancelRequest(string? Reason, decimal? RefundAmount);
public record CheckOutRequest(bool SettledInCash);
public record DecisionRequest(bool Approve, decimal? RefundAmount, string? Note);

public record BookingDetailDto(BookingDto Booking, RoomDto Room, List<PaymentDto> Payments, List<ChangeRequestDto> Requests,
    List<TimelineItem> Timeline, Guid? ConversationId, IReadOnlyList<BookingStatus> NextStatuses, JsonElement PriceBreakdown, DateTimeOffset? RemainingDueAt);

public record TimelineItem(DateTimeOffset At, string Kind, string Action, string Actor, JsonElement? Data);

[Route("api/app/bookings")]
public class BookingsController(BookingService bookings, ChangeService changes) : OwnerControllerBase
{
    [HttpGet]
    public async Task<object> List([FromQuery] string? status, [FromQuery] string? q, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] Guid? roomId, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var query = Db.Bookings.Include(b => b.Room).AsQueryable();
        if (!string.IsNullOrEmpty(status))
        {
            var statuses = status.Split(',').Select(s => Enum.Parse<BookingStatus>(s, true)).ToList();
            query = query.Where(b => statuses.Contains(b.Status));
        }
        else query = query.Where(b => b.Status != BookingStatus.Expired);
        if (roomId != null) query = query.Where(b => b.RoomId == roomId);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower();
            query = query.Where(b => b.Code.ToLower().Contains(term) || b.GuestName.ToLower().Contains(term) || b.GuestPhone.Contains(term));
        }
        var tenant = await CurrentTenantAsync();
        if (from != null) { var f = TenantTime.ToUtc(tenant, from.Value, TimeOnly.MinValue); query = query.Where(b => b.EndAt > f); }
        if (to != null) { var t = TenantTime.ToUtc(tenant, to.Value.AddDays(1), TimeOnly.MinValue); query = query.Where(b => b.StartAt < t); }

        var total = await query.CountAsync();
        var items = await query.OrderByDescending(b => b.StartAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var pendingIds = await Db.ChangeRequests.Where(r => r.Status == ChangeRequestStatus.Pending).Select(r => r.BookingId).Distinct().ToListAsync();
        return new
        {
            total,
            items = items.Select(b => new { booking = BookingDto.From(b), hasPendingRequest = pendingIds.Contains(b.Id) }),
        };
    }

    /// <summary>Data for the calendar timeline: rooms and bookings overlapping the range.</summary>
    [HttpGet("calendar")]
    public async Task<object> Calendar([FromQuery] DateOnly from, [FromQuery] int days = 14)
    {
        var tenant = await CurrentTenantAsync();
        var start = TenantTime.ToUtc(tenant, from, TimeOnly.MinValue);
        var end = TenantTime.ToUtc(tenant, from.AddDays(Math.Clamp(days, 1, 62)), TimeOnly.MinValue);
        var rooms = await Db.Rooms.Where(r => r.IsActive).OrderBy(r => r.SortOrder).Select(r => new { r.Id, r.Name, r.Code, r.SupportsHourly }).ToListAsync();
        var list = await Db.Bookings.Where(b => b.StartAt < end && b.EndAt > start
                && b.Status != BookingStatus.Expired && b.Status != BookingStatus.Cancelled)
            .OrderBy(b => b.StartAt).ToListAsync();
        var now = DateTimeOffset.UtcNow;
        return new { rooms, bookings = list.Where(b => !(b.Status == BookingStatus.Hold && b.HoldExpiresAt <= now)).Select(b => BookingDto.From(b)) };
    }

    [HttpGet("{id:guid}")]
    public async Task<BookingDetailDto> Get(Guid id)
    {
        var b = await Db.Bookings.Include(x => x.Room).ThenInclude(r => r!.Photos).FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Booking");
        var payments = await Db.Payments.Where(p => p.BookingId == id).OrderBy(p => p.CreatedAt).ToListAsync();
        var requests = await Db.ChangeRequests.Where(r => r.BookingId == id).OrderByDescending(r => r.CreatedAt).ToListAsync();
        var audit = await Db.AuditLogs.Where(a => a.EntityId == id || payments.Select(p => p.Id).Contains(a.EntityId!.Value) || requests.Select(r => r.Id).Contains(a.EntityId!.Value))
            .OrderBy(a => a.CreatedAt).ToListAsync();
        var convId = b.ConversationId ?? await Db.Conversations.Where(c => c.BookingId == id).Select(c => (Guid?)c.Id).FirstOrDefaultAsync();
        var timeline = audit.Select(a => new TimelineItem(a.CreatedAt, a.EntityType, a.Action, a.Actor,
            a.DataJson is null ? null : JsonSerializer.Deserialize<JsonElement>(a.DataJson))).ToList();
        var tenant = await CurrentTenantAsync();
        return new BookingDetailDto(BookingDto.From(b), RoomDto.From(b.Room!), payments.Select(PaymentDto.From).ToList(), requests.Select(ChangeRequestDto.From).ToList(),
            timeline, convId, BookingStateMachine.NextStatuses(b.Status), JsonSerializer.Deserialize<JsonElement>(b.PriceBreakdownJson),
            b.Status is BookingStatus.Confirmed or BookingStatus.CheckedIn ? bookings.RemainingDueAt(tenant, b) : null);
    }

    [HttpPost]
    public async Task<BookingDto> Create(OwnerBookingRequest req)
    {
        var tenant = await CurrentTenantAsync();
        if (string.IsNullOrWhiteSpace(req.GuestName)) throw new AppException(400, "validation", "Enter the guest's name.", new Dictionary<string, string[]> { ["guestName"] = ["required"] });
        if (string.IsNullOrWhiteSpace(req.GuestPhone)) throw new AppException(400, "validation", "Enter the guest's phone.", new Dictionary<string, string[]> { ["guestPhone"] = ["required"] });
        var b = await bookings.CreateByOwnerAsync(tenant, new OwnerBookingInput(req.RoomId, Stay.Parse(req.Mode, req.Start, req.End), req.Guests,
            new GuestInfo(req.GuestName, req.GuestPhone, req.GuestEmail, req.Note), req.MarkConfirmed, req.AmountPaid), Actor);
        return BookingDto.From(b);
    }

    [HttpPost("quote")]
    public async Task<object> Quote([FromBody] OwnerBookingRequest req, [FromServices] Application.Pricing.PricingService pricing)
    {
        var tenant = await CurrentTenantAsync();
        var stay = Stay.Parse(req.Mode, req.Start, req.End);
        var q = await pricing.QuoteAsync(tenant, req.RoomId, stay, req.Guests);
        var available = await bookings.IsAvailableAsync(req.RoomId, q.StartAt, Availability.BlockedUntil(tenant, req.Mode, q.EndAt));
        return new { quote = q, available };
    }

    [HttpPost("{id:guid}/check-in")]
    public async Task<BookingDto> CheckIn(Guid id)
    {
        var b = await Load(id);
        await bookings.CheckInAsync(await CurrentTenantAsync(), b, Actor);
        return BookingDto.From(b);
    }

    [HttpPost("{id:guid}/check-out")]
    public async Task<object> CheckOut(Guid id, CheckOutRequest req)
    {
        var b = await Load(id);
        var link = await bookings.CheckOutAsync(await CurrentTenantAsync(), b, Actor, req.SettledInCash);
        return new { booking = BookingDto.From(b), paymentSent = link != null };
    }

    [HttpPost("{id:guid}/no-show")]
    public async Task<BookingDto> NoShow(Guid id)
    {
        var b = await Load(id);
        await bookings.TransitionAsync(await CurrentTenantAsync(), b, BookingStatus.NoShow, Actor);
        return BookingDto.From(b);
    }

    [HttpPost("{id:guid}/confirm")]
    public async Task<BookingDto> Confirm(Guid id)
    {
        var b = await Load(id);
        var tenant = await CurrentTenantAsync();
        await bookings.TransitionAsync(tenant, b, BookingStatus.Confirmed, Actor, "Confirmed by host");
        bookings.ScheduleRemaining(tenant, b);
        await Db.SaveChangesAsync();
        return BookingDto.From(b);
    }

    [HttpPost("{id:guid}/cancel")]
    public async Task<object> Cancel(Guid id, OwnerCancelRequest req)
    {
        var b = await Load(id);
        var tenant = await CurrentTenantAsync();
        var quote = await changes.QuoteCancellationAsync(tenant, b);
        var request = new BookingChangeRequest
        {
            TenantId = tenant.Id, BookingId = b.Id, Type = ChangeRequestType.Cancel, PayloadJson = JsonSerializer.Serialize(quote, AuditService.Json),
            RefundQuote = quote.RefundAmount, Explanation = quote.Explanation, Reason = req.Reason ?? "Cancelled by host",
        };
        Db.ChangeRequests.Add(request);
        await Db.SaveChangesAsync();
        var outcome = await changes.ApplyCancellationAsync(tenant, request, b, Math.Min(req.RefundAmount ?? quote.RefundAmount, b.PaidAmount - b.RefundAmount), Actor, auto: false);
        return new { booking = BookingDto.From(b), refunded = outcome.Refunded };
    }

    [HttpPost("{id:guid}/cancel-quote")]
    public async Task<Application.Refunds.RefundQuote> CancelQuote(Guid id) => await changes.QuoteCancellationAsync(await CurrentTenantAsync(), await Load(id));

    [HttpPost("{id:guid}/change-quote")]
    public async Task<ChangeQuote> ChangeQuote(Guid id, OwnerChangeRequest req)
    {
        var b = await Load(id);
        var tenant = await CurrentTenantAsync();
        return await changes.QuoteChangeAsync(tenant, b, req.RoomId, StayOf(req, b), req.Guests);
    }

    [HttpPost("{id:guid}/change")]
    public async Task<object> Change(Guid id, OwnerChangeRequest req)
    {
        var b = await Load(id);
        var tenant = await CurrentTenantAsync();
        var outcome = await changes.RequestChangeAsync(tenant, b, req.RoomId, StayOf(req, b), req.Guests, Actor, "Changed by host");
        if (outcome.Request.Status == ChangeRequestStatus.Pending)
            outcome = await changes.ApplyChangeAsync(tenant, outcome.Request, b, Actor, auto: false);
        return new { booking = BookingDto.From(b), message = outcome.Message };
    }

    [HttpPost("{id:guid}/send-remaining")]
    public async Task<object> SendRemaining(Guid id)
    {
        var b = await Load(id);
        var p = await bookings.SendRemainingPaymentAsync(await CurrentTenantAsync(), b, false);
        if (p == null) throw AppException.BadRequest("nothing_due", "There's no balance left to collect for this booking.");
        return PaymentDto.From(p);
    }

    [HttpPost("requests/{requestId:guid}/decide")]
    public async Task<object> Decide(Guid requestId, DecisionRequest req)
    {
        var request = await Db.ChangeRequests.FirstOrDefaultAsync(r => r.Id == requestId) ?? throw AppException.NotFound("Request");
        if (request.Status != ChangeRequestStatus.Pending) throw AppException.Conflict("already_decided", "This request was already decided.");
        var b = await Load(request.BookingId);
        var tenant = await CurrentTenantAsync();
        if (!req.Approve)
        {
            await changes.RejectAsync(tenant, request, b, Actor, req.Note);
            return new { status = "Rejected" };
        }
        var outcome = request.Type == ChangeRequestType.Cancel
            ? await changes.ApplyCancellationAsync(tenant, request, b, Math.Max(0, Math.Min(req.RefundAmount ?? request.RefundQuote, b.PaidAmount - b.RefundAmount)), Actor, auto: false)
            : await changes.ApplyChangeAsync(tenant, request, b, Actor, auto: false);
        return new { status = "Approved", message = outcome.Message, refunded = outcome.Refunded };
    }

    [HttpGet("requests")]
    public async Task<object> PendingRequests()
    {
        var list = await Db.ChangeRequests.Include(r => r.Booking).ThenInclude(b => b!.Room)
            .Where(r => r.Status == ChangeRequestStatus.Pending).OrderBy(r => r.CreatedAt).ToListAsync();
        return list.Select(r => new { request = ChangeRequestDto.From(r), booking = BookingDto.From(r.Booking!) });
    }

    private static Stay? StayOf(OwnerChangeRequest req, Booking b) =>
        req.Start != null && req.End != null ? Stay.Parse(req.Mode ?? b.Mode, req.Start, req.End) : null;

    private async Task<Booking> Load(Guid id) =>
        await Db.Bookings.Include(b => b.Room).FirstOrDefaultAsync(b => b.Id == id) ?? throw AppException.NotFound("Booking");
}

[Route("api/app/payments")]
public class PaymentsController : OwnerControllerBase
{
    [HttpGet]
    public async Task<object> List([FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var q = Db.Payments.Include(p => p.Booking).AsQueryable();
        if (!string.IsNullOrEmpty(status) && Enum.TryParse<PaymentStatus>(status, true, out var s)) q = q.Where(p => p.Status == s);
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(p => p.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var since = DateTimeOffset.UtcNow.AddDays(-30);
        var paid30 = await Db.Payments.Where(p => p.Status == PaymentStatus.Paid && p.Kind != PaymentKind.Refund && p.PaidAt >= since).SumAsync(p => (decimal?)p.Amount) ?? 0;
        var refunded30 = await Db.Payments.Where(p => p.Kind == PaymentKind.Refund && p.Status == PaymentStatus.Refunded && p.PaidAt >= since).SumAsync(p => (decimal?)p.Amount) ?? 0;
        var open = await Db.Payments.Where(p => p.Status == PaymentStatus.Created).SumAsync(p => (decimal?)p.Amount) ?? 0;
        return new
        {
            total,
            summary = new { paid30, refunded30, open },
            items = items.Select(p => new { payment = PaymentDto.From(p), bookingCode = p.Booking!.Code, guestName = p.Booking.GuestName }),
        };
    }
}
