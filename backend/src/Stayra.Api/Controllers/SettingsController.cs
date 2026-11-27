using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stayra.Api.Contracts;
using Stayra.Api.Infrastructure;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Concierge;

namespace Stayra.Api.Controllers;

public record WebsiteSettingsInput(string Name, string? Description, string? Address, string? Phone, string? Email, string AccentColor,
    double? Latitude, double? Longitude, string DefaultLanguage);

public record BookingSettingsInput(string CheckInTime, string CheckOutTime, string OpeningTime, string ClosingTime, int CleaningBufferMinutes,
    int DepositPercent, RemainingPaymentTrigger RemainingPaymentTrigger, int RemainingPaymentHours, int RemainingReminderHours, int HoldMinutes,
    LowerPriceHandling LowerPriceHandling);

// Older clients still include DefaultLanguage. Only the website settings endpoint saves it.
public record BotSettingsInput(bool BotEnabled, string? BotPersona, bool AutoApproveChanges, bool AutoApproveCancellations, string DefaultLanguage = "");

public record MomoSettingsInput(string? PartnerCode, string? AccessKey, string? SecretKey);

/// <summary>Bring-your-own AI key. <c>ApiKey</c> is write-only: it's verified, encrypted and never returned.</summary>
public record AiSettingsInput(string? ApiKey, string? Model, bool RemoveKey = false);
public record AiTestResult(bool Ok, string? Error);

public class WebsiteSettingsValidator : AbstractValidator<WebsiteSettingsInput>
{
    public WebsiteSettingsValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("required").MaximumLength(200);
        RuleFor(x => x.AccentColor).Matches("^#[0-9A-Fa-f]{6}$").WithErrorCode("color_format");
        RuleFor(x => x.Email).EmailAddress().When(x => !string.IsNullOrEmpty(x.Email)).WithErrorCode("email");
        RuleFor(x => x.Phone).Must(p => Phone.NormalizeVn(p) != null).When(x => !string.IsNullOrEmpty(x.Phone)).WithErrorCode("phone");
        RuleFor(x => x.DefaultLanguage).Must(l => l is "en" or "vi").WithErrorCode("invalid");
    }
}

public class BookingSettingsValidator : AbstractValidator<BookingSettingsInput>
{
    public BookingSettingsValidator()
    {
        RuleFor(x => x.CheckInTime).Must(BeTime).WithErrorCode("time_format");
        RuleFor(x => x.CheckOutTime).Must(BeTime).WithErrorCode("time_format");
        RuleFor(x => x.OpeningTime).Must(BeTime).WithErrorCode("time_format");
        RuleFor(x => x.ClosingTime).Must(BeTime).WithErrorCode("time_format");
        RuleFor(x => x.DepositPercent).InclusiveBetween(0, 100).WithErrorCode("out_of_range");
        RuleFor(x => x.HoldMinutes).InclusiveBetween(5, 120).WithErrorCode("out_of_range");
        RuleFor(x => x.CleaningBufferMinutes).InclusiveBetween(0, 240).WithErrorCode("out_of_range");
        RuleFor(x => x.RemainingPaymentHours).InclusiveBetween(0, 720).WithErrorCode("out_of_range");
        RuleFor(x => x.RemainingReminderHours).InclusiveBetween(0, 168).WithErrorCode("out_of_range");
    }

    private static bool BeTime(string v) => TimeOnly.TryParse(v, out _);
}

[Route("api/app/settings")]
public class SettingsController(IFileStorage storage, ISecretProtector secrets) : OwnerControllerBase
{
    [HttpGet]
    public async Task<TenantSettingsDto> Get() => TenantSettingsDto.From(await CurrentTenantAsync());

    [HttpPut("website")]
    public async Task<TenantSettingsDto> Website(WebsiteSettingsInput i, [FromServices] IValidator<WebsiteSettingsInput> v)
    {
        await v.ValidateOrThrow(i);
        var t = await CurrentTenantAsync();
        t.Name = i.Name.Trim();
        t.Description = i.Description?.Trim();
        t.Address = i.Address?.Trim();
        t.Phone = string.IsNullOrEmpty(i.Phone) ? null : Phone.NormalizeVn(i.Phone);
        t.Email = i.Email?.Trim();
        t.AccentColor = i.AccentColor;
        t.Latitude = i.Latitude;
        t.Longitude = i.Longitude;
        t.DefaultLanguage = i.DefaultLanguage;
        await Save("settings.website");
        return TenantSettingsDto.From(t);
    }

    [HttpPut("booking")]
    public async Task<TenantSettingsDto> Booking(BookingSettingsInput i, [FromServices] IValidator<BookingSettingsInput> v)
    {
        await v.ValidateOrThrow(i);
        var t = await CurrentTenantAsync();
        t.CheckInTime = TimeOnly.Parse(i.CheckInTime);
        t.CheckOutTime = TimeOnly.Parse(i.CheckOutTime);
        t.OpeningTime = TimeOnly.Parse(i.OpeningTime);
        t.ClosingTime = TimeOnly.Parse(i.ClosingTime);
        t.CleaningBufferMinutes = i.CleaningBufferMinutes;
        t.DepositPercent = i.DepositPercent;
        t.RemainingPaymentTrigger = i.RemainingPaymentTrigger;
        t.RemainingPaymentHours = i.RemainingPaymentHours;
        t.RemainingReminderHours = i.RemainingReminderHours;
        t.HoldMinutes = i.HoldMinutes;
        t.LowerPriceHandling = i.LowerPriceHandling;
        await Save("settings.booking");
        return TenantSettingsDto.From(t);
    }

    [HttpPut("bot")]
    public async Task<TenantSettingsDto> Bot(BotSettingsInput i)
    {
        var t = await CurrentTenantAsync();
        t.BotEnabled = i.BotEnabled;
        t.BotPersona = i.BotPersona?.Trim() is { Length: > 0 } p ? (p.Length > 1000 ? p[..1000] : p) : null;
        t.AutoApproveChanges = i.AutoApproveChanges;
        t.AutoApproveCancellations = i.AutoApproveCancellations;
        await Save("settings.bot");
        return TenantSettingsDto.From(t);
    }

    [HttpPut("momo")]
    public async Task<TenantSettingsDto> Momo(MomoSettingsInput i)
    {
        var t = await CurrentTenantAsync();
        t.MomoPartnerCode = string.IsNullOrWhiteSpace(i.PartnerCode) ? null : i.PartnerCode.Trim();
        if (!string.IsNullOrWhiteSpace(i.AccessKey)) t.MomoAccessKeyEnc = secrets.Protect(i.AccessKey.Trim());
        if (!string.IsNullOrWhiteSpace(i.SecretKey)) t.MomoSecretKeyEnc = secrets.Protect(i.SecretKey.Trim());
        if (t.MomoPartnerCode == null) { t.MomoAccessKeyEnc = null; t.MomoSecretKeyEnc = null; }
        await Save("settings.momo");
        return TenantSettingsDto.From(t);
    }

    [HttpPut("ai")]
    public async Task<TenantSettingsDto> Ai(AiSettingsInput i, CancellationToken ct)
    {
        var t = await CurrentTenantAsync();
        if (!string.IsNullOrWhiteSpace(i.Model))
        {
            if (!TenantAi.Models.Contains(i.Model))
                throw new AppException(400, "invalid", "Unknown model.", new Dictionary<string, string[]> { ["model"] = ["invalid"] });
            t.AiModel = i.Model;
        }
        if (i.RemoveKey)
        {
            t.AnthropicApiKeyEnc = null;
            t.AnthropicKeyHint = null;
        }
        else if (!string.IsNullOrWhiteSpace(i.ApiKey))
        {
            var key = i.ApiKey.Trim();
            // verify before storing; only a definitely-wrong key or model is rejected (network hiccups still save)
            var (ok, error) = await TenantAi.TestKeyAsync(key, t.AiModel ?? TenantAi.Models[0], ct);
            if (!ok && error is "invalid_key" or "model_unavailable")
                throw new AppException(400, error, "The AI provider rejected this key.", new Dictionary<string, string[]> { ["apiKey"] = [error] });
            t.AnthropicApiKeyEnc = secrets.Protect(key);
            t.AnthropicKeyHint = TenantAi.Hint(key);
        }
        await Save("settings.ai");
        return TenantSettingsDto.From(t);
    }

    /// <summary>Checks the stored key against the provider without changing anything.</summary>
    [HttpPost("ai/test")]
    public async Task<AiTestResult> TestAi([FromServices] TenantAi ai, CancellationToken ct)
    {
        var t = await CurrentTenantAsync();
        var key = secrets.Unprotect(t.AnthropicApiKeyEnc);
        if (string.IsNullOrWhiteSpace(key)) return new AiTestResult(false, "no_key");
        var (ok, error) = await TenantAi.TestKeyAsync(key, ai.Model(t), ct);
        return new AiTestResult(ok, error);
    }

    [HttpPost("images/{kind}")]
    [RequestSizeLimit(20_000_000)]
    public async Task<TenantSettingsDto> UploadImage(string kind, IFormFile file)
    {
        if (!ImageSlots.Contains(kind)) throw AppException.NotFound("Image type");
        if (file == null || !file.ContentType.StartsWith("image/")) throw AppException.BadRequest("not_an_image", "Choose an image file.");
        var t = await CurrentTenantAsync();
        var ext = file.ContentType switch { "image/webp" => "webp", "image/png" => "png", "image/svg+xml" => "svg", _ => "jpg" };
        await using var s = file.OpenReadStream();
        var url = await storage.SaveAsync(s, $"{t.Id}/{kind}-{Guid.NewGuid():N}.{ext}", file.ContentType);
        SetImage(t, kind, url);
        await Save($"settings.{kind}");
        return TenantSettingsDto.From(t);
    }

    [HttpDelete("images/{kind}")]
    public async Task<TenantSettingsDto> RemoveImage(string kind)
    {
        if (!ImageSlots.Contains(kind)) throw AppException.NotFound("Image type");
        var t = await CurrentTenantAsync();
        SetImage(t, kind, null);
        await Save($"settings.{kind}.removed");
        return TenantSettingsDto.From(t);
    }

    /// <summary>Logo, cover (= home hero background) and the per-slide home page backgrounds.</summary>
    private static readonly string[] ImageSlots = ["logo", "cover", "bg-about", "bg-rooms", "bg-policies", "bg-contact"];

    private static void SetImage(Tenant t, string kind, string? url)
    {
        switch (kind)
        {
            case "logo": t.LogoUrl = url; break;
            case "cover": t.CoverImageUrl = url; break;
            case "bg-about": t.BgAboutUrl = url; break;
            case "bg-rooms": t.BgRoomsUrl = url; break;
            case "bg-policies": t.BgPoliciesUrl = url; break;
            case "bg-contact": t.BgContactUrl = url; break;
        }
    }

    private async Task Save(string action)
    {
        Db.AuditLogs.Add(new AuditLog { TenantId = TenantId, Actor = Actor, Action = action, EntityType = nameof(Tenant), EntityId = TenantId });
        await Db.SaveChangesAsync();
    }
}

public record TeamMemberDto(Guid Id, string Email, string Name, UserRole Role, bool IsActive, DateTimeOffset? LastLoginAt);
public record InviteRequest(string Email, string Name);

[Route("api/app/team")]
public class TeamController(ILogger<TeamController> log, IConfiguration config, TimeProvider clock) : OwnerControllerBase
{
    [HttpGet]
    public async Task<List<TeamMemberDto>> List() =>
        await Db.Users.Where(u => u.TenantId == TenantId).OrderBy(u => u.CreatedAt)
            .Select(u => new TeamMemberDto(u.Id, u.Email, u.Name, u.Role, u.IsActive, u.LastLoginAt)).ToListAsync();

    [HttpPost]
    public async Task<object> Invite(InviteRequest req)
    {
        var email = req.Email.Trim().ToLower();
        if (!email.Contains('@')) throw new AppException(400, "validation", "Enter a valid email.", new Dictionary<string, string[]> { ["email"] = ["email"] });
        if (await Db.Users.AnyAsync(u => u.Email == email))
            throw new AppException(409, "email_taken", "There is already an account with that email.", new Dictionary<string, string[]> { ["email"] = ["email_taken"] });
        var user = new User
        {
            TenantId = TenantId, Email = email, Name = string.IsNullOrWhiteSpace(req.Name) ? email.Split('@')[0] : req.Name.Trim(), Role = UserRole.Staff,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString()),
            ResetToken = Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)), ResetTokenExpiresAt = clock.GetUtcNow().AddDays(7),
        };
        Db.Users.Add(user);
        await Db.SaveChangesAsync();
        var url = $"{config["App:WebBaseUrl"] ?? "http://localhost:5173"}/reset-password?token={user.ResetToken}&invite=1";
        log.LogInformation("[Email stub] Team invite for {Email}: {Url}", email, url);
        return new { member = new TeamMemberDto(user.Id, user.Email, user.Name, user.Role, user.IsActive, null), inviteUrl = url };
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Remove(Guid id)
    {
        var user = await Db.Users.FirstOrDefaultAsync(u => u.Id == id && u.TenantId == TenantId) ?? throw AppException.NotFound("Team member");
        if (user.Role == UserRole.Owner) throw AppException.BadRequest("cannot_remove_owner", "The owner account can't be removed.");
        user.IsActive = false;
        await Db.SaveChangesAsync();
        return NoContent();
    }
}
