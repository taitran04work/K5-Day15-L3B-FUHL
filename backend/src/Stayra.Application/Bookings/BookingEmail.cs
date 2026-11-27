using System.Globalization;
using System.Net;
using System.Text;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Application.Bookings;

/// <summary>Builds bilingual (Vietnamese / English) booking confirmation emails.</summary>
public static class BookingEmail
{
    public static EmailMessage Confirmation(Tenant tenant, Booking booking, Room? room, string language, string webBaseUrl)
    {
        var vi = GuestText.IsVietnamese(language);
        var culture = GuestText.Culture(language);
        var startLocal = TenantTime.ToLocal(tenant, booking.StartAt);
        var endLocal = TenantTime.ToLocal(tenant, booking.EndAt);

        var roomName = room?.Name ?? booking.Room?.Name ?? "Room";
        var beds = room?.Beds;
        var modeText = booking.Mode == BookingMode.Hourly
            ? (vi ? "Theo giờ" : "Hourly")
            : (vi ? "Theo đêm" : "Nightly");
        var checkInText = booking.Mode == BookingMode.Hourly
            ? startLocal.ToString("dd/MM/yyyy HH:mm", culture)
            : $"{startLocal.ToString("dd/MM/yyyy", culture)} ({(vi ? "từ" : "from")} {tenant.CheckInTime:HH:mm})";
        var checkOutText = booking.Mode == BookingMode.Hourly
            ? endLocal.ToString("dd/MM/yyyy HH:mm", culture)
            : $"{endLocal.ToString("dd/MM/yyyy", culture)} ({(vi ? "trước" : "by")} {tenant.CheckOutTime:HH:mm})";

        var netPaid = Math.Max(0, booking.PaidAmount - booking.RefundAmount);
        var balance = Math.Max(0, booking.TotalAmount - netPaid - booking.CreditAmount);
        var manageUrl = $"{webBaseUrl.TrimEnd('/')}/h/{tenant.Slug}/manage?code={Uri.EscapeDataString(booking.Code)}";

        var subject = vi
            ? $"Xác nhận đặt phòng {booking.Code} tại {tenant.Name}"
            : $"Booking confirmed: {booking.Code} at {tenant.Name}";

        var text = new StringBuilder();
        text.AppendLine(vi ? $"Xin chào {booking.GuestName}," : $"Hi {booking.GuestName},");
        text.AppendLine();
        text.AppendLine(vi
            ? $"Đặt phòng của bạn tại {tenant.Name} đã được xác nhận thành công. Dưới đây là thông tin chi tiết:"
            : $"Your booking at {tenant.Name} is confirmed. Here are your reservation details:");
        text.AppendLine();
        text.AppendLine($"{(vi ? "Mã đặt phòng" : "Booking code")}: {booking.Code}");
        text.AppendLine($"{(vi ? "Phòng" : "Room")}: {roomName}{(string.IsNullOrWhiteSpace(beds) ? "" : $" ({beds})")}");
        text.AppendLine($"{(vi ? "Hình thức" : "Stay mode")}: {modeText}");
        text.AppendLine($"{(vi ? "Nhận phòng" : "Check-in")}: {checkInText}");
        text.AppendLine($"{(vi ? "Trả phòng" : "Check-out")}: {checkOutText}");
        text.AppendLine($"{(vi ? "Số khách" : "Guests")}: {booking.Guests}");
        text.AppendLine($"{(vi ? "Tổng tiền" : "Total")}: {GuestText.Amount(booking.TotalAmount, language)}");
        text.AppendLine($"{(vi ? "Đã thanh toán" : "Paid")}: {GuestText.Amount(netPaid, language)}");
        text.AppendLine($"{(vi ? "Còn lại" : "Balance due")}: {GuestText.Amount(balance, language)}");
        if (!string.IsNullOrWhiteSpace(booking.Note))
            text.AppendLine($"{(vi ? "Ghi chú" : "Special requests")}: {booking.Note}");
        text.AppendLine();
        if (!string.IsNullOrWhiteSpace(tenant.Address))
            text.AppendLine($"{(vi ? "Địa chỉ" : "Address")}: {tenant.Address}");
        if (!string.IsNullOrWhiteSpace(tenant.Phone))
            text.AppendLine($"{(vi ? "Điện thoại liên hệ" : "Phone")}: {tenant.Phone}");
        text.AppendLine($"{(vi ? "Xem / quản lý đặt phòng" : "Manage your booking")}: {manageUrl}");

        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        var accent = string.IsNullOrWhiteSpace(tenant.AccentColor) ? "#1F5F4A" : tenant.AccentColor;
        var html = new StringBuilder();
        html.Append($"""
        <!doctype html>
        <html lang="{(vi ? "vi" : "en")}">
        <body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
          <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;overflow:hidden;">
            <div style="background:{E(accent)};color:#ffffff;padding:20px 24px;">
              <div style="font-size:13px;opacity:0.9;">{E(tenant.Name)}</div>
              <h1 style="margin:6px 0 0;font-size:20px;font-weight:600;">{E(vi ? "Đặt phòng thành công" : "Booking confirmed")}</h1>
            </div>
            <div style="padding:24px;">
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                {E(vi ? $"Xin chào {booking.GuestName}, đặt phòng của bạn đã được xác nhận." : $"Hi {booking.GuestName}, your stay has been confirmed.")}
              </p>
              <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:14px 16px;margin-bottom:18px;">
                <div style="font-size:12px;color:#78716c;">{E(vi ? "Mã đặt phòng" : "Booking code")}</div>
                <div style="font-family:monospace;font-size:20px;font-weight:700;letter-spacing:1px;margin-top:2px;">{E(booking.Code)}</div>
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <tr><td style="padding:8px 0;color:#78716c;border-bottom:1px solid #f5f5f4;">{E(vi ? "Phòng" : "Room")}</td><td style="padding:8px 0;text-align:right;font-weight:600;border-bottom:1px solid #f5f5f4;">{E(roomName)}{(string.IsNullOrWhiteSpace(beds) ? "" : $" <span style=\"font-weight:400;color:#78716c;\">({E(beds)})</span>")}</td></tr>
                <tr><td style="padding:8px 0;color:#78716c;border-bottom:1px solid #f5f5f4;">{E(vi ? "Hình thức" : "Stay mode")}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f5f5f4;">{E(modeText)}</td></tr>
                <tr><td style="padding:8px 0;color:#78716c;border-bottom:1px solid #f5f5f4;">{E(vi ? "Nhận phòng" : "Check-in")}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f5f5f4;">{E(checkInText)}</td></tr>
                <tr><td style="padding:8px 0;color:#78716c;border-bottom:1px solid #f5f5f4;">{E(vi ? "Trả phòng" : "Check-out")}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f5f5f4;">{E(checkOutText)}</td></tr>
                <tr><td style="padding:8px 0;color:#78716c;border-bottom:1px solid #f5f5f4;">{E(vi ? "Số khách" : "Guests")}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f5f5f4;">{booking.Guests}</td></tr>
                <tr><td style="padding:8px 0;color:#78716c;border-bottom:1px solid #f5f5f4;">{E(vi ? "Tổng tiền" : "Total")}</td><td style="padding:8px 0;text-align:right;font-weight:600;border-bottom:1px solid #f5f5f4;">{E(GuestText.Amount(booking.TotalAmount, language))}</td></tr>
                <tr><td style="padding:8px 0;color:#78716c;border-bottom:1px solid #f5f5f4;">{E(vi ? "Đã thanh toán" : "Paid")}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f5f5f4;">{E(GuestText.Amount(netPaid, language))}</td></tr>
                <tr><td style="padding:8px 0;color:#1c1917;font-weight:600;">{E(vi ? "Còn lại" : "Balance due")}</td><td style="padding:8px 0;text-align:right;font-weight:700;">{E(GuestText.Amount(balance, language))}</td></tr>
              </table>
        """);
        if (!string.IsNullOrWhiteSpace(booking.Note))
        {
            html.Append($"""
              <p style="margin:14px 0 0;padding:10px 12px;background:#fafaf9;border-radius:8px;font-size:13px;color:#57534e;">
                <strong>{E(vi ? "Ghi chú" : "Special requests")}:</strong> {E(booking.Note)}
              </p>
            """);
        }
        html.Append($"""
              <div style="margin-top:22px;">
                <a href="{E(manageUrl)}" style="display:inline-block;background:{E(accent)};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600;">
                  {E(vi ? "Xem & quản lý đặt phòng" : "Manage booking")}
                </a>
              </div>
              <hr style="border:none;border-top:1px solid #e7e5e4;margin:22px 0 14px;" />
              <div style="font-size:12px;color:#78716c;line-height:1.6;">
                {(string.IsNullOrWhiteSpace(tenant.Address) ? "" : $"<div>{E(tenant.Address)}</div>")}
                {(string.IsNullOrWhiteSpace(tenant.Phone) ? "" : $"<div>{E(vi ? "Hotline" : "Phone")}: {E(tenant.Phone)}</div>")}
              </div>
            </div>
          </div>
        </body>
        </html>
        """);

        return new EmailMessage(booking.GuestEmail!, subject, html.ToString(), text.ToString(), tenant.Email);
    }
}

