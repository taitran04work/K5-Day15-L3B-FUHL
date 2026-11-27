using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stayra.Api.Contracts;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Api.Controllers;

[Route("api/app/overview")]
public class OverviewController(TimeProvider clock) : OwnerControllerBase
{
    private static readonly BookingStatus[] Live = [BookingStatus.PendingDeposit, BookingStatus.Confirmed, BookingStatus.CheckedIn, BookingStatus.CheckedOut];

    [HttpGet]
    public async Task<object> Get()
    {
        var tenant = await CurrentTenantAsync();
        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(TenantTime.ToLocal(tenant, now));
        var dayStart = TenantTime.ToUtc(tenant, today, TimeOnly.MinValue);
        var dayEnd = TenantTime.ToUtc(tenant, today.AddDays(1), TimeOnly.MinValue);
        var weekEnd = TenantTime.ToUtc(tenant, today.AddDays(7), TimeOnly.MinValue);
        var since30 = now.AddDays(-30);

        var rooms = await Db.Rooms.Where(r => r.IsActive).CountAsync();
        var bookings = await Db.Bookings.Include(b => b.Room)
            .Where(b => b.EndAt > dayStart.AddDays(-1) && b.StartAt < weekEnd && Live.Contains(b.Status))
            .ToListAsync();

        var checkIns = bookings.Where(b => b.StartAt >= dayStart && b.StartAt < dayEnd && b.Status is BookingStatus.Confirmed or BookingStatus.PendingDeposit or BookingStatus.CheckedIn)
            .OrderBy(b => b.StartAt).ToList();
        var checkOuts = bookings.Where(b => b.EndAt >= dayStart && b.EndAt < dayEnd && b.Status is BookingStatus.CheckedIn or BookingStatus.CheckedOut or BookingStatus.Confirmed)
            .OrderBy(b => b.EndAt).ToList();
        var inHouse = bookings.Count(b => b.Status == BookingStatus.CheckedIn);

        double Occupancy(DateTimeOffset from, DateTimeOffset to)
        {
            if (rooms == 0) return 0;
            var nights = (to - from).TotalDays;
            var booked = bookings.Where(b => b.Mode == BookingMode.Nightly)
                .Sum(b =>
                {
                    var s = b.StartAt > from ? b.StartAt : from;
                    var e = b.EndAt < to ? b.EndAt : to;
                    return e > s ? Math.Ceiling((e - s).TotalHours / 24.0 - 0.01) : 0;
                });
            return Math.Round(Math.Min(100, booked / (rooms * Math.Max(1, Math.Round(nights))) * 100), 1);
        }

        var paid = await Db.Payments.Where(p => p.Status == PaymentStatus.Paid && p.Kind != PaymentKind.Refund && p.PaidAt >= since30)
            .Select(p => new { p.Amount, p.PaidAt }).ToListAsync();
        var refunds = await Db.Payments.Where(p => p.Kind == PaymentKind.Refund && p.Status == PaymentStatus.Refunded && p.PaidAt >= since30)
            .Select(p => new { p.Amount, p.PaidAt }).ToListAsync();
        var series = Enumerable.Range(0, 30).Select(i => today.AddDays(-29 + i)).Select(d => new
        {
            date = d.ToString("yyyy-MM-dd"),
            amount = paid.Where(p => DateOnly.FromDateTime(TenantTime.ToLocal(tenant, p.PaidAt!.Value)) == d).Sum(p => p.Amount)
                     - refunds.Where(p => DateOnly.FromDateTime(TenantTime.ToLocal(tenant, p.PaidAt!.Value)) == d).Sum(p => p.Amount),
        }).ToList();

        var pendingApprovals = await Db.ChangeRequests.CountAsync(r => r.Status == ChangeRequestStatus.Pending);
        var needsAttention = await Db.Conversations.CountAsync(c => c.NeedsAttention);
        var upcoming = await Db.Bookings.Include(b => b.Room)
            .Where(b => b.StartAt >= now && (b.Status == BookingStatus.Confirmed || b.Status == BookingStatus.PendingDeposit))
            .OrderBy(b => b.StartAt).Take(5).ToListAsync();

        var convs = await Db.Conversations.Where(c => c.CreatedAt >= since30)
            .Select(c => new { c.Status, c.HandoffReason, HasGuest = c.Messages.Any(m => m.Role == MessageRole.Guest), HasOwner = c.Messages.Any(m => m.Role == MessageRole.Owner) })
            .ToListAsync();
        var botMessages = await Db.Messages.CountAsync(m => m.Role == MessageRole.Bot && m.CreatedAt >= since30
            && Db.Conversations.Any(c => c.Id == m.ConversationId));
        var botBookings = await Db.Bookings.CountAsync(b => b.CreatedAt >= since30 && (b.Source == BookingSource.WebChat || b.Source == BookingSource.Zalo)
            && b.Status != BookingStatus.Expired);
        var handled = convs.Count(c => c.HasGuest && !c.HasOwner && c.Status != ConversationStatus.HumanTakeover);

        return new
        {
            date = today.ToString("yyyy-MM-dd"),
            rooms,
            checkIns = checkIns.Select(b => BookingDto.From(b)),
            checkOuts = checkOuts.Select(b => BookingDto.From(b)),
            inHouse,
            occupancyToday = Occupancy(dayStart, dayEnd),
            occupancyNext7 = Occupancy(dayStart, weekEnd),
            revenue30 = series.Sum(s => s.amount),
            revenueSeries = series,
            pendingApprovals,
            needsAttention,
            upcoming = upcoming.Select(b => BookingDto.From(b)),
            bot = new
            {
                conversations = convs.Count(c => c.HasGuest),
                handledByBot = handled,
                handedOff = convs.Count(c => c.HasGuest && (c.HasOwner || c.Status == ConversationStatus.HumanTakeover)),
                botMessages,
                hoursSaved = Math.Round(botMessages * 2 / 60.0, 1),
                bookings = botBookings,
            },
        };
    }
}
