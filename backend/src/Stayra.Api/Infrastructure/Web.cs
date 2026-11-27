using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FluentValidation;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Persistence;
using Stayra.Infrastructure.Services;

namespace Stayra.Api.Infrastructure;

public class JwtOptions
{
    public string Issuer { get; set; } = "stayra";
    public string Audience { get; set; } = "stayra";
    public string Key { get; set; } = "";
    public int ExpiryHours { get; set; } = 72;
}

public class TokenService(IOptions<JwtOptions> options)
{
    public string Issue(User user)
    {
        var o = options.Value;
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(ClaimTypes.Role, user.Role.ToString()),
            new("name", user.Name),
        };
        if (user.TenantId is { } tid) claims.Add(new Claim(StayraClaims.TenantId, tid.ToString()));
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.Key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(o.Issuer, o.Audience, claims, expires: DateTime.UtcNow.AddHours(o.ExpiryHours), signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public static class StayraClaims
{
    public const string TenantId = "tenant_id";

    public static Guid? TenantIdOf(this ClaimsPrincipal p) => Guid.TryParse(p.FindFirstValue(TenantId), out var id) ? id : null;
    public static string EmailOf(this ClaimsPrincipal p) => p.FindFirstValue(ClaimTypes.Email) ?? p.FindFirstValue(JwtRegisteredClaimNames.Email) ?? "unknown";
    public static Guid UserIdOf(this ClaimsPrincipal p) => Guid.Parse(p.FindFirstValue(ClaimTypes.NameIdentifier) ?? p.FindFirstValue(JwtRegisteredClaimNames.Sub)!);
}

/// <summary>
/// Resolves the tenant for each request:
///  /api/app/*            — from the owner's JWT (tenant_id claim)
///  /api/admin/*          — platform admin, filters bypassed
///  /api/public/{slug}/*  — from the slug (active tenants only)
/// </summary>
public class TenantResolutionMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext http, TenantContext tenant, StayraDbContext db)
    {
        var path = http.Request.Path.Value ?? "";
        if (path.StartsWith("/api/app", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/hubs/inbox", StringComparison.OrdinalIgnoreCase))
        {
            if (http.User.Identity?.IsAuthenticated == true && http.User.TenantIdOf() is { } tid) tenant.Set(tid);
        }
        else if (path.StartsWith("/api/admin", StringComparison.OrdinalIgnoreCase))
        {
            if (http.User.IsInRole(nameof(UserRole.PlatformAdmin)))
            {
                tenant.IsPlatformAdmin = true;
                tenant.Set(null, bypass: true);
            }
        }
        else if (path.StartsWith("/api/public/", StringComparison.OrdinalIgnoreCase))
        {
            var slug = path.Split('/', StringSplitOptions.RemoveEmptyEntries).ElementAtOrDefault(2);
            if (!string.IsNullOrEmpty(slug))
            {
                var t = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(x => x.Slug == slug.ToLower());
                if (t == null || t.Status != TenantStatus.Active)
                {
                    await Results.Problem(statusCode: 404, title: "This homestay page isn't available.", extensions: new Dictionary<string, object?> { ["code"] = "tenant_not_found" })
                        .ExecuteAsync(http);
                    return;
                }
                tenant.Set(t.Id);
                http.Items["tenant"] = t;
            }
        }
        await next(http);
    }
}

public class ProblemExceptionHandler(ILogger<ProblemExceptionHandler> log, IHostEnvironment env) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception ex, CancellationToken ct)
    {
        ProblemDetails pd;
        switch (ex)
        {
            case AppException app:
                pd = new ProblemDetails { Status = app.Status, Title = app.Message };
                pd.Extensions["code"] = app.Code;
                if (app.Errors != null) pd.Extensions["errors"] = app.Errors;
                break;
            case ValidationException ve:
                pd = new ProblemDetails { Status = 400, Title = "Please check the highlighted fields." };
                pd.Extensions["code"] = "validation";
                pd.Extensions["errors"] = ve.Errors.GroupBy(e => JsonName(e.PropertyName))
                    .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorCode).Distinct().ToArray());
                pd.Extensions["messages"] = ve.Errors.GroupBy(e => JsonName(e.PropertyName))
                    .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).Distinct().ToArray());
                break;
            case InvalidTransitionException it:
                pd = new ProblemDetails { Status = 409, Title = it.Message };
                pd.Extensions["code"] = "invalid_transition";
                break;
            default:
                log.LogError(ex, "Unhandled error on {Path}", http.Request.Path);
                pd = new ProblemDetails { Status = 500, Title = "Something went wrong on our side. Please try again." };
                pd.Extensions["code"] = "server_error";
                if (env.IsDevelopment()) pd.Detail = ex.ToString();
                break;
        }
        pd.Instance = http.Request.Path;
        http.Response.StatusCode = pd.Status ?? 500;
        await http.Response.WriteAsJsonAsync(pd, (System.Text.Json.JsonSerializerOptions?)null, "application/problem+json", ct);
        return true;
    }

    private static string JsonName(string prop) =>
        string.IsNullOrEmpty(prop) ? "" : string.Join('.', prop.Split('.').Select(p => char.ToLowerInvariant(p[0]) + p[1..]));
}

public static class ValidationExtensions
{
    public static async Task ValidateOrThrow<T>(this IValidator<T> v, T model)
    {
        var r = await v.ValidateAsync(model);
        if (!r.IsValid) throw new ValidationException(r.Errors);
    }
}

// ---------- SignalR ----------

[Microsoft.AspNetCore.Authorization.Authorize(Roles = "Owner,Staff")]
public class InboxHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        if (Context.User?.TenantIdOf() is { } tid) await Groups.AddToGroupAsync(Context.ConnectionId, $"tenant:{tid}");
        await base.OnConnectedAsync();
    }
}

public class WidgetHub(StayraDbContext db) : Hub
{
    /// <summary>Guests join their conversation's group by proving the visitor token issued when the conversation started.</summary>
    public async Task<bool> Join(Guid conversationId, string visitorToken)
    {
        var ok = await db.Conversations.IgnoreQueryFilters().AnyAsync(c => c.Id == conversationId && c.VisitorToken == visitorToken);
        if (ok) await Groups.AddToGroupAsync(Context.ConnectionId, $"conv:{conversationId}");
        return ok;
    }
}

public class SignalRNotifier(IHubContext<InboxHub> inbox, IHubContext<WidgetHub> widget) : IRealtimeNotifier
{
    public Task ConversationUpdated(Guid tenantId, Guid conversationId) =>
        inbox.Clients.Group($"tenant:{tenantId}").SendAsync("conversationUpdated", conversationId);

    public async Task MessageAdded(Guid tenantId, Guid conversationId, object message)
    {
        await inbox.Clients.Group($"tenant:{tenantId}").SendAsync("messageAdded", message);
        var role = message.GetType().GetProperty("role")?.GetValue(message) as string;
        if (role != nameof(MessageRole.Tool)) await widget.Clients.Group($"conv:{conversationId}").SendAsync("messageAdded", message);
    }

    public Task BookingChanged(Guid tenantId, Guid bookingId) =>
        inbox.Clients.Group($"tenant:{tenantId}").SendAsync("bookingChanged", bookingId);

    public Task DocumentChanged(Guid tenantId, Guid documentId) =>
        inbox.Clients.Group($"tenant:{tenantId}").SendAsync("documentChanged", documentId);

    public Task Typing(Guid conversationId, bool typing) =>
        widget.Clients.Group($"conv:{conversationId}").SendAsync("typing", typing);
}
