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

public record AdminTenantDto(Guid Id, string Slug, string Name, TenantStatus Status, string? OwnerEmail, string? Address, int Rooms, int BookingsLast30,
    decimal RevenueLast30, int Conversations30, long TokensLast30, DateTimeOffset CreatedAt);

public record CreateTenantRequest(string Name, string? Slug, string OwnerEmail, string OwnerName, string? Address, string? Phone, string DefaultLanguage = "en",
    string OwnerPassword = "", double? Latitude = null, double? Longitude = null, string? Description = null, string? ContactEmail = null);
public record CreateTenantResponse(AdminTenantDto Tenant, string LoginEmail);

public class CreateTenantValidator : AbstractValidator<CreateTenantRequest>
{
    public CreateTenantValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("required").MaximumLength(200);
        RuleFor(x => x.OwnerEmail).NotEmpty().WithErrorCode("required").EmailAddress().WithErrorCode("email");
        RuleFor(x => x.OwnerName).NotEmpty().WithErrorCode("required");
        RuleFor(x => x.Slug).Matches("^[a-z0-9-]{3,60}$").When(x => !string.IsNullOrEmpty(x.Slug)).WithErrorCode("slug_format");
        RuleFor(x => x.DefaultLanguage).Must(l => l is "en" or "vi").WithErrorCode("invalid");
        // the same basics the owner's Website settings show — a new homestay page shouldn't start empty
        RuleFor(x => x.Description).NotEmpty().WithErrorCode("required").MaximumLength(2000).WithErrorCode("too_long");
        RuleFor(x => x.Address).NotEmpty().WithErrorCode("required").MaximumLength(300).WithErrorCode("too_long");
        RuleFor(x => x.Phone).NotEmpty().WithErrorCode("required").Must(p => Phone.NormalizeVn(p) != null).When(x => !string.IsNullOrEmpty(x.Phone)).WithErrorCode("phone");
        RuleFor(x => x.ContactEmail).EmailAddress().When(x => !string.IsNullOrEmpty(x.ContactEmail)).WithErrorCode("email");
        RuleFor(x => x.OwnerPassword).NotEmpty().WithErrorCode("required").MinimumLength(8).WithErrorCode("password_too_short");
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90).When(x => x.Latitude.HasValue).WithErrorCode("out_of_range");
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180).When(x => x.Longitude.HasValue).WithErrorCode("out_of_range");
        RuleFor(x => x.Longitude).NotNull().When(x => x.Latitude.HasValue).WithErrorCode("required");
        RuleFor(x => x.Latitude).NotNull().When(x => x.Longitude.HasValue).WithErrorCode("required");
    }
}

[ApiController]
[Route("api/admin")]
[Authorize(Policy = "Admin")]
public class AdminController(StayraDbContext db, TimeProvider clock, IConfiguration config, ILogger<AdminController> log) : ControllerBase
{
    [HttpGet("tenants")]
    public async Task<List<AdminTenantDto>> Tenants()
    {
        var since = clock.GetUtcNow().AddDays(-30);
        var tenants = await db.Tenants.OrderBy(t => t.CreatedAt).ToListAsync();
        var owners = await db.Users.Where(u => u.Role == UserRole.Owner).GroupBy(u => u.TenantId).Select(g => new { g.Key, Email = g.Min(u => u.Email) }).ToListAsync();
        var rooms = await db.Rooms.GroupBy(r => r.TenantId).Select(g => new { g.Key, N = g.Count() }).ToListAsync();
        var bookings = await db.Bookings.Where(b => b.CreatedAt >= since && b.Status != BookingStatus.Expired)
            .GroupBy(b => b.TenantId).Select(g => new { g.Key, N = g.Count(), Revenue = g.Sum(b => b.PaidAmount - b.RefundAmount) }).ToListAsync();
        var convs = await db.Conversations.Where(c => c.CreatedAt >= since).GroupBy(c => c.TenantId).Select(g => new { g.Key, N = g.Count() }).ToListAsync();
        var tokens = await (from m in db.Messages
                            join c in db.Conversations on m.ConversationId equals c.Id
                            where m.CreatedAt >= since
                            group m by c.TenantId into g
                            select new { g.Key, N = g.Sum(m => (long)m.InputTokens + m.OutputTokens) }).ToListAsync();
        return tenants.Select(t => new AdminTenantDto(t.Id, t.Slug, t.Name, t.Status, owners.FirstOrDefault(o => o.Key == t.Id)?.Email, t.Address,
            rooms.FirstOrDefault(r => r.Key == t.Id)?.N ?? 0, bookings.FirstOrDefault(b => b.Key == t.Id)?.N ?? 0,
            bookings.FirstOrDefault(b => b.Key == t.Id)?.Revenue ?? 0, convs.FirstOrDefault(c => c.Key == t.Id)?.N ?? 0,
            tokens.FirstOrDefault(x => x.Key == t.Id)?.N ?? 0, t.CreatedAt)).ToList();
    }

    [HttpPost("tenants")]
    public async Task<CreateTenantResponse> Create(CreateTenantRequest req, [FromServices] IValidator<CreateTenantRequest> v)
    {
        await v.ValidateOrThrow(req);
        var slug = string.IsNullOrWhiteSpace(req.Slug) ? Slug.From(req.Name) : req.Slug.Trim().ToLower();
        if (await db.Tenants.AnyAsync(t => t.Slug == slug))
            throw new AppException(409, "slug_taken", "That web address is already taken.", new Dictionary<string, string[]> { ["slug"] = ["slug_taken"] });
        var email = req.OwnerEmail.Trim().ToLower();
        if (await db.Users.AnyAsync(u => u.Email == email))
            throw new AppException(409, "email_taken", "There is already an account with that email.", new Dictionary<string, string[]> { ["ownerEmail"] = ["email_taken"] });

        var tenant = new Tenant
        {
            Name = req.Name.Trim(), Slug = slug, Description = req.Description?.Trim(), Address = req.Address?.Trim(),
            Phone = Phone.NormalizeVn(req.Phone), Email = string.IsNullOrWhiteSpace(req.ContactEmail) ? email : req.ContactEmail.Trim().ToLower(),
            DefaultLanguage = req.DefaultLanguage, Latitude = req.Latitude, Longitude = req.Longitude,
        };
        // the admin sets the owner's password directly; no invite link to deliver
        var owner = new User
        {
            TenantId = tenant.Id, Email = email, Name = req.OwnerName.Trim(), Role = UserRole.Owner,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.OwnerPassword),
        };
        db.Tenants.Add(tenant);
        db.Users.Add(owner);
        db.AuditLogs.Add(new AuditLog { TenantId = tenant.Id, Actor = $"admin:{User.EmailOf()}", Action = "tenant.created", EntityType = nameof(Tenant), EntityId = tenant.Id });
        await db.SaveChangesAsync();

        log.LogInformation("Tenant {Tenant} created with owner {Email}", tenant.Name, email);
        return new CreateTenantResponse(new AdminTenantDto(tenant.Id, tenant.Slug, tenant.Name, tenant.Status, email, tenant.Address, 0, 0, 0, 0, 0, tenant.CreatedAt), email);
    }

    [HttpPost("tenants/{id:guid}/status")]
    public async Task<IActionResult> SetStatus(Guid id, [FromBody] SetStatusRequest req)
    {
        var t = await db.Tenants.FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Homestay");
        t.Status = req.Status;
        db.AuditLogs.Add(new AuditLog { TenantId = t.Id, Actor = $"admin:{User.EmailOf()}", Action = $"tenant.{req.Status.ToString().ToLower()}", EntityType = nameof(Tenant), EntityId = t.Id });
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("usage")]
    public async Task<object> Usage()
    {
        var since = clock.GetUtcNow().AddDays(-30);
        var days = await db.Messages.Where(m => m.CreatedAt >= since && (m.Role == MessageRole.Bot || m.Role == MessageRole.Guest))
            .GroupBy(m => m.CreatedAt.Date).Select(g => new
            {
                Date = g.Key,
                GuestMessages = g.Count(m => m.Role == MessageRole.Guest),
                BotMessages = g.Count(m => m.Role == MessageRole.Bot),
                Tokens = g.Sum(m => (long)m.InputTokens + m.OutputTokens),
            }).OrderBy(x => x.Date).ToListAsync();
        return new
        {
            tenants = await db.Tenants.CountAsync(),
            activeTenants = await db.Tenants.CountAsync(t => t.Status == TenantStatus.Active),
            bookings30 = await db.Bookings.CountAsync(b => b.CreatedAt >= since),
            conversations30 = await db.Conversations.CountAsync(c => c.CreatedAt >= since),
            tokens30 = days.Sum(d => d.Tokens),
            days,
        };
    }
}

public record SetStatusRequest(TenantStatus Status);
