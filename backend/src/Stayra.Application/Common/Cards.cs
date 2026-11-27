using Stayra.Application.Pricing;
using Stayra.Domain;

namespace Stayra.Application.Common;

/// <summary>Structured message attachments rendered as UI in the widget and as text/links on Zalo.</summary>
public static class Cards
{
    public static string? Cover(Room r) =>
        (r.Photos.FirstOrDefault(p => p.IsCover) ?? r.Photos.OrderBy(p => p.SortOrder).FirstOrDefault())?.Url;

    public static Card Rooms(IEnumerable<(Room Room, Quote? Quote)> rooms, Tenant? tenant = null) => new("room_card", new
    {
        rooms = rooms.Select(x =>
        {
            string? start = null, end = null;
            if (x.Quote is { } q && tenant != null)
            {
                var fmt = q.Mode == BookingMode.Nightly ? "yyyy-MM-dd" : "yyyy-MM-ddTHH:mm";
                start = TenantTime.ToLocal(tenant, q.StartAt).ToString(fmt);
                end = TenantTime.ToLocal(tenant, q.EndAt).ToString(fmt);
            }
            return new
            {
                id = x.Room.Id,
                name = x.Room.Name,
                coverUrl = Cover(x.Room),
                maxGuests = x.Room.MaxGuests,
                beds = x.Room.Beds,
                nightlyPrice = x.Room.SupportsNightly ? x.Room.BaseNightlyPrice : (decimal?)null,
                hourlyPrice = x.Room.SupportsHourly ? x.Room.BaseHourlyPrice : (decimal?)null,
                total = x.Quote?.Total,
                deposit = x.Quote?.Deposit,
                units = x.Quote?.Units,
                mode = x.Quote?.Mode.ToString(),
                guests = x.Quote?.Guests,
                start,
                end,
            };
        }).ToList(),
    });

    public static Card Gallery(Room r) => new("gallery", new
    {
        roomId = r.Id,
        roomName = r.Name,
        photos = r.Photos.OrderBy(p => p.SortOrder).Select(p => new { url = p.Url, caption = p.Caption }).ToList(),
    });

    public static Card QuoteCard(Quote q, Tenant? tenant = null)
    {
        var fmt = q.Mode == BookingMode.Nightly ? "yyyy-MM-dd" : "yyyy-MM-ddTHH:mm";
        var start = tenant != null ? TenantTime.ToLocal(tenant, q.StartAt).ToString(fmt) : null;
        var end = tenant != null ? TenantTime.ToLocal(tenant, q.EndAt).ToString(fmt) : null;
        return new("quote", new
        {
            roomId = q.RoomId,
            roomName = q.RoomName,
            mode = q.Mode.ToString(),
            startAt = q.StartAt,
            endAt = q.EndAt,
            start,
            end,
            units = q.Units,
            guests = q.Guests,
            subtotal = q.Subtotal,
            extraGuestFee = q.ExtraGuestFee,
            total = q.Total,
            deposit = q.Deposit,
            depositPercent = q.DepositPercent,
            lines = q.Lines.Select(l => new { label = l.Label, price = l.Price, rule = l.RuleName }).ToList(),
        });
    }

    public static Card BookingSummary(Booking b, Room? room) => new("booking_summary", new
    {
        bookingId = b.Id,
        code = b.Code,
        status = b.Status.ToString(),
        roomName = room?.Name ?? b.Room?.Name,
        mode = b.Mode.ToString(),
        startAt = b.StartAt,
        endAt = b.EndAt,
        guests = b.Guests,
        guestName = b.GuestName,
        total = b.TotalAmount,
        deposit = b.DepositAmount,
        paid = b.PaidAmount,
        refunded = b.RefundAmount,
        balance = Math.Max(0, b.TotalAmount - b.PaidAmount + b.RefundAmount - b.CreditAmount),
        holdExpiresAt = b.HoldExpiresAt,
    });

    public static Card PaymentCard(Payment p, string bookingCode) => new("payment", new
    {
        paymentId = p.Id,
        bookingCode,
        kind = p.Kind.ToString(),
        amount = p.Amount,
        payUrl = p.PayUrl,
        qrCodeUrl = p.QrCodeUrl,
        deeplink = p.Deeplink,
        status = p.Status.ToString(),
        expiresAt = p.ExpiresAt,
    });
}
