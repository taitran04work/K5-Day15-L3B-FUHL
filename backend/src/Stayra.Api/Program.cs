using System.Text;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using FluentValidation;
using Hangfire;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using Stayra.Api.Infrastructure;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Infrastructure;
using Stayra.Infrastructure.Payments;
using Stayra.Infrastructure.Persistence;

// `dotnet run -- generate-seed-pdf <dir>` writes the demo files (policy PDF + rooms spreadsheet) and exits.
if (args.Length >= 2 && args[0] == "generate-seed-pdf")
{
    Directory.CreateDirectory(args[1]);
    File.WriteAllBytes(Path.Combine(args[1], "pine-hill-house-rules.pdf"), SeedPdf.PineHillPolicy());
    File.WriteAllBytes(Path.Combine(args[1], "rooms-import-sample.xlsx"), Stayra.Infrastructure.Import.RoomImportService.BuildXlsx(Stayra.Infrastructure.Import.RoomImportService.DaLatSample));
    Console.WriteLine($"Wrote demo files to {Path.GetFullPath(args[1])}");
    return;
}

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((ctx, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.EntityFrameworkCore", Serilog.Events.LogEventLevel.Warning)
    .MinimumLevel.Override("System.Net.Http", Serilog.Events.LogEventLevel.Warning)
    .MinimumLevel.Override("Hangfire", Serilog.Events.LogEventLevel.Warning)
    .WriteTo.Console(outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}"));

var config = builder.Configuration;
var isTesting = builder.Environment.IsEnvironment("Testing");

builder.Services.AddStayraInfrastructure(config, addHangfireServer: !isTesting && config.GetValue("Hangfire:Server", true));
builder.Services.AddStayraFeatures(config);

builder.Services.Configure<JwtOptions>(config.GetSection("Jwt"));
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<SignalRNotifier>();
builder.Services.AddSingleton<IRealtimeNotifier>(sp => sp.GetRequiredService<SignalRNotifier>());

var jwtKey = config["Jwt:Key"];
if (string.IsNullOrEmpty(jwtKey) || jwtKey.Length < 32) throw new InvalidOperationException("Jwt:Key must be set to at least 32 characters (JWT__KEY).");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = true;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = config["Jwt:Issuer"] ?? "stayra",
        ValidAudience = config["Jwt:Audience"] ?? "stayra",
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        ValidateIssuerSigningKey = true,
        NameClaimType = "name",
    };
    // SignalR sends the token as a query string parameter.
    o.Events = new JwtBearerEvents
    {
        OnMessageReceived = ctx =>
        {
            var token = ctx.Request.Query["access_token"];
            if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs")) ctx.Token = token;
            return Task.CompletedTask;
        },
    };
});
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("Owner", p => p.RequireRole("Owner", "Staff").RequireClaim(StayraClaims.TenantId))
    .AddPolicy("Admin", p => p.RequireRole("PlatformAdmin"));

builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddValidatorsFromAssemblyContaining<Program>();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ProblemExceptionHandler>();
builder.Services.AddSignalR().AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "Stayra API", Version = "v1" });
    c.CustomSchemaIds(t => t.FullName!.Replace("Stayra.", "").Replace("+", "."));
    c.SupportNonNullableReferenceTypes();
});

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins((config["Cors:Origins"] ?? "http://localhost:5173").Split(',', StringSplitOptions.RemoveEmptyEntries))
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    // Guest chat: per conversation (or IP), 12 messages per minute.
    o.AddPolicy("chat", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Request.RouteValues["conversationId"]?.ToString() ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 12, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("public", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 240, Window = TimeSpan.FromMinutes(1) }));
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.ContentType = "application/problem+json";
        await ctx.HttpContext.Response.WriteAsJsonAsync(new { status = 429, title = "You're sending messages a little fast. Please wait a moment.", code = "rate_limited" }, ct);
    };
});

var app = builder.Build();

app.UseExceptionHandler();
app.UseSerilogRequestLogging(o => o.GetLevel = (ctx, _, ex) =>
    ex != null || ctx.Response.StatusCode >= 500 ? Serilog.Events.LogEventLevel.Error : Serilog.Events.LogEventLevel.Debug);

app.UseSwagger();
app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Stayra API v1"));

var storageRoot = Path.GetFullPath(config["Storage:Root"] ?? "data/uploads");
Directory.CreateDirectory(storageRoot);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(storageRoot),
    RequestPath = "/files",
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "public,max-age=604800",
});

app.UseCors();
app.UseAuthentication();
app.UseMiddleware<TenantResolutionMiddleware>();
app.UseAuthorization();
app.UseRateLimiter();

app.MapControllers();
app.MapHub<InboxHub>("/hubs/inbox");
app.MapHub<WidgetHub>("/hubs/widget");
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

if (!isTesting)
{
    app.UseHangfireDashboard("/hangfire", new DashboardOptions { Authorization = [new DevOnlyDashboardAuth(app.Environment)] });
}

if (config.GetValue("Database:MigrateOnStartup", true))
{
    using var scope = app.Services.CreateScope();
    await DatabaseSetup.MigrateAndSeedAsync(scope.ServiceProvider, config.GetValue("Database:Seed", true));
}

if (!isTesting)
{
    RecurringJob.AddOrUpdate<BookingJobs>("expire-holds", j => j.ExpireHolds(), Cron.Minutely());
    RecurringJob.AddOrUpdate<PaymentJobs>("reconcile-payments", j => j.Reconcile(), "*/5 * * * *");
}

app.Run();

public partial class Program;

public class DevOnlyDashboardAuth(IWebHostEnvironment env) : Hangfire.Dashboard.IDashboardAuthorizationFilter
{
    public bool Authorize(Hangfire.Dashboard.DashboardContext context) => env.IsDevelopment();
}
