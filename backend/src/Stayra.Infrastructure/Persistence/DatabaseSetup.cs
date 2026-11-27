using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;
using Stayra.Application.Pricing;
using Stayra.Domain;
using Stayra.Infrastructure.Services;

namespace Stayra.Infrastructure.Persistence;

public static class DatabaseSetup
{
    public static async Task MigrateAndSeedAsync(IServiceProvider sp, bool seed)
    {
        var log = sp.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseSetup");
        sp.GetRequiredService<ITenantContext>().Set(null, bypass: true);
        var db = sp.GetRequiredService<StayraDbContext>();
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.Database.MigrateAsync();
                break;
            }
            catch (Exception ex) when (attempt < 10 && ex is Npgsql.NpgsqlException or System.Net.Sockets.SocketException or TimeoutException)
            {
                log.LogWarning("Database not ready (attempt {Attempt}): {Message}", attempt, ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(3));
            }
        }
        // Reload types after creating extensions (vector) so Npgsql knows about them on this connection pool.
        var conn = (Npgsql.NpgsqlConnection)db.Database.GetDbConnection();
        await conn.OpenAsync();
        await conn.ReloadTypesAsync();
        await conn.CloseAsync();
        // Documents left in "Uploaded" (e.g. seeded before ingestion existed, or the job was lost) get (re)queued.
        var stuck = await db.PolicyDocuments.Where(d => d.Status == DocumentStatus.Uploaded && d.UploadedAt < DateTimeOffset.UtcNow.AddMinutes(-2)).ToListAsync();
        if (stuck.Count > 0)
        {
            var jobs = sp.GetRequiredService<IJobScheduler>();
            foreach (var d in stuck)
            {
                var hasPolicy = await db.RefundPolicies.AnyAsync(p => p.SourceDocumentId == d.Id);
                jobs.Enqueue<Policies.PolicyJobs>(j => j.Ingest(d.Id, !hasPolicy));
            }
        }

        if (seed && !await db.Tenants.AnyAsync())
        {
            log.LogInformation("Seeding demo data…");
            await ActivatorUtilities.CreateInstance<Seeder>(sp).SeedAsync();
            log.LogInformation("Seed complete. Admin: admin@stayra.dev / Admin@123 · Owner: owner@pinehill.dev / Owner@123");
        }
    }
}

public class Seeder(StayraDbContext db, IFileStorage storage, ITenantContext tenantContext, IHttpClientFactory httpFactory, ILogger<Seeder> log, IEnumerable<ISeedHook> hooks)
{
    private readonly HttpClient _http = httpFactory.CreateClient("seed");

    private static string U(string id) => $"https://images.unsplash.com/photo-{id}?w=1800&q=80&auto=format&fit=crop";

    public async Task SeedAsync()
    {
        tenantContext.Set(null, bypass: true);
        _http.Timeout = TimeSpan.FromSeconds(20);

        db.Users.Add(new User { Email = "admin@stayra.dev", Name = "Platform admin", Role = UserRole.PlatformAdmin, PasswordHash = BCrypt.Net.BCrypt.HashPassword("Admin@123") });

        // ---------- Pine Hill ----------
        var pine = new Tenant
        {
            Slug = "pine-hill",
            Name = "Pine Hill Homestay",
            Description = "A quiet hillside homestay among the pines, ten minutes from Xuan Huong Lake. Wooden rooms, slow mornings with Đà Lạt coffee, and a garden that catches the sunset.",
            Address = "12 Đường Hoa Hồng, Phường 4, Đà Lạt, Lâm Đồng",
            Phone = "0912345678",
            Email = "hello@pinehill.dev",
            Latitude = 11.9316,
            Longitude = 108.4473,
            AccentColor = "#1F5F4A",
            DefaultLanguage = "en",
            BotPersona = "Warm, calm and helpful, like a local host who loves Đà Lạt. Suggest a cosy room for couples and the Family Suite for groups.",
            OpeningTime = new TimeOnly(7, 0),
            ClosingTime = new TimeOnly(23, 0),
        };
        var sea = new Tenant
        {
            Slug = "sea-breeze",
            Name = "Sea Breeze House",
            Description = "A bright, airy house two streets from Bãi Sau beach. Wake up to the sound of waves and walk barefoot to breakfast.",
            Address = "45 Thùy Vân, Phường 2, Vũng Tàu",
            Phone = "0987654321",
            Email = "stay@seabreeze.dev",
            Latitude = 10.3460,
            Longitude = 107.0960,
            AccentColor = "#111111",
            DefaultLanguage = "vi",
            DepositPercent = 50,
            RemainingPaymentTrigger = RemainingPaymentTrigger.AtCheckIn,
            AutoApproveCancellations = false,
            BotPersona = "Breezy and cheerful, focused on the beach and the sea views.",
        };
        db.Tenants.AddRange(pine, sea);
        db.Users.Add(new User { Email = "owner@pinehill.dev", Name = "Lan Nguyen", Role = UserRole.Owner, TenantId = pine.Id, PasswordHash = BCrypt.Net.BCrypt.HashPassword("Owner@123") });
        db.Users.Add(new User { Email = "owner@seabreeze.dev", Name = "Minh Tran", Role = UserRole.Owner, TenantId = sea.Id, PasswordHash = BCrypt.Net.BCrypt.HashPassword("Owner@123") });

        pine.CoverImageUrl = await Image(pine, "cover", "1470246973918-29a93221c455");
        sea.CoverImageUrl = await Image(sea, "cover", "1507525428034-b723cf961d3e");

        var pineRooms = new List<Room>
        {
            Room(pine, 0, "Pine Loft", "PH-LOFT", "A wooden loft under the eaves with a queen bed, a reading nook and a small balcony facing the pines.", 2, 2, "1 queen bed", 28, ["wifi", "heater", "balcony", "mountain_view", "hot_water", "coffee"], 850_000, true, 150_000, 2, 0),
            Room(pine, 1, "Garden Double", "PH-GDN", "Ground-floor double room opening onto the flower garden. Easy access, perfect for a short stay.", 2, 2, "1 double bed", 22, ["wifi", "heater", "garden_view", "hot_water"], 650_000, true, 120_000, 2, 0),
            Room(pine, 2, "Family Suite", "PH-FAM", "Two queen beds, a sofa corner and a large window over the valley. Room for the whole family.", 5, 4, "2 queen beds", 42, ["wifi", "heater", "valley_view", "bathtub", "hot_water", "kettle"], 1_450_000, false, 0, 0, 150_000),
            Room(pine, 3, "Attic Twin", "PH-ATT", "A cosy twin room in the attic with a skylight. Great value for friends travelling together.", 2, 2, "2 single beds", 20, ["wifi", "heater", "hot_water"], 550_000, true, 100_000, 2, 0),
            Room(pine, 4, "Valley View King", "PH-VAL", "Our most requested room: a king bed, floor-to-ceiling windows and sunrise over the valley.", 2, 2, "1 king bed", 30, ["wifi", "heater", "valley_view", "balcony", "bathtub", "coffee"], 1_050_000, true, 180_000, 3, 0),
            Room(pine, 5, "Cabin Studio", "PH-CAB", "A standalone cabin in the garden with a kitchenette and a daybed for a third guest.", 3, 2, "1 queen bed + daybed", 26, ["wifi", "heater", "kitchenette", "garden_view", "parking"], 900_000, false, 0, 0, 120_000),
        };
        var pinePhotos = new[]
        {
            new[] { "1505693416388-ac5ce068fe85", "1540518614846-7eded433c457", "1552321554-5fefe8c9ef14" },
            new[] { "1611892440504-42a792e24d32", "1616594039964-ae9021a400a0", "1584622650111-993a426fbf0a" },
            new[] { "1596394516093-501ba68a0ba6", "1586023492125-27b2c045efd7", "1600210492486-724fe5c67fb0" },
            new[] { "1598928506311-c55ded91a20c", "1595576508898-0ad5c879a061" },
            new[] { "1618773928121-c32242e63f39", "1501785888041-af3ef285b470", "1615874959474-d609969a20ed" },
            new[] { "1513694203232-719a280e022f", "1600566753190-17f0baa2a6c3", "1448375240586-882707db888b" },
        };

        var seaRooms = new List<Room>
        {
            Room(sea, 0, "Ocean Double", "SB-OCN", "A bright double room with a sea-facing window and white linen.", 2, 2, "1 queen bed", 24, ["wifi", "ac", "sea_view", "hot_water"], 900_000, true, 160_000, 2, 0),
            Room(sea, 1, "Sunrise Suite", "SB-SUN", "Corner suite with a private terrace for watching the sunrise over the sea.", 4, 4, "2 queen beds", 45, ["wifi", "ac", "sea_view", "balcony", "bathtub"], 1_600_000, false, 0, 0, 200_000),
            Room(sea, 2, "Courtyard Twin", "SB-CRT", "Quiet twin room overlooking the frangipani courtyard.", 2, 2, "2 single beds", 20, ["wifi", "ac", "hot_water"], 700_000, true, 120_000, 2, 0),
            Room(sea, 3, "Penthouse", "SB-PEN", "Top-floor penthouse with a living room, kitchen and a wide sea view.", 4, 4, "1 king bed + sofa bed", 60, ["wifi", "ac", "sea_view", "kitchenette", "balcony", "parking"], 2_400_000, false, 0, 0, 250_000),
        };
        var seaPhotos = new[]
        {
            new[] { "1582719478250-c89cae4dc85b", "1519046904884-53103b34b206" },
            new[] { "1590490360182-c33d57733427", "1520250497591-112f2f40a3f4" },
            new[] { "1631049307264-da0ec9d70304", "1505691938895-1758d7feb511" },
            new[] { "1522708323590-d24dbb6b0267", "1502672260266-1c1ef2d93688", "1499793983690-e29da59ef1c2" },
        };

        db.Rooms.AddRange(pineRooms);
        db.Rooms.AddRange(seaRooms);
        await db.SaveChangesAsync();

        await AddPhotos(pine, pineRooms, pinePhotos);
        await AddPhotos(sea, seaRooms, seaPhotos);

        // ---------- Price rules ----------
        foreach (var t in new[] { pine, sea })
        {
            db.PriceRules.Add(new PriceRule { TenantId = t.Id, Name = "Weekend", Type = PriceRuleType.Weekend, DaysOfWeek = [DayOfWeek.Friday, DayOfWeek.Saturday], AdjustmentType = AdjustmentType.Percent, Value = 20, Priority = 10 });
        }
        foreach (var r in pineRooms)
            db.PriceRules.Add(new PriceRule
            {
                TenantId = pine.Id, RoomId = r.Id, Name = "Tết 2027", Type = PriceRuleType.Holiday,
                StartDate = new DateOnly(2027, 2, 4), EndDate = new DateOnly(2027, 2, 10),
                AdjustmentType = AdjustmentType.Override, Value = Money.RoundThousand(r.BaseNightlyPrice * 1.6m), Priority = 100,
            });
        db.PriceRules.Add(new PriceRule
        {
            TenantId = pine.Id, Name = "Evening hours", Type = PriceRuleType.HourWindow,
            StartTime = new TimeOnly(18, 0), EndTime = new TimeOnly(23, 0), AdjustmentType = AdjustmentType.Percent, Value = 15, Priority = 5,
        });
        db.PriceRules.Add(new PriceRule
        {
            TenantId = sea.Id, Name = "Summer season", Type = PriceRuleType.DateRange,
            StartDate = new DateOnly(2027, 6, 1), EndDate = new DateOnly(2027, 8, 31), AdjustmentType = AdjustmentType.Fixed, Value = 150_000, Priority = 20,
        });

        // ---------- Policy (Pine Hill active, Sea Breeze none → approvals) ----------
        var pdf = SeedPdf.PineHillPolicy();
        var pdfUrl = await storage.SaveAsync(new MemoryStream(pdf), $"{pine.Id}/policies/pine-hill-house-rules.pdf", "application/pdf");
        var doc = new PolicyDocument { TenantId = pine.Id, FileName = "pine-hill-house-rules.pdf", Url = pdfUrl, Status = DocumentStatus.Uploaded };
        db.PolicyDocuments.Add(doc);
        db.RefundPolicies.Add(new RefundPolicy
        {
            TenantId = pine.Id, Status = RefundPolicyStatus.Active, Version = 1, SourceDocumentId = doc.Id,
            NoShowRefundPercent = 0, ApprovedBy = "owner@pinehill.dev", ApprovedAt = DateTimeOffset.UtcNow,
            Notes = "Refunds are returned to the original MoMo wallet within 3 to 5 working days.",
            Rules =
            [
                new RefundRule { MinHoursBeforeCheckIn = 168, MaxHoursBeforeCheckIn = null, RefundPercent = 100, AppliesTo = RefundAppliesTo.Deposit, Label = "More than 7 days before", SourcePage = 1, SourceQuote = "Cancellations made more than 7 days (168 hours) before the check-in time receive a full refund of the deposit (100%)." },
                new RefundRule { MinHoursBeforeCheckIn = 72, MaxHoursBeforeCheckIn = 168, RefundPercent = 50, AppliesTo = RefundAppliesTo.Deposit, Label = "3 to 7 days before", SourcePage = 1, SourceQuote = "Cancellations made between 3 and 7 days (72 to 168 hours) before the check-in time receive a refund of 50% of the deposit." },
                new RefundRule { MinHoursBeforeCheckIn = 0, MaxHoursBeforeCheckIn = 72, RefundPercent = 0, AppliesTo = RefundAppliesTo.Deposit, Label = "Less than 72 hours before", SourcePage = 1, SourceQuote = "Cancellations made less than 72 hours before the check-in time are not refundable." },
            ],
        });

        // ---------- FAQs ----------
        AddFaq(pine, "Is breakfast included?", "Yes. A simple breakfast with Đà Lạt coffee is served from 07:00 to 09:30 for nightly stays.");
        AddFaq(pine, "Do you have parking?", "Free motorbike parking inside the gate; cars can park on the street outside.");
        AddFaq(pine, "How far is the city centre?", "About 10 minutes by car or 25 minutes on foot to Xuân Hương Lake and the night market.");
        AddFaq(pine, "Can I check in early?", "Early check-in depends on availability and costs 100,000 ₫ per hour. Message us on the day.");
        AddFaq(sea, "How far is the beach?", "Bãi Sau beach is a 3-minute walk, two streets away.");
        AddFaq(sea, "Do you rent motorbikes?", "Yes, from 150,000 ₫ per day. Ask us at check-in.");

        await db.SaveChangesAsync();

        // ---------- Bookings ----------
        await SeedBookings(pine, pineRooms);
        await SeedBookings(sea, seaRooms);
        await SeedConversations(pine);

        foreach (var hook in hooks) await hook.AfterSeedAsync(pine, sea, doc);
    }

    private static Room Room(Tenant t, int order, string name, string code, string desc, int maxGuests, int baseGuests, string beds, decimal area,
        List<string> amenities, decimal nightly, bool hourly, decimal hourlyPrice, int minHours, decimal extraGuest) => new()
    {
        TenantId = t.Id, SortOrder = order, Name = name, Code = code, Description = desc, MaxGuests = maxGuests, BaseGuests = baseGuests,
        Beds = beds, AreaM2 = area, Amenities = amenities, SupportsNightly = true, BaseNightlyPrice = nightly,
        SupportsHourly = hourly, BaseHourlyPrice = hourlyPrice, MinHours = Math.Max(minHours, 1), ExtraGuestFee = extraGuest,
    };

    private void AddFaq(Tenant t, string q, string a) =>
        db.FaqItems.Add(new FaqItem { TenantId = t.Id, Question = q, Answer = a, Status = FaqStatus.Approved, SortOrder = db.FaqItems.Local.Count(f => f.TenantId == t.Id) });

    private async Task AddPhotos(Tenant t, List<Room> rooms, string[][] photos)
    {
        var tasks = new List<Task>();
        for (var i = 0; i < rooms.Count; i++)
        {
            var room = rooms[i];
            for (var j = 0; j < photos[i].Length; j++)
            {
                var idx = j;
                var id = photos[i][j];
                tasks.Add(Task.Run(async () =>
                {
                    var url = await Image(t, $"rooms/{room.Id}/{idx}", id);
                    lock (room.Photos) room.Photos.Add(new RoomPhoto { RoomId = room.Id, Url = url, SortOrder = idx, IsCover = idx == 0 });
                }));
            }
        }
        await Task.WhenAll(tasks);
        db.RoomPhotos.AddRange(rooms.SelectMany(r => r.Photos));
        await db.SaveChangesAsync();
    }

    /// <summary>Downloads the Unsplash image into storage; falls back to the remote URL if offline.</summary>
    private async Task<string> Image(Tenant t, string name, string unsplashId)
    {
        try
        {
            var bytes = await _http.GetByteArrayAsync(U(unsplashId));
            return await storage.SaveAsync(new MemoryStream(bytes), $"{t.Id}/{name}.jpg", "image/jpeg");
        }
        catch (Exception ex)
        {
            log.LogWarning("Could not download photo {Id}: {Message}. Using remote URL.", unsplashId, ex.Message);
            return U(unsplashId);
        }
    }

    private async Task SeedBookings(Tenant t, List<Room> rooms)
    {
        var today = DateOnly.FromDateTime(TenantTime.ToLocal(t, DateTimeOffset.UtcNow));
        var rules = await db.PriceRules.Where(r => r.TenantId == t.Id).ToListAsync();
        var guests = new[]
        {
            ("Nguyễn Thu Hà", "0903123456"), ("Trần Minh Khoa", "0938765432"), ("Emma Schneider", "0977001122"),
            ("Lê Hoàng Nam", "0911223344"), ("Phạm Bảo Ngọc", "0966554433"), ("Lucas Martin", "0988112233"), ("Võ Thanh Tâm", "0909988776"),
        };
        var plan = new (int Room, int StartOffset, int Nights, BookingStatus Status, BookingSource Source)[]
        {
            (0, -1, 2, BookingStatus.CheckedIn, BookingSource.Web),       // departs tomorrow
            (1, 0, 2, BookingStatus.Confirmed, BookingSource.WebChat),    // arriving today
            (2, -2, 2, BookingStatus.CheckedIn, BookingSource.Zalo),      // departs today
            (3, 3, 2, BookingStatus.Confirmed, BookingSource.Web),
            (1, 9, 3, BookingStatus.Confirmed, BookingSource.Zalo),
            (0, -9, 3, BookingStatus.CheckedOut, BookingSource.Owner),
            (3, -14, 1, BookingStatus.Cancelled, BookingSource.Web),
        };
        for (var i = 0; i < plan.Length; i++)
        {
            var p = plan[i];
            if (p.Room >= rooms.Count) continue;
            var room = rooms[p.Room];
            var ci = today.AddDays(p.StartOffset);
            var q = PricingEngine.QuoteNightly(t, room, rules, ci, ci.AddDays(p.Nights), Math.Min(2, room.MaxGuests));
            var (name, phone) = guests[i % guests.Length];
            var paid = p.Status switch
            {
                BookingStatus.CheckedOut => q.Total,
                BookingStatus.CheckedIn => i % 2 == 0 ? q.Total : q.Deposit,
                BookingStatus.Cancelled => 0,
                _ => q.Deposit,
            };
            var b = new Booking
            {
                TenantId = t.Id, Code = BookingCode.New(), RoomId = room.Id, Mode = BookingMode.Nightly,
                StartAt = q.StartAt, EndAt = q.EndAt, BlockedUntil = q.EndAt, Guests = q.Guests,
                GuestName = name, GuestPhone = phone, Source = p.Source, Status = p.Status,
                TotalAmount = q.Total, DepositAmount = q.Deposit, PaidAmount = paid,
                PriceBreakdownJson = JsonSerializer.Serialize(q, AuditService.Json),
                CreatedAt = q.StartAt.AddDays(-12), ConfirmedAt = p.Status != BookingStatus.Cancelled ? q.StartAt.AddDays(-12) : null,
                CheckedInAt = p.Status is BookingStatus.CheckedIn or BookingStatus.CheckedOut ? q.StartAt.AddMinutes(25) : null,
                CheckedOutAt = p.Status == BookingStatus.CheckedOut ? q.EndAt.AddMinutes(-40) : null,
                CancelledAt = p.Status == BookingStatus.Cancelled ? q.StartAt.AddDays(-5) : null,
                CancelReason = p.Status == BookingStatus.Cancelled ? "Change of travel plans" : null,
            };
            db.Bookings.Add(b);
            if (paid > 0)
                db.Payments.Add(new Payment
                {
                    TenantId = t.Id, BookingId = b.Id, Kind = paid >= q.Total ? PaymentKind.Remaining : PaymentKind.Deposit, Amount = paid,
                    Provider = PaymentProvider.MoMo, OrderId = $"{b.Code}-SEED", RequestId = Guid.NewGuid().ToString("N"),
                    Status = PaymentStatus.Paid, PaidAt = b.CreatedAt.AddMinutes(4), CreatedAt = b.CreatedAt, TransId = 0,
                });
        }
        // An hourly booking later today in Pine Hill.
        var hourlyRoom = rooms.FirstOrDefault(r => r.SupportsHourly && r.SortOrder == 4);
        if (hourlyRoom != null)
        {
            var start = today.ToDateTime(new TimeOnly(15, 0)).AddDays(1);
            var q = PricingEngine.QuoteHourly(t, hourlyRoom, rules, start, start.AddHours(3), 2);
            db.Bookings.Add(new Booking
            {
                TenantId = t.Id, Code = BookingCode.New(), RoomId = hourlyRoom.Id, Mode = BookingMode.Hourly,
                StartAt = q.StartAt, EndAt = q.EndAt, BlockedUntil = q.EndAt.AddMinutes(t.CleaningBufferMinutes), Guests = 2,
                GuestName = "Đặng Quốc Bảo", GuestPhone = "0912009988", Source = BookingSource.WebChat, Status = BookingStatus.Confirmed,
                TotalAmount = q.Total, DepositAmount = q.Deposit, PaidAmount = q.Deposit,
                PriceBreakdownJson = JsonSerializer.Serialize(q, AuditService.Json), ConfirmedAt = DateTimeOffset.UtcNow.AddHours(-3),
            });
        }
        await db.SaveChangesAsync();
    }

    private async Task SeedConversations(Tenant t)
    {
        var now = DateTimeOffset.UtcNow;
        var c1 = new Conversation
        {
            TenantId = t.Id, Channel = ChannelType.WebWidget, VisitorToken = Guid.NewGuid().ToString("N"), Language = "en",
            GuestName = "Sophie Laurent", CreatedAt = now.AddHours(-5), LastMessageAt = now.AddHours(-5).AddMinutes(3),
            LastMessagePreview = "Yes — breakfast is served from 07:00 to 09:30 in the garden house, and it's included for nightly stays.",
        };
        c1.Messages.AddRange([
            new Message { Role = MessageRole.Guest, Content = "Hi! Is breakfast included?", CreatedAt = now.AddHours(-5) },
            new Message { Role = MessageRole.Tool, Content = "Searched house rules", ToolName = "search_policy", ToolInputJson = "{\"query\":\"breakfast\"}", CreatedAt = now.AddHours(-5).AddSeconds(2) },
            new Message { Role = MessageRole.Bot, Content = "Yes — breakfast is served from 07:00 to 09:30 in the garden house, and it's included for nightly stays (house rules, section 3).", CreatedAt = now.AddHours(-5).AddMinutes(3), InputTokens = 2100, OutputTokens = 60 },
        ]);
        var c2 = new Conversation
        {
            TenantId = t.Id, Channel = ChannelType.Zalo, ExternalUserId = "sim-8812004", Language = "vi",
            GuestName = "Hoàng Yến", CreatedAt = now.AddHours(-2), LastMessageAt = now.AddHours(-2).AddMinutes(1),
            Status = ConversationStatus.HumanTakeover, NeedsAttention = true, HandoffReason = "Guest asked about a wedding photo shoot",
            LastMessagePreview = "Mình sẽ chuyển câu hỏi này cho chủ nhà và phản hồi bạn sớm nhé.",
        };
        c2.Messages.AddRange([
            new Message { Role = MessageRole.Guest, Content = "Chào bạn, homestay có cho thuê chụp ảnh cưới trong vườn không?", CreatedAt = now.AddHours(-2) },
            new Message { Role = MessageRole.Bot, Content = "Mình sẽ chuyển câu hỏi này cho chủ nhà và phản hồi bạn sớm nhé.", CreatedAt = now.AddHours(-2).AddMinutes(1), InputTokens = 1900, OutputTokens = 40 },
        ]);
        db.Conversations.AddRange(c1, c2);
        await db.SaveChangesAsync();
    }
}

/// <summary>Extension point so later features (policy ingestion) can run after the base seed.</summary>
public interface ISeedHook
{
    Task AfterSeedAsync(Tenant pine, Tenant sea, PolicyDocument pineDoc);
}
