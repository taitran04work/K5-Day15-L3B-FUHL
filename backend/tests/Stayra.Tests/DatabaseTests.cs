using System.Linq.Expressions;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Stayra.Api.Infrastructure;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Application.Payments;
using Stayra.Application.Pricing;
using Stayra.Domain;
using Stayra.Infrastructure.Messaging;
using Stayra.Infrastructure.Payments;
using Stayra.Infrastructure.Persistence;
using Stayra.Infrastructure.Services;
using Testcontainers.PostgreSql;

namespace Stayra.Tests;

public class PostgresFixture : IAsyncLifetime
{
    public const string AccessKey = "F8BBA842ECF85";
    public const string SecretKey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";

    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder("pgvector/pgvector:pg16")
        .WithDatabase("stayra_test").WithUsername("stayra").WithPassword("stayra")
        .Build();

    public string ConnectionString => _pg.GetConnectionString();
    public ServiceProvider Services { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var services = new ServiceCollection();
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.Warning));
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
        services.AddDbContext<StayraDbContext>(o => o.UseNpgsql(ConnectionString, n => n.UseVector()));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<StayraDbContext>());
        services.AddScoped<AuditService>();
        services.AddScoped<PricingService>();
        services.AddScoped<PaymentService>();
        services.AddScoped<BookingService>();
        services.AddScoped<ChangeService>();
        services.AddScoped<MomoCallbackService>();
        services.AddSingleton<IPaymentGateway>(sp => new MomoGateway(new HttpClient(),
            Options.Create(new MomoOptions { PartnerCode = "MOMO", AccessKey = AccessKey, SecretKey = SecretKey, Offline = true }),
            new PlainProtector(), NullLogger<MomoGateway>.Instance));
        services.AddSingleton<IBookingConflictDetector, PostgresConflictDetector>();
        services.AddScoped<IGuestMessenger, GuestMessenger>();
        services.AddSingleton<IRealtimeNotifier, NullRealtime>();
        services.AddSingleton<IJobScheduler, NullJobs>();
        Services = services.BuildServiceProvider();

        using var scope = Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<ITenantContext>().Set(null, bypass: true);
        await scope.ServiceProvider.GetRequiredService<StayraDbContext>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await Services.DisposeAsync();
        await _pg.DisposeAsync();
    }

    /// <summary>Creates a tenant with one room (filters bypassed) and returns both.</summary>
    public async Task<(Tenant Tenant, Room Room)> CreateTenantAsync(string slug)
    {
        using var scope = Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<ITenantContext>().Set(null, bypass: true);
        var db = scope.ServiceProvider.GetRequiredService<StayraDbContext>();
        var t = Fixtures.Tenant();
        t.Slug = $"{slug}-{Guid.NewGuid().ToString("N")[..6]}";
        var room = Fixtures.Room(t);
        db.Tenants.Add(t);
        db.Rooms.Add(room);
        await db.SaveChangesAsync();
        return (t, room);
    }

    public AsyncServiceScope Scope(Guid? tenantId)
    {
        var scope = Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<ITenantContext>().Set(tenantId, bypass: tenantId == null);
        return scope;
    }

    private class PlainProtector : ISecretProtector
    {
        public string? Protect(string? plain) => plain;
        public string? Unprotect(string? cipher) => cipher;
    }

    private class NullRealtime : IRealtimeNotifier
    {
        public Task ConversationUpdated(Guid tenantId, Guid conversationId) => Task.CompletedTask;
        public Task MessageAdded(Guid tenantId, Guid conversationId, object message) => Task.CompletedTask;
        public Task BookingChanged(Guid tenantId, Guid bookingId) => Task.CompletedTask;
        public Task DocumentChanged(Guid tenantId, Guid documentId) => Task.CompletedTask;
        public Task Typing(Guid conversationId, bool typing) => Task.CompletedTask;
    }

    public class NullJobs : IJobScheduler
    {
        public List<string> Scheduled { get; } = [];
        public string Schedule<T>(Expression<Func<T, Task>> job, DateTimeOffset at) where T : notnull { Scheduled.Add($"{at:O}"); return Guid.NewGuid().ToString(); }
        public string Enqueue<T>(Expression<Func<T, Task>> job) where T : notnull { Scheduled.Add("now"); return Guid.NewGuid().ToString(); }
        public void Delete(string jobId) { }
    }
}

[CollectionDefinition("postgres")]
public class PostgresCollection : ICollectionFixture<PostgresFixture>;

[Collection("postgres")]
public class BookingConcurrencyTests(PostgresFixture fx)
{
    private static CreateBookingInput Input(Room room, int i) => new(room.Id, Stay.Nightly(new DateOnly(2027, 3, 10), new DateOnly(2027, 3, 12)), 2,
        new GuestInfo($"Guest {i}", $"09120000{i:D2}", null, null), BookingSource.Web);

    [Fact]
    public async Task Ten_parallel_holds_for_the_same_slot_produce_exactly_one_booking()
    {
        var (tenant, room) = await fx.CreateTenantAsync("conc");
        var tasks = Enumerable.Range(0, 10).Select(async i =>
        {
            await using var scope = fx.Scope(tenant.Id);
            var svc = scope.ServiceProvider.GetRequiredService<BookingService>();
            try
            {
                await svc.CreateHoldAsync(tenant, Input(room, i));
                return "ok";
            }
            catch (RoomUnavailableException) { return "conflict"; }
        }).ToList();
        var results = await Task.WhenAll(tasks);

        results.Count(r => r == "ok").Should().Be(1);
        results.Count(r => r == "conflict").Should().Be(9);
        await using var check = fx.Scope(tenant.Id);
        (await check.ServiceProvider.GetRequiredService<StayraDbContext>().Bookings.CountAsync(b => b.RoomId == room.Id)).Should().Be(1);
    }

    [Fact]
    public async Task Exclusion_constraint_rejects_overlaps_even_when_the_service_is_bypassed()
    {
        var (tenant, room) = await fx.CreateTenantAsync("excl");
        await using var scope = fx.Scope(null);
        var db = scope.ServiceProvider.GetRequiredService<StayraDbContext>();
        Booking Make(int startHour, int hours, BookingStatus status) => new()
        {
            TenantId = tenant.Id, Code = BookingCode.New(), RoomId = room.Id, Mode = BookingMode.Hourly,
            StartAt = new DateTimeOffset(2027, 4, 1, startHour, 0, 0, TimeSpan.Zero), EndAt = new DateTimeOffset(2027, 4, 1, startHour + hours, 0, 0, TimeSpan.Zero),
            BlockedUntil = new DateTimeOffset(2027, 4, 1, startHour + hours, 0, 0, TimeSpan.Zero), Guests = 1, GuestName = "X", GuestPhone = "0912345678", Status = status,
        };
        db.Bookings.Add(Make(1, 3, BookingStatus.Confirmed));
        await db.SaveChangesAsync();

        db.Bookings.Add(Make(2, 2, BookingStatus.Confirmed));
        var act = () => db.SaveChangesAsync();
        (await act.Should().ThrowAsync<DbUpdateException>()).Which.Should().Match<DbUpdateException>(e => new PostgresConflictDetector().IsOverlapViolation(e));
        db.ChangeTracker.Clear();

        // Cancelled bookings and back-to-back slots don't conflict.
        db.Bookings.Add(Make(2, 2, BookingStatus.Cancelled));
        db.Bookings.Add(Make(4, 2, BookingStatus.Confirmed));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Expired_holds_free_the_slot()
    {
        var (tenant, room) = await fx.CreateTenantAsync("hold");
        await using (var scope = fx.Scope(tenant.Id))
        {
            var r = await scope.ServiceProvider.GetRequiredService<BookingService>().CreateHoldAsync(tenant, Input(room, 1));
            var db = scope.ServiceProvider.GetRequiredService<StayraDbContext>();
            r.Booking.HoldExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        await using (var scope = fx.Scope(tenant.Id))
        {
            var r2 = await scope.ServiceProvider.GetRequiredService<BookingService>().CreateHoldAsync(tenant, Input(room, 2));
            r2.Booking.Status.Should().Be(BookingStatus.Hold);
            var statuses = await scope.ServiceProvider.GetRequiredService<StayraDbContext>().Bookings.Where(b => b.RoomId == room.Id).Select(b => b.Status).ToListAsync();
            statuses.Should().BeEquivalentTo([BookingStatus.Expired, BookingStatus.Hold]);
        }
    }
}

[Collection("postgres")]
public class PaymentIdempotencyTests(PostgresFixture fx)
{
    [Fact]
    public async Task Ipn_is_idempotent_and_confirms_the_booking_once()
    {
        var (tenant, room) = await fx.CreateTenantAsync("ipn");
        Payment deposit;
        await using (var scope = fx.Scope(tenant.Id))
        {
            var r = await scope.ServiceProvider.GetRequiredService<BookingService>().CreateHoldAsync(tenant,
                new CreateBookingInput(room.Id, Stay.Nightly(new DateOnly(2027, 5, 1), new DateOnly(2027, 5, 3)), 2, new GuestInfo("Ipn Guest", "0912345670", null, null), BookingSource.Web));
            deposit = r.Deposit!;
        }

        var fields = new Dictionary<string, string>
        {
            ["partnerCode"] = "MOMO", ["orderId"] = deposit.OrderId, ["requestId"] = deposit.RequestId, ["amount"] = ((long)deposit.Amount).ToString(),
            ["orderInfo"] = "Deposit", ["orderType"] = "momo_wallet", ["transId"] = "4088878653", ["resultCode"] = "0", ["message"] = "Successful.",
            ["payType"] = "qr", ["responseTime"] = "1721720663942", ["extraData"] = "",
        };
        fields["signature"] = MomoGateway.Sign(MomoGateway.IpnRawSignature(PostgresFixture.AccessKey, fields), PostgresFixture.SecretKey);

        for (var i = 0; i < 3; i++)
        {
            await using var scope = fx.Scope(null);
            var outcome = await scope.ServiceProvider.GetRequiredService<MomoCallbackService>().HandleAsync(fields);
            outcome.SignatureValid.Should().BeTrue();
            outcome.Status.Should().Be(PaymentStatus.Paid);
        }

        await using (var scope = fx.Scope(tenant.Id))
        {
            var db = scope.ServiceProvider.GetRequiredService<StayraDbContext>();
            var b = await db.Bookings.FirstAsync(x => x.Id == deposit.BookingId);
            b.PaidAmount.Should().Be(deposit.Amount);
            b.Status.Should().Be(BookingStatus.Confirmed);
            (await db.AuditLogs.CountAsync(a => a.EntityId == deposit.Id && a.Action == "payment.paid")).Should().Be(1);
        }

        // Tampered callback is rejected and changes nothing.
        fields["amount"] = "1000";
        await using (var scope = fx.Scope(null))
            (await scope.ServiceProvider.GetRequiredService<MomoCallbackService>().HandleAsync(fields)).SignatureValid.Should().BeFalse();
    }
}

[Collection("postgres")]
public class TenantIsolationTests(PostgresFixture fx)
{
    [Fact]
    public async Task Tenant_A_cannot_read_or_write_tenant_B_data()
    {
        var (a, roomA) = await fx.CreateTenantAsync("iso-a");
        var (b, roomB) = await fx.CreateTenantAsync("iso-b");
        await using (var scope = fx.Scope(b.Id))
            await scope.ServiceProvider.GetRequiredService<BookingService>().CreateHoldAsync(b,
                new CreateBookingInput(roomB.Id, Stay.Nightly(new DateOnly(2027, 6, 1), new DateOnly(2027, 6, 2)), 2, new GuestInfo("B Guest", "0912345671", null, null), BookingSource.Web));

        await using (var scope = fx.Scope(a.Id))
        {
            var db = scope.ServiceProvider.GetRequiredService<StayraDbContext>();
            (await db.Rooms.Select(r => r.Id).ToListAsync()).Should().Equal(roomA.Id);
            (await db.Rooms.AnyAsync(r => r.Id == roomB.Id)).Should().BeFalse();
            (await db.Bookings.AnyAsync(x => x.TenantId == b.Id)).Should().BeFalse();
            (await db.Payments.AnyAsync(x => x.TenantId == b.Id)).Should().BeFalse();

            // Even if B's row is obtained by bypassing filters, writing it from A's context is blocked.
            var foreign = await db.Rooms.IgnoreQueryFilters().FirstAsync(r => r.Id == roomB.Id);
            foreign.Name = "Hijacked";
            var act = () => db.SaveChangesAsync();
            (await act.Should().ThrowAsync<AppException>()).Which.Code.Should().Be("cross_tenant_write");
        }
    }

    [Fact]
    public async Task Owner_api_of_tenant_A_cannot_see_tenant_B()
    {
        var (a, roomA) = await fx.CreateTenantAsync("api-a");
        var (b, roomB) = await fx.CreateTenantAsync("api-b");
        Guid bookingB;
        await using (var scope = fx.Scope(b.Id))
            bookingB = (await scope.ServiceProvider.GetRequiredService<BookingService>().CreateHoldAsync(b,
                new CreateBookingInput(roomB.Id, Stay.Nightly(new DateOnly(2027, 7, 1), new DateOnly(2027, 7, 2)), 2, new GuestInfo("B Guest", "0912345672", null, null), BookingSource.Web))).Booking.Id;

        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(w =>
        {
            w.UseEnvironment("Testing");
            w.UseSetting("ConnectionStrings:Default", fx.ConnectionString);
            w.UseSetting("Jwt:Key", "testing-key-0123456789-0123456789-abcdef");
            w.UseSetting("Database:Seed", "false");
            w.UseSetting("Momo:Offline", "true");
            w.UseSetting("Storage:Root", Path.Combine(Path.GetTempPath(), "stayra-test-uploads"));
        });
        var owner = new User { Email = "owner@a.test", Name = "A", Role = UserRole.Owner, TenantId = a.Id };
        var token = factory.Services.GetRequiredService<TokenService>().Issue(owner);
        var http = factory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var rooms = await http.GetFromJsonAsync<JsonElement>("/api/app/rooms");
        rooms.EnumerateArray().Select(r => r.GetProperty("id").GetGuid()).Should().Equal(roomA.Id);
        (await http.GetAsync($"/api/app/bookings/{bookingB}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await http.GetAsync($"/api/app/rooms/{roomB.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // Public site of A cannot load B's room either.
        var anon = factory.CreateClient();
        (await anon.GetAsync($"/api/public/{a.Slug}/rooms/{roomB.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await anon.GetAsync($"/api/public/{a.Slug}/rooms/{roomA.Id}")).StatusCode.Should().Be(HttpStatusCode.OK);

        // Unauthenticated access to the owner API is refused.
        (await anon.GetAsync("/api/app/rooms")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
