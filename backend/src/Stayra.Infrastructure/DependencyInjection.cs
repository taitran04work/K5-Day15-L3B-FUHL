using Hangfire;
using Hangfire.PostgreSql;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Application.Payments;
using Stayra.Application.Pricing;
using Stayra.Domain;
using Stayra.Infrastructure.Concierge;
using Stayra.Infrastructure.Messaging;
using Stayra.Infrastructure.Payments;
using Stayra.Infrastructure.Persistence;
using Stayra.Infrastructure.Services;

namespace Stayra.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddStayraInfrastructure(this IServiceCollection services, IConfiguration config, bool addHangfireServer = true)
    {
        var cs = config.GetConnectionString("Default") ?? throw new InvalidOperationException("ConnectionStrings:Default is missing");

        services.AddSingleton(TimeProvider.System);
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
        services.AddDbContext<StayraDbContext>(o => o.UseNpgsql(cs, n => n.UseVector().MigrationsAssembly(typeof(StayraDbContext).Assembly.FullName)));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<StayraDbContext>());

        services.AddDataProtection().SetApplicationName("Stayra").PersistKeysToDbContext<StayraDbContext>();
        services.AddSingleton<ISecretProtector, DataProtectionSecretProtector>();

        services.Configure<StorageOptions>(config.GetSection("Storage"));
        services.AddSingleton<IFileStorage, LocalDiskStorage>();

        services.Configure<VnpayOptions>(config.GetSection("Vnpay"));
        services.AddHttpClient<IPaymentGateway, VnpayGateway>();
        services.Configure<ZaloOptions>(config.GetSection("Zalo"));
        services.AddHttpClient<ZaloClient>();
<<<<<<< Updated upstream
        services.Configure<Stayra.Infrastructure.Messaging.SmtpOptions>(o =>
=======
        services.Configure<Messaging.SmtpOptions>(o =>
>>>>>>> Stashed changes
        {
            config.GetSection("Smtp").Bind(o);
            if (string.IsNullOrWhiteSpace(o.WebBaseUrl)) o.WebBaseUrl = config["App:WebBaseUrl"] ?? "http://localhost:5173";
        });
        services.Configure<Services.SmtpOptions>(config.GetSection("Smtp"));
        services.AddScoped<IEmailSender, SmtpEmailSender>();
        services.AddScoped<IEmailNotifier, SmtpEmailNotifier>();
        services.Configure<DeplaoOptions>(config.GetSection("Deplao"));
        services.AddHttpClient<DeplaoClient>();

        services.AddSingleton<IBookingConflictDetector, PostgresConflictDetector>();
        services.AddScoped<IJobScheduler, HangfireJobScheduler>();
        services.AddScoped<IGuestMessenger, GuestMessenger>();
        services.AddSingleton<ConciergeReplyDebouncer>();
        services.AddScoped<IChannelAdapter, WebWidgetAdapter>();
        foreach (var ch in new[] { ChannelType.Zalo, ChannelType.Facebook, ChannelType.Telegram })
        {
            var channel = ch;
            services.AddScoped<IChannelAdapter>(sp => new DeplaoChannelAdapter(
                channel,
                sp.GetRequiredService<ZaloClient>(),
                sp.GetRequiredService<DeplaoClient>(),
                sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<ZaloOptions>>(),
                sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<DeplaoChannelAdapter>>()));
        }

        services.AddScoped<AuditService>();
        services.AddScoped<PricingService>();
        services.AddScoped<PaymentService>();
        services.AddScoped<BookingService>();
        services.AddScoped<ChangeService>();
        services.AddScoped<BookingJobs>();
        services.AddScoped<VnpayCallbackService>();
        services.AddScoped<PaymentJobs>();

        services.AddHangfire(h => h
            .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
            .UseSimpleAssemblyNameTypeSerializer()
            .UseRecommendedSerializerSettings()
            .UsePostgreSqlStorage(o => o.UseNpgsqlConnection(cs), new PostgreSqlStorageOptions { SchemaName = "hangfire", PrepareSchemaIfNecessary = true }));
        if (addHangfireServer) services.AddHangfireServer(o => o.SchedulePollingInterval = TimeSpan.FromSeconds(5));

        return services;
    }

    /// <summary>Feature services (AI concierge, policies, import, channels).</summary>
    public static IServiceCollection AddStayraFeatures(this IServiceCollection services, IConfiguration config)
    {
        services.AddHttpClient();
        services.AddScoped<Import.RoomImportService>();

        services.AddHttpClient<IEmbeddingService, Policies.VoyageEmbeddingService>();
        services.AddScoped<Policies.PolicyExtractionService>();
        services.AddScoped<Policies.PolicySearchService>();
        services.AddScoped<Policies.PolicyJobs>();
        services.AddScoped<ISeedHook, Policies.PolicySeedHook>();

        services.AddScoped<Concierge.ConciergeTools>();
        services.AddScoped<Concierge.OfflineConcierge>();
        services.AddSingleton<Concierge.TenantAi>();
        services.AddScoped<Concierge.ConciergeService>();
        services.AddScoped<ZaloWebhookService>();
        services.AddScoped<DeplaoWebhookService>();
        return services;
    }
}
