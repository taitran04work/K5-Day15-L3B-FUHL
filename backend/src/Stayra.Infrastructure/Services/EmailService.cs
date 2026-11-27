using System.Globalization;
using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Infrastructure.Services;

public class SmtpOptions
{
    public string Host { get; set; } = "smtp.gmail.com";
    public int Port { get; set; } = 587;
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromEmail { get; set; } = "";
    public string FromName { get; set; } = "Stayra";
    public bool EnableSsl { get; set; } = true;
}

public class SmtpEmailNotifier(
    IOptions<SmtpOptions> options,
    ISecretProtector secrets,
    IConfiguration config,
    ILogger<SmtpEmailNotifier> log) : IEmailNotifier
{
    private static readonly TimeSpan VnOffset = TimeSpan.FromHours(7);

    public async Task SendBookingConfirmationAsync(Tenant tenant, Booking booking, Room? room, string language, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(booking.GuestEmail))
            return;

        // Per-store SMTP takes precedence; falls back to platform .env SMTP if not configured.
        var storePassword = secrets.Unprotect(tenant.SmtpPasswordEnc);
        var useStore = !string.IsNullOrWhiteSpace(tenant.SmtpUsername) && !string.IsNullOrWhiteSpace(storePassword);

        var opt = options.Value;
        var host = useStore ? (string.IsNullOrWhiteSpace(tenant.SmtpHost) ? "smtp.gmail.com" : tenant.SmtpHost!) : opt.Host;
        var port = useStore ? (tenant.SmtpPort ?? 587) : opt.Port;
        var username = useStore ? tenant.SmtpUsername! : opt.Username;
        var password = useStore ? storePassword! : opt.Password;
        var enableSsl = useStore ? tenant.SmtpEnableSsl : opt.EnableSsl;
        var configuredFromEmail = useStore ? tenant.SmtpFromEmail : opt.FromEmail;
        var configuredFromName = useStore ? tenant.SmtpFromName : opt.FromName;

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            log.LogDebug("Skipping confirmation email for booking {Code}: SMTP credentials are not configured.", booking.Code);
            return;
        }

        var fromEmail = string.IsNullOrWhiteSpace(configuredFromEmail) ? username : configuredFromEmail.Trim();
        var fromName = string.IsNullOrWhiteSpace(configuredFromName) ? tenant.Name : configuredFromName.Trim();
        var vi = GuestText.IsVietnamese(language);

        var startLocal = booking.StartAt.ToOffset(VnOffset);
        var endLocal = booking.EndAt.ToOffset(VnOffset);
        var whenText = booking.Mode == BookingMode.Nightly
            ? $"{startLocal:dd/MM/yyyy} – {endLocal:dd/MM/yyyy}"
            : $"{startLocal:dd/MM/yyyy HH:mm} – {endLocal:HH:mm}";

        var webBase = (config["App:WebBaseUrl"] ?? "http://localhost:5173").TrimEnd('/');
        var manageUrl = $"{webBase}/h/{tenant.Slug}/manage?code={Uri.EscapeDataString(booking.Code)}";
        var roomName = room?.Name ?? (vi ? "Phòng đã đặt" : "Reserved room");
        var balance = Math.Max(0, booking.TotalAmount - booking.PaidAmount + booking.RefundAmount - booking.CreditAmount);

        var subject = vi
            ? $"[{tenant.Name}] Xác nhận đặt phòng {booking.Code}"
            : $"[{tenant.Name}] Booking confirmation {booking.Code}";

        var html = BuildHtml(tenant, booking, roomName, whenText, balance, manageUrl, vi);

        try
        {
            using var msg = new MailMessage
            {
                From = new MailAddress(fromEmail, fromName, Encoding.UTF8),
                Subject = subject,
                SubjectEncoding = Encoding.UTF8,
                Body = html,
                BodyEncoding = Encoding.UTF8,
                IsBodyHtml = true,
            };
            msg.To.Add(new MailAddress(booking.GuestEmail.Trim(), booking.GuestName, Encoding.UTF8));

            using var client = new SmtpClient(host.Trim(), port)
            {
                EnableSsl = enableSsl,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false,
                Credentials = new NetworkCredential(username.Trim(), password),
                Timeout = 15_000,
            };

            await client.SendMailAsync(msg, ct);
            log.LogInformation("Sent booking confirmation email for {Code} to {Email} (perStore={PerStore})", booking.Code, booking.GuestEmail, useStore);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Failed to send booking confirmation email for {Code} to {Email}", booking.Code, booking.GuestEmail);
        }
    }

    private static string Vnd(decimal amount) => $"{amount.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))} ₫";

    private static string H(string? s) => WebUtility.HtmlEncode(s ?? "");

    private static string BuildHtml(Tenant tenant, Booking b, string roomName, string whenText, decimal balance, string manageUrl, bool vi)
    {
        var title = vi ? "Đặt phòng của bạn đã được xác nhận" : "Your booking is confirmed";
        var greeting = vi ? $"Xin chào {H(b.GuestName)}," : $"Hi {H(b.GuestName)},";
        var intro = vi
            ? $"{H(tenant.Name)} rất hân hạnh đón tiếp bạn. Dưới đây là thông tin chi tiết cho đặt phòng của bạn:"
            : $"{H(tenant.Name)} looks forward to welcoming you. Here are your confirmed booking details:";
        var codeLabel = vi ? "Mã đặt phòng" : "Booking code";
        var roomLabel = vi ? "Phòng" : "Room";
        var timeLabel = vi ? "Thời gian lưu trú" : "Stay dates";
        var guestsLabel = vi ? "Số khách" : "Guests";
        var totalLabel = vi ? "Tổng tiền" : "Total";
        var paidLabel = vi ? "Đã thanh toán" : "Paid";
        var balanceLabel = vi ? "Còn lại" : "Balance due";
        var ctaLabel = vi ? "Xem & quản lý đặt phòng" : "Manage your booking";

        return $"""
<!DOCTYPE html>
<html lang="{(vi ? "vi" : "en")}">
<body style="margin:0;padding:24px;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b1a18;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e1d8;border-radius:16px;overflow:hidden;">
    <tr>
      <td style="padding:28px 32px 20px;border-bottom:1px solid #eeeae2;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#1f5f4a;">{H(tenant.Name)}</p>
        <h1 style="margin:0;font-size:22px;line-height:1.3;color:#171614;">{title}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 32px;">
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">{greeting}</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a4843;">{intro}</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f4;border:1px solid #ece8df;border-radius:12px;padding:16px;">
          <tr><td style="padding:6px 0;font-size:13px;color:#66635d;">{codeLabel}</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:700;font-family:monospace;">{H(b.Code)}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#66635d;">{roomLabel}</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:600;">{H(roomName)}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#66635d;">{timeLabel}</td><td align="right" style="padding:6px 0;font-size:14px;">{H(whenText)}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#66635d;">{guestsLabel}</td><td align="right" style="padding:6px 0;font-size:14px;">{b.Guests}</td></tr>
          <tr><td colspan="2" style="border-top:1px solid #e5e1d8;padding-top:10px;margin-top:6px;"></td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#66635d;">{totalLabel}</td><td align="right" style="padding:4px 0;font-size:14px;font-weight:600;">{Vnd(b.TotalAmount)}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#66635d;">{paidLabel}</td><td align="right" style="padding:4px 0;font-size:14px;">{Vnd(b.PaidAmount)}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#66635d;">{balanceLabel}</td><td align="right" style="padding:4px 0;font-size:14px;font-weight:700;color:#1f5f4a;">{Vnd(balance)}</td></tr>
        </table>
        <div style="margin-top:24px;text-align:center;">
          <a href="{H(manageUrl)}" style="display:inline-block;padding:12px 24px;background:#1f5f4a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;border-radius:999px;">{ctaLabel}</a>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 32px;background:#faf8f4;border-top:1px solid #eeeae2;font-size:12px;color:#78746d;line-height:1.5;">
        {H(tenant.Address)} {(string.IsNullOrWhiteSpace(tenant.Phone) ? "" : $" · {H(tenant.Phone)}")}
      </td>
    </tr>
  </table>
</body>
</html>
""";
    }
}
