using Microsoft.EntityFrameworkCore;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Application.Pricing;

public class PricingService(IAppDbContext db)
{
    public async Task<Quote> QuoteAsync(Tenant tenant, Guid roomId, Stay stay, int guests, CancellationToken ct = default)
    {
        var room = await db.Rooms.FirstOrDefaultAsync(r => r.Id == roomId && r.TenantId == tenant.Id, ct)
                   ?? throw AppException.NotFound("Room");
        var rules = await RulesFor(tenant.Id, ct);
        return Quote(tenant, room, rules, stay, guests);
    }

    public Task<List<PriceRule>> RulesFor(Guid tenantId, CancellationToken ct = default) =>
        db.PriceRules.Where(r => r.TenantId == tenantId && r.IsActive).ToListAsync(ct);

    public static Quote Quote(Tenant tenant, Room room, IEnumerable<PriceRule> rules, Stay stay, int guests) =>
        stay.Mode == BookingMode.Nightly
            ? PricingEngine.QuoteNightly(tenant, room, rules, stay.CheckIn, stay.CheckOut, guests)
            : PricingEngine.QuoteHourly(tenant, room, rules, stay.StartLocal, stay.EndLocal, guests);

    /// <summary>Effective nightly price per day for the price preview calendar.</summary>
    public async Task<List<(DateOnly Date, decimal Price, string? Rule)>> CalendarAsync(Tenant tenant, Guid roomId, DateOnly from, int days, CancellationToken ct = default)
    {
        var room = await db.Rooms.FirstOrDefaultAsync(r => r.Id == roomId, ct) ?? throw AppException.NotFound("Room");
        var rules = (await RulesFor(tenant.Id, ct)).Where(r => r.RoomId == null || r.RoomId == room.Id).ToList();
        var result = new List<(DateOnly, decimal, string?)>();
        for (var i = 0; i < days; i++)
        {
            var d = from.AddDays(i);
            var (p, name) = PricingEngine.Apply(room.BaseNightlyPrice, rules, d, null, hourly: false);
            result.Add((d, p, name));
        }
        return result;
    }
}
