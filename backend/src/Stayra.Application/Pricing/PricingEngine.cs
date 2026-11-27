using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Application.Pricing;

public record QuoteLine(string Label, DateOnly Date, int? Hour, decimal BasePrice, decimal Price, string? RuleName);

public record Quote(
    Guid RoomId,
    string RoomName,
    BookingMode Mode,
    DateTimeOffset StartAt,
    DateTimeOffset EndAt,
    int Units,
    int Guests,
    IReadOnlyList<QuoteLine> Lines,
    decimal Subtotal,
    decimal ExtraGuestFee,
    decimal Total,
    decimal Deposit,
    int DepositPercent,
    string Currency);

public class PricingException(string code, string message) : AppException(400, code, message);

/// <summary>
/// Pure, deterministic pricing. Inputs are local (tenant time zone) dates/times.
/// Rule order per unit: an Override (highest Priority wins) replaces the base price and stops;
/// otherwise Fixed adjustments are summed, then Percent adjustments are summed and applied.
/// Each unit price is rounded to the nearest 1,000 VND.
/// </summary>
public static class PricingEngine
{
    public static Quote QuoteNightly(Tenant tenant, Room room, IEnumerable<PriceRule> rules, DateOnly checkIn, DateOnly checkOut, int guests)
    {
        if (!room.SupportsNightly) throw new PricingException("mode_not_supported", $"{room.Name} can't be booked by the night.");
        var nights = checkOut.DayNumber - checkIn.DayNumber;
        if (nights < 1) throw new PricingException("invalid_dates", "Check-out must be at least one day after check-in.");
        if (nights > 60) throw new PricingException("too_long", "Stays longer than 60 nights need to be arranged with the host.");
        ValidateGuests(room, guests);

        var applicable = Applicable(room, rules).ToList();
        var lines = new List<QuoteLine>();
        for (var d = checkIn; d < checkOut; d = d.AddDays(1))
        {
            var (price, ruleName) = Apply(room.BaseNightlyPrice, applicable, d, null, hourly: false);
            lines.Add(new QuoteLine(d.ToString("yyyy-MM-dd"), d, null, room.BaseNightlyPrice, price, ruleName));
        }

        var extra = Math.Max(0, guests - room.BaseGuests) * room.ExtraGuestFee * nights;
        return Build(tenant, room, BookingMode.Nightly,
            TenantTime.ToUtc(tenant, checkIn, tenant.CheckInTime),
            TenantTime.ToUtc(tenant, checkOut, tenant.CheckOutTime),
            nights, guests, lines, extra);
    }

    public static Quote QuoteHourly(Tenant tenant, Room room, IEnumerable<PriceRule> rules, DateTime startLocal, DateTime endLocal, int guests)
    {
        if (!room.SupportsHourly) throw new PricingException("mode_not_supported", $"{room.Name} can't be booked by the hour.");
        if (endLocal <= startLocal) throw new PricingException("invalid_times", "End time must be after start time.");
        var hours = (int)Math.Ceiling((endLocal - startLocal).TotalHours - 1e-9);
        if (hours < room.MinHours) throw new PricingException("min_hours", $"{room.Name} needs at least {room.MinHours} hours.");
        if (startLocal.Date != endLocal.Date && !(endLocal.TimeOfDay == TimeSpan.Zero && endLocal.Date == startLocal.Date.AddDays(1)))
            throw new PricingException("outside_hours", "Hourly stays must start and end on the same day.");
        var open = tenant.OpeningTime.ToTimeSpan();
        var close = tenant.ClosingTime.ToTimeSpan();
        var endTod = endLocal.Date > startLocal.Date ? TimeSpan.FromHours(24) : endLocal.TimeOfDay;
        if (startLocal.TimeOfDay < open || endTod > close)
            throw new PricingException("outside_hours", $"Hourly stays are available between {tenant.OpeningTime:HH\\:mm} and {tenant.ClosingTime:HH\\:mm}.");
        ValidateGuests(room, guests);

        var applicable = Applicable(room, rules).ToList();
        var lines = new List<QuoteLine>();
        for (var i = 0; i < hours; i++)
        {
            var t = startLocal.AddHours(i);
            var date = DateOnly.FromDateTime(t);
            var (price, ruleName) = Apply(room.BaseHourlyPrice, applicable, date, TimeOnly.FromDateTime(t), hourly: true);
            lines.Add(new QuoteLine($"{t:HH:mm}", date, t.Hour, room.BaseHourlyPrice, price, ruleName));
        }

        var extra = Math.Max(0, guests - room.BaseGuests) * room.ExtraGuestFee;
        return Build(tenant, room, BookingMode.Hourly,
            TenantTime.ToUtc(tenant, startLocal), TenantTime.ToUtc(tenant, startLocal.AddHours(hours)),
            hours, guests, lines, extra);
    }

    public static decimal DepositFor(decimal total, int percent) => Money.RoundThousand(total * percent / 100m);

    private static void ValidateGuests(Room room, int guests)
    {
        if (guests < 1) throw new PricingException("invalid_guests", "At least one guest is required.");
        if (guests > room.MaxGuests) throw new PricingException("too_many_guests", $"{room.Name} fits up to {room.MaxGuests} guests.");
    }

    private static IEnumerable<PriceRule> Applicable(Room room, IEnumerable<PriceRule> rules) =>
        rules.Where(r => r.IsActive && (r.RoomId == null || r.RoomId == room.Id));

    private static bool Matches(PriceRule r, DateOnly date, TimeOnly? time, bool hourly)
    {
        var inRange = (r.StartDate == null || date >= r.StartDate) && (r.EndDate == null || date <= r.EndDate);
        var dayOk = r.DaysOfWeek.Count == 0 || r.DaysOfWeek.Contains(date.DayOfWeek);
        return r.Type switch
        {
            PriceRuleType.Weekend => inRange && (r.DaysOfWeek.Count == 0
                ? date.DayOfWeek is DayOfWeek.Friday or DayOfWeek.Saturday
                : r.DaysOfWeek.Contains(date.DayOfWeek)),
            PriceRuleType.DateRange or PriceRuleType.Holiday => r.StartDate != null && inRange && dayOk,
            PriceRuleType.HourWindow => hourly && time is { } t && inRange && dayOk
                && r.StartTime is { } s && r.EndTime is { } e
                && (s <= e ? t >= s && t < e : t >= s || t < e),
            _ => false,
        };
    }

    internal static (decimal Price, string? RuleName) Apply(decimal basePrice, IReadOnlyList<PriceRule> rules, DateOnly date, TimeOnly? time, bool hourly)
    {
        var matching = rules.Where(r => Matches(r, date, time, hourly)).OrderByDescending(r => r.Priority).ToList();
        if (matching.Count == 0) return (basePrice, null);

        var overrideRule = matching.FirstOrDefault(r => r.AdjustmentType == AdjustmentType.Override);
        if (overrideRule != null) return (Money.RoundThousand(overrideRule.Value), overrideRule.Name);

        var price = basePrice;
        var fixedRules = matching.Where(r => r.AdjustmentType == AdjustmentType.Fixed).ToList();
        price += fixedRules.Sum(r => r.Value);
        var pctRules = matching.Where(r => r.AdjustmentType == AdjustmentType.Percent).ToList();
        price *= 1 + pctRules.Sum(r => r.Value) / 100m;
        price = Math.Max(0, Money.RoundThousand(price));
        var names = fixedRules.Concat(pctRules).Select(r => r.Name);
        return (price, string.Join(", ", names));
    }

    private static Quote Build(Tenant tenant, Room room, BookingMode mode, DateTimeOffset start, DateTimeOffset end,
        int units, int guests, List<QuoteLine> lines, decimal extra)
    {
        var subtotal = lines.Sum(l => l.Price);
        var total = subtotal + extra;
        return new Quote(room.Id, room.Name, mode, start, end, units, guests, lines, subtotal, extra, total,
            DepositFor(total, tenant.DepositPercent), tenant.DepositPercent, tenant.Currency);
    }
}
