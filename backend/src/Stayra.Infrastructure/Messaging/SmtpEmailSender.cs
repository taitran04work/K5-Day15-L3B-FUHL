using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Stayra.Application.Common;

namespace Stayra.Infrastructure.Messaging;

public class SmtpOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = true;
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "Stayra";
    public string WebBaseUrl { get; set; } = "http://localhost:5173";
}

/// <summary>Sends transactional emails via SMTP when configured; otherwise logs an email stub.</summary>
public class SmtpEmailSender(IOptions<SmtpOptions> options, ILogger<SmtpEmailSender> log) : IEmailSender
{
    private readonly SmtpOptions _o = options.Value;

    private string FromAddress => !string.IsNullOrWhiteSpace(_o.FromAddress) ? _o.FromAddress.Trim() : _o.Username.Trim();

    public bool IsEnabled => !string.IsNullOrWhiteSpace(_o.Host) && !string.IsNullOrWhiteSpace(FromAddress);

    public string WebBaseUrl => string.IsNullOrWhiteSpace(_o.WebBaseUrl) ? "http://localhost:5173" : _o.WebBaseUrl;

    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        if (!IsEnabled)
        {
            log.LogInformation("[Email stub] To={To} Subject={Subject}\n{Body}", message.To, message.Subject, message.TextBody);
            return;
        }

        using var mail = new MailMessage
        {
            From = new MailAddress(FromAddress, string.IsNullOrWhiteSpace(_o.FromName) ? "Stayra" : _o.FromName.Trim(), Encoding.UTF8),
            Subject = message.Subject,
            SubjectEncoding = Encoding.UTF8,
            Body = message.TextBody,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = false,
        };
        mail.To.Add(new MailAddress(message.To.Trim()));
        if (!string.IsNullOrWhiteSpace(message.ReplyTo))
            mail.ReplyToList.Add(new MailAddress(message.ReplyTo.Trim()));

        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.TextBody, Encoding.UTF8, MediaTypeNames.Text.Plain));
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.HtmlBody, Encoding.UTF8, MediaTypeNames.Text.Html));

        using var client = new SmtpClient(_o.Host.Trim(), _o.Port > 0 ? _o.Port : 587)
        {
            DeliveryMethod = SmtpDeliveryMethod.Network,
            EnableSsl = _o.EnableSsl,
            Timeout = 10_000,
        };
        if (!string.IsNullOrWhiteSpace(_o.Username))
            client.Credentials = new NetworkCredential(_o.Username.Trim(), _o.Password);

        await client.SendMailAsync(mail, ct);
        log.LogInformation("Sent confirmation email to {To} ({Subject})", message.To, message.Subject);
    }
}

