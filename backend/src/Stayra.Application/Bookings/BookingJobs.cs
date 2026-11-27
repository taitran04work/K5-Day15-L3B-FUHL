using Microsoft.EntityFrameworkCore;
using Stayra.Application.Common;

namespace Stayra.Application.Bookings;

/// <summary>Background jobs (Hangfire). Each runs in its own DI scope with tenant filters bypassed.</summary>
public class BookingJobs(IAppDbContext db, ITenantContext tenantContext, BookingService bookings)
{
    public async Task ExpireHolds()
    {
        tenantContext.Set(null, bypass: true);
        await bookings.ExpireHoldsAsync();
    }

    public async Task SendRemainingPayment(Guid bookingId, bool isReminder)
    {
        tenantContext.Set(null, bypass: true);
        var booking = await db.Bookings.IgnoreQueryFilters().FirstOrDefaultAsync(b => b.Id == bookingId);
        if (booking == null) return;
        var tenant = await db.Tenants.FirstAsync(t => t.Id == booking.TenantId);
        tenantContext.Set(tenant.Id);
        booking.RemainingJobId = null;
        await bookings.SendRemainingPaymentAsync(tenant, booking, isReminder);
    }
}
