using System.Security.Cryptography;
using FluentValidation;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stayra.Api.Infrastructure;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Persistence;

namespace Stayra.Api.Controllers;

public record LoginRequest(string Email, string Password);
public record ForgotRequest(string Email);
public record ResetRequest(string Token, string Password);
public record MeDto(Guid Id, string Email, string Name, UserRole Role, Guid? TenantId, string? TenantSlug, string? TenantName, string? AccentColor);
public record LoginResponse(string Token, MeDto User);

public class LoginValidator : AbstractValidator<LoginRequest>
{
    public LoginValidator()
    {
        RuleFor(x => x.Email).NotEmpty().WithErrorCode("required").EmailAddress().WithErrorCode("email");
        RuleFor(x => x.Password).NotEmpty().WithErrorCode("required");
    }
}

public class ResetValidator : AbstractValidator<ResetRequest>
{
    public ResetValidator()
    {
        RuleFor(x => x.Token).NotEmpty().WithErrorCode("required");
        RuleFor(x => x.Password).NotEmpty().WithErrorCode("required").MinimumLength(8).WithErrorCode("password_too_short");
    }
}

[ApiController]
[Route("api/auth")]
public class AuthController(StayraDbContext db, TokenService tokens, ILogger<AuthController> log, TimeProvider clock, IConfiguration config) : ControllerBase
{
    [HttpPost("login")]
    public async Task<LoginResponse> Login(LoginRequest req, [FromServices] IValidator<LoginRequest> v)
    {
        await v.ValidateOrThrow(req);
        var user = await db.Users.Include(u => u.Tenant).FirstOrDefaultAsync(u => u.Email == req.Email.Trim().ToLower());
        if (user == null || !user.IsActive || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            throw new AppException(401, "invalid_credentials", "That email and password don't match.");
        if (user.Tenant is { Status: TenantStatus.Suspended })
            throw new AppException(403, "tenant_suspended", "This homestay account is suspended. Please contact support.");
        user.LastLoginAt = clock.GetUtcNow();
        await db.SaveChangesAsync();
        return new LoginResponse(tokens.Issue(user), ToMe(user));
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<MeDto> Me()
    {
        var id = User.UserIdOf();
        var user = await db.Users.Include(u => u.Tenant).FirstOrDefaultAsync(u => u.Id == id) ?? throw new AppException(401, "unauthorized", "Please sign in again.");
        return ToMe(user);
    }

    /// <summary>Always returns 204 so the endpoint can't be used to discover accounts. The reset link is logged (email stub).</summary>
    [HttpPost("forgot")]
    public async Task<IActionResult> Forgot(ForgotRequest req)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == req.Email.Trim().ToLower());
        if (user != null)
        {
            user.ResetToken = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
            user.ResetTokenExpiresAt = clock.GetUtcNow().AddHours(2);
            await db.SaveChangesAsync();
            var web = config["App:WebBaseUrl"] ?? "http://localhost:5173";
            log.LogInformation("[Email stub] Password reset for {Email}: {Url}", user.Email, $"{web}/reset-password?token={user.ResetToken}");
        }
        return NoContent();
    }

    [HttpPost("reset")]
    public async Task<IActionResult> Reset(ResetRequest req, [FromServices] IValidator<ResetRequest> v)
    {
        await v.ValidateOrThrow(req);
        var user = await db.Users.FirstOrDefaultAsync(u => u.ResetToken == req.Token && u.ResetTokenExpiresAt > clock.GetUtcNow())
                   ?? throw new AppException(400, "invalid_token", "This link has expired. Please request a new one.");
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password);
        user.ResetToken = null;
        user.ResetTokenExpiresAt = null;
        await db.SaveChangesAsync();
        return NoContent();
    }

    public static MeDto ToMe(User u) => new(u.Id, u.Email, u.Name, u.Role, u.TenantId, u.Tenant?.Slug, u.Tenant?.Name, u.Tenant?.AccentColor);
}
