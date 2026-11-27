using Stayra.Domain;

namespace Stayra.Application.Bookings;

public static class Availability
{
    /// <summary>Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd).</summary>
    public static bool Overlaps(DateTimeOffset aStart, DateTimeOffset aEnd, DateTimeOffset bStart, DateTimeOffset bEnd) =>
        aStart < bEnd && bStart < aEnd;

    /// <summary>Hourly bookings block the room for an extra cleaning buffer; nightly stays already include turnover time.</summary>
    public static DateTimeOffset BlockedUntil(Tenant tenant, BookingMode mode, DateTimeOffset endAt) =>
        mode == BookingMode.Hourly ? endAt.AddMinutes(tenant.CleaningBufferMinutes) : endAt;

    public static bool IsBlocking(Booking b, DateTimeOffset now) =>
        BookingStateMachine.IsBlocking(b.Status) && !(b.Status == BookingStatus.Hold && b.HoldExpiresAt <= now);
}
