using System.Globalization;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Application.Bookings;

/// <summary>A requested stay in the tenant's local time. Nightly uses dates; hourly uses local date-times.</summary>
public record Stay(BookingMode Mode, DateOnly CheckIn, DateOnly CheckOut, DateTime StartLocal, DateTime EndLocal)
{
    private static readonly string[] DateTimeFormats =
        ["yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-ddTHH:mmK", "yyyy-MM-ddTHH:mm:ssK", "o"];

    public static Stay Parse(BookingMode mode, string start, string end)
    {
        if (mode == BookingMode.Nightly)
        {
            var ci = ParseDate(start, "start");
            var co = ParseDate(end, "end");
            return new Stay(mode, ci, co, ci.ToDateTime(TimeOnly.MinValue), co.ToDateTime(TimeOnly.MinValue));
        }
        var s = ParseLocal(start, "start");
        var e = ParseLocal(end, "end");
        return new Stay(mode, DateOnly.FromDateTime(s), DateOnly.FromDateTime(e), s, e);
    }

    public static Stay Nightly(DateOnly ci, DateOnly co) => new(BookingMode.Nightly, ci, co, ci.ToDateTime(TimeOnly.MinValue), co.ToDateTime(TimeOnly.MinValue));
    public static Stay Hourly(DateTime s, DateTime e) => new(BookingMode.Hourly, DateOnly.FromDateTime(s), DateOnly.FromDateTime(e), s, e);

    public static Stay FromBooking(Tenant t, Booking b)
    {
        var s = TenantTime.ToLocal(t, b.StartAt);
        var e = TenantTime.ToLocal(t, b.EndAt);
        return b.Mode == BookingMode.Nightly ? Nightly(DateOnly.FromDateTime(s), DateOnly.FromDateTime(e)) : Hourly(s, e);
    }

    private static DateOnly ParseDate(string v, string field)
    {
        v = v.Trim();
        if (DateOnly.TryParseExact(v, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
        if (DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt)) return DateOnly.FromDateTime(dt);
        throw new AppException(400, "invalid_date", $"The {field} date \"{v}\" isn't a valid date (use YYYY-MM-DD).");
    }

    private static DateTime ParseLocal(string v, string field)
    {
        v = v.Trim();
        if (DateTime.TryParseExact(v, DateTimeFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
            return DateTime.SpecifyKind(dt, DateTimeKind.Unspecified);
        throw new AppException(400, "invalid_time", $"The {field} time \"{v}\" isn't valid (use YYYY-MM-DDTHH:mm in local time).");
    }
}
