using FluentAssertions;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Application.Pricing;
using Stayra.Application.Refunds;
using Stayra.Domain;

namespace Stayra.Tests;

public static class Fixtures
{
    public static Tenant Tenant(int depositPercent = 30) => new()
    {
        Name = "Test Homestay", Slug = "test", DepositPercent = depositPercent, TimeZone = "Asia/Ho_Chi_Minh",
        CheckInTime = new TimeOnly(14, 0), CheckOutTime = new TimeOnly(12, 0), OpeningTime = new TimeOnly(7, 0), ClosingTime = new TimeOnly(23, 0),
        CleaningBufferMinutes = 60,
    };

    public static Room Room(Tenant t) => new()
    {
        TenantId = t.Id, Name = "Pine Loft", Code = "PL", MaxGuests = 3, BaseGuests = 2, SupportsNightly = true, SupportsHourly = true,
        BaseNightlyPrice = 850_000, BaseHourlyPrice = 150_000, MinHours = 2, ExtraGuestFee = 100_000,
    };

    public static PriceRule Weekend(Tenant t) => new()
    {
        TenantId = t.Id, Name = "Weekend", Type = PriceRuleType.Weekend, DaysOfWeek = [DayOfWeek.Friday, DayOfWeek.Saturday],
        AdjustmentType = AdjustmentType.Percent, Value = 20, Priority = 10,
    };
}

public class PricingEngineTests
{
    private readonly Tenant _t = Fixtures.Tenant();

    [Fact]
    public void Weekday_nights_use_the_base_price()
    {
        var room = Fixtures.Room(_t);
        // 2026-12-14 is a Monday → two weekday nights.
        var q = PricingEngine.QuoteNightly(_t, room, [Fixtures.Weekend(_t)], new DateOnly(2026, 12, 14), new DateOnly(2026, 12, 16), 2);
        q.Units.Should().Be(2);
        q.Lines.Select(l => l.Price).Should().AllBeEquivalentTo(850_000m);
        q.Total.Should().Be(1_700_000);
    }

    [Fact]
    public void Weekend_percent_rule_applies_to_friday_and_saturday_nights()
    {
        var room = Fixtures.Room(_t);
        // Fri 18, Sat 19, Sun 20 December 2026.
        var q = PricingEngine.QuoteNightly(_t, room, [Fixtures.Weekend(_t)], new DateOnly(2026, 12, 18), new DateOnly(2026, 12, 21), 2);
        q.Lines.Select(l => l.Price).Should().Equal(1_020_000m, 1_020_000m, 850_000m);
        q.Lines[0].RuleName.Should().Be("Weekend");
        q.Total.Should().Be(2_890_000);
    }

    [Fact]
    public void Override_beats_fixed_and_percent_regardless_of_order()
    {
        var room = Fixtures.Room(_t);
        var rules = new List<PriceRule>
        {
            Fixtures.Weekend(_t),
            new() { TenantId = _t.Id, Name = "Peak", Type = PriceRuleType.DateRange, StartDate = new(2027, 2, 1), EndDate = new(2027, 2, 28), AdjustmentType = AdjustmentType.Fixed, Value = 100_000, Priority = 50 },
            new() { TenantId = _t.Id, RoomId = room.Id, Name = "Tết", Type = PriceRuleType.Holiday, StartDate = new(2027, 2, 4), EndDate = new(2027, 2, 10), AdjustmentType = AdjustmentType.Override, Value = 1_360_000, Priority = 100 },
        };
        // 2027-02-05 is a Friday inside Tết: override wins over weekend % and peak fixed.
        var q = PricingEngine.QuoteNightly(_t, room, rules, new DateOnly(2027, 2, 5), new DateOnly(2027, 2, 6), 2);
        q.Lines.Single().Price.Should().Be(1_360_000);
        q.Lines.Single().RuleName.Should().Be("Tết");

        // 2027-02-12 (Fri, after Tết): fixed then percent → (850k + 100k) × 1.2 = 1,140,000.
        var q2 = PricingEngine.QuoteNightly(_t, room, rules, new DateOnly(2027, 2, 12), new DateOnly(2027, 2, 13), 2);
        q2.Lines.Single().Price.Should().Be(1_140_000);
    }

    [Fact]
    public void Rules_for_another_room_are_ignored()
    {
        var room = Fixtures.Room(_t);
        var other = new PriceRule { TenantId = _t.Id, RoomId = Guid.NewGuid(), Name = "Other", Type = PriceRuleType.DateRange, StartDate = new(2026, 1, 1), EndDate = new(2027, 12, 31), AdjustmentType = AdjustmentType.Override, Value = 1 };
        var q = PricingEngine.QuoteNightly(_t, room, [other], new DateOnly(2026, 12, 14), new DateOnly(2026, 12, 15), 2);
        q.Total.Should().Be(850_000);
    }

    [Fact]
    public void Extra_guest_fee_is_charged_per_night_above_base_guests()
    {
        var room = Fixtures.Room(_t);
        var q = PricingEngine.QuoteNightly(_t, room, [], new DateOnly(2026, 12, 14), new DateOnly(2026, 12, 16), 3);
        q.ExtraGuestFee.Should().Be(200_000);
        q.Total.Should().Be(1_900_000);
    }

    [Fact]
    public void Too_many_guests_is_rejected()
    {
        var act = () => PricingEngine.QuoteNightly(_t, Fixtures.Room(_t), [], new DateOnly(2026, 12, 14), new DateOnly(2026, 12, 15), 4);
        act.Should().Throw<PricingException>().Which.Code.Should().Be("too_many_guests");
    }

    [Fact]
    public void Nightly_requires_at_least_one_night()
    {
        var act = () => PricingEngine.QuoteNightly(_t, Fixtures.Room(_t), [], new DateOnly(2026, 12, 14), new DateOnly(2026, 12, 14), 2);
        act.Should().Throw<PricingException>().Which.Code.Should().Be("invalid_dates");
    }

    [Fact]
    public void Nightly_stay_uses_tenant_check_in_and_check_out_times()
    {
        var q = PricingEngine.QuoteNightly(_t, Fixtures.Room(_t), [], new DateOnly(2026, 12, 14), new DateOnly(2026, 12, 15), 2);
        // Asia/Ho_Chi_Minh is UTC+7: 14:00 local = 07:00 UTC, 12:00 local = 05:00 UTC.
        q.StartAt.Should().Be(new DateTimeOffset(2026, 12, 14, 7, 0, 0, TimeSpan.Zero));
        q.EndAt.Should().Be(new DateTimeOffset(2026, 12, 15, 5, 0, 0, TimeSpan.Zero));
    }

    [Fact]
    public void Hourly_rounds_up_partial_hours_and_enforces_minimum()
    {
        var room = Fixtures.Room(_t);
        var q = PricingEngine.QuoteHourly(_t, room, [], new DateTime(2026, 12, 14, 10, 0, 0), new DateTime(2026, 12, 14, 12, 30, 0), 2);
        q.Units.Should().Be(3);
        q.Total.Should().Be(450_000);

        var tooShort = () => PricingEngine.QuoteHourly(_t, room, [], new DateTime(2026, 12, 14, 10, 0, 0), new DateTime(2026, 12, 14, 11, 0, 0), 2);
        tooShort.Should().Throw<PricingException>().Which.Code.Should().Be("min_hours");
    }

    [Fact]
    public void Hourly_must_be_within_opening_hours()
    {
        var act = () => PricingEngine.QuoteHourly(_t, Fixtures.Room(_t), [], new DateTime(2026, 12, 14, 6, 0, 0), new DateTime(2026, 12, 14, 9, 0, 0), 2);
        act.Should().Throw<PricingException>().Which.Code.Should().Be("outside_hours");
        var late = () => PricingEngine.QuoteHourly(_t, Fixtures.Room(_t), [], new DateTime(2026, 12, 14, 21, 0, 0), new DateTime(2026, 12, 14, 23, 30, 0), 2);
        late.Should().Throw<PricingException>().Which.Code.Should().Be("outside_hours");
    }

    [Fact]
    public void Hour_window_rule_applies_only_to_matching_hours()
    {
        var room = Fixtures.Room(_t);
        var evening = new PriceRule { TenantId = _t.Id, Name = "Evening", Type = PriceRuleType.HourWindow, StartTime = new(18, 0), EndTime = new(23, 0), AdjustmentType = AdjustmentType.Percent, Value = 20 };
        var q = PricingEngine.QuoteHourly(_t, room, [evening], new DateTime(2026, 12, 14, 17, 0, 0), new DateTime(2026, 12, 14, 19, 0, 0), 2);
        q.Lines.Select(l => l.Price).Should().Equal(150_000m, 180_000m);
    }

    [Theory]
    [InlineData(2_890_000, 30, 867_000)]
    [InlineData(1_000_000, 30, 300_000)]
    [InlineData(1_431_500, 30, 429_000)]   // 429,450 → 429,000
    [InlineData(1_435_000, 30, 431_000)]   // 430,500 → 431,000 (half away from zero)
    [InlineData(500_000, 0, 0)]
    public void Deposit_is_rounded_to_the_nearest_thousand(decimal total, int pct, decimal expected) =>
        PricingEngine.DepositFor(total, pct).Should().Be(expected);
}

public class RefundEngineTests
{
    private static RefundPolicy Policy() => new()
    {
        Status = RefundPolicyStatus.Active, Version = 3, NoShowRefundPercent = 0,
        Rules =
        [
            new RefundRule { MinHoursBeforeCheckIn = 168, RefundPercent = 100, AppliesTo = RefundAppliesTo.Deposit, Label = "More than 7 days" },
            new RefundRule { MinHoursBeforeCheckIn = 72, MaxHoursBeforeCheckIn = 168, RefundPercent = 50, AppliesTo = RefundAppliesTo.Deposit, Label = "3 to 7 days" },
            new RefundRule { MinHoursBeforeCheckIn = 0, MaxHoursBeforeCheckIn = 72, RefundPercent = 0, AppliesTo = RefundAppliesTo.Deposit, Label = "Less than 72 hours" },
        ],
    };

    private static Booking Booking(decimal paid = 300_000) => new()
    {
        Code = "STR-TEST01", StartAt = new DateTimeOffset(2026, 12, 20, 7, 0, 0, TimeSpan.Zero), EndAt = new DateTimeOffset(2026, 12, 22, 5, 0, 0, TimeSpan.Zero),
        TotalAmount = 1_000_000, DepositAmount = 300_000, PaidAmount = paid, Status = BookingStatus.Confirmed,
    };

    [Theory]
    [InlineData(200, 100, 300_000, "More than 7 days")]
    [InlineData(168, 100, 300_000, "More than 7 days")]   // boundary is inclusive at the lower end
    [InlineData(167.9, 50, 150_000, "3 to 7 days")]
    [InlineData(72, 50, 150_000, "3 to 7 days")]
    [InlineData(71.5, 0, 0, "Less than 72 hours")]
    [InlineData(1, 0, 0, "Less than 72 hours")]
    public void Each_window_maps_to_its_rule(double hoursBefore, decimal pct, decimal amount, string label)
    {
        var b = Booking();
        var q = RefundEngine.Quote(Policy(), b, b.StartAt.AddHours(-hoursBefore));
        q.Covered.Should().BeTrue();
        q.RequiresApproval.Should().BeFalse();
        q.RefundPercent.Should().Be(pct);
        q.RefundAmount.Should().Be(amount);
        q.RuleLabel.Should().Be(label);
        q.PolicyVersion.Should().Be(3);
    }

    [Fact]
    public void Refund_is_capped_at_amount_paid()
    {
        var p = Policy();
        p.Rules[0].AppliesTo = RefundAppliesTo.Total;  // 100% of total = 1,000,000 but only 300,000 paid
        var b = Booking(paid: 300_000);
        var q = RefundEngine.Quote(p, b, b.StartAt.AddDays(-10));
        q.RefundAmount.Should().Be(300_000);
        q.Explanation.Should().Contain("limited to the amount already paid");
    }

    [Fact]
    public void Vietnamese_refund_explanation_preserves_the_amount_and_rule()
    {
        var policy = Policy();
        policy.Rules[0].AppliesTo = RefundAppliesTo.Total;
        policy.Rules[0].RefundPercent = 75.5m;
        var booking = Booking();
        var cancelAt = booking.StartAt.AddDays(-10);
        var english = RefundEngine.Quote(policy, booking, cancelAt);
        var vietnamese = RefundEngine.Quote(policy, booking, cancelAt, language: "vi");

        vietnamese.Should().BeEquivalentTo(english, options => options.Excluding(q => q.Explanation));
        vietnamese.Explanation.Should().Contain("10 ngày").And.Contain("75,5% tổng giá phòng")
            .And.Contain("tối đa bằng số tiền đã thanh toán");
    }

    [Fact]
    public void No_active_policy_requires_owner_approval()
    {
        var b = Booking();
        var q = RefundEngine.Quote(null, b, b.StartAt.AddDays(-10));
        q.RequiresApproval.Should().BeTrue();
        q.Covered.Should().BeFalse();

        var draft = Policy();
        draft.Status = RefundPolicyStatus.Draft;
        RefundEngine.Quote(draft, b, b.StartAt.AddDays(-10)).RequiresApproval.Should().BeTrue();
    }

    [Fact]
    public void Uncovered_window_requires_approval()
    {
        var p = Policy();
        p.Rules.RemoveAt(1); // 72–168h now missing
        var b = Booking();
        var q = RefundEngine.Quote(p, b, b.StartAt.AddHours(-100));
        q.Covered.Should().BeFalse();
        q.RequiresApproval.Should().BeTrue();
    }

    [Fact]
    public void After_check_in_time_counts_as_no_show()
    {
        var b = Booking();
        var q = RefundEngine.Quote(Policy(), b, b.StartAt.AddHours(1));
        q.RefundAmount.Should().Be(0);
        q.RuleLabel.Should().Contain("No-show");
    }

    [Fact]
    public void Nothing_paid_means_nothing_to_refund()
    {
        var b = Booking(paid: 0);
        RefundEngine.Quote(Policy(), b, b.StartAt.AddDays(-10)).RefundAmount.Should().Be(0);
    }

    [Fact]
    public void Analyze_reports_gaps_and_overlaps()
    {
        var rules = new List<RefundRule>
        {
            new() { MinHoursBeforeCheckIn = 168, RefundPercent = 100, Label = "A" },
            new() { MinHoursBeforeCheckIn = 0, MaxHoursBeforeCheckIn = 24, RefundPercent = 0, Label = "C" },
            new() { MinHoursBeforeCheckIn = 72, MaxHoursBeforeCheckIn = 200, RefundPercent = 50, Label = "B" },
        };
        var w = RefundEngine.Analyze(rules);
        w.Should().Contain(x => x.Code == "gap" && x.FromHours == 24 && x.ToHours == 72);
        w.Should().Contain(x => x.Code == "overlap" && x.FromHours == 168 && x.ToHours == 200);

        RefundEngine.Analyze(Policy().Rules).Should().BeEmpty();
        RefundEngine.Analyze([]).Should().ContainSingle(x => x.Code == "empty");
    }
}

public class StateMachineTests
{
    [Theory]
    [InlineData(BookingStatus.Hold, BookingStatus.Confirmed)]
    [InlineData(BookingStatus.Hold, BookingStatus.Expired)]
    [InlineData(BookingStatus.Hold, BookingStatus.Cancelled)]
    [InlineData(BookingStatus.PendingDeposit, BookingStatus.Confirmed)]
    [InlineData(BookingStatus.Confirmed, BookingStatus.CheckedIn)]
    [InlineData(BookingStatus.Confirmed, BookingStatus.Cancelled)]
    [InlineData(BookingStatus.Confirmed, BookingStatus.NoShow)]
    [InlineData(BookingStatus.CheckedIn, BookingStatus.CheckedOut)]
    public void Allowed_transitions(BookingStatus from, BookingStatus to) => BookingStateMachine.CanTransition(from, to).Should().BeTrue();

    [Theory]
    [InlineData(BookingStatus.Hold, BookingStatus.CheckedIn)]
    [InlineData(BookingStatus.Confirmed, BookingStatus.Hold)]
    [InlineData(BookingStatus.CheckedIn, BookingStatus.Cancelled)]
    [InlineData(BookingStatus.CheckedOut, BookingStatus.CheckedIn)]
    [InlineData(BookingStatus.Cancelled, BookingStatus.Confirmed)]
    [InlineData(BookingStatus.Expired, BookingStatus.Confirmed)]
    [InlineData(BookingStatus.NoShow, BookingStatus.CheckedIn)]
    public void Forbidden_transitions_throw(BookingStatus from, BookingStatus to)
    {
        BookingStateMachine.CanTransition(from, to).Should().BeFalse();
        var act = () => BookingStateMachine.EnsureCanTransition(from, to);
        act.Should().Throw<InvalidTransitionException>();
    }

    [Fact]
    public void Only_active_statuses_block_the_room()
    {
        BookingStateMachine.BlockingStatuses.Should().BeEquivalentTo([BookingStatus.Hold, BookingStatus.PendingDeposit, BookingStatus.Confirmed, BookingStatus.CheckedIn]);
        BookingStateMachine.IsBlocking(BookingStatus.Cancelled).Should().BeFalse();
        BookingStateMachine.IsBlocking(BookingStatus.CheckedOut).Should().BeFalse();
    }
}

public class AvailabilityTests
{
    private static readonly DateTimeOffset T0 = new(2026, 12, 20, 7, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Half_open_intervals_touching_do_not_overlap() =>
        Availability.Overlaps(T0, T0.AddHours(2), T0.AddHours(2), T0.AddHours(4)).Should().BeFalse();

    [Fact]
    public void Contained_and_partial_ranges_overlap()
    {
        Availability.Overlaps(T0, T0.AddHours(4), T0.AddHours(1), T0.AddHours(2)).Should().BeTrue();
        Availability.Overlaps(T0, T0.AddHours(4), T0.AddHours(3), T0.AddHours(6)).Should().BeTrue();
        Availability.Overlaps(T0.AddHours(3), T0.AddHours(6), T0, T0.AddHours(4)).Should().BeTrue();
    }

    [Fact]
    public void Hourly_bookings_add_the_cleaning_buffer_but_nightly_do_not()
    {
        var t = Fixtures.Tenant();
        Availability.BlockedUntil(t, BookingMode.Hourly, T0).Should().Be(T0.AddMinutes(60));
        Availability.BlockedUntil(t, BookingMode.Nightly, T0).Should().Be(T0);
    }

    [Fact]
    public void Expired_holds_do_not_block()
    {
        var b = new Booking { Status = BookingStatus.Hold, HoldExpiresAt = T0 };
        Availability.IsBlocking(b, T0.AddMinutes(1)).Should().BeFalse();
        Availability.IsBlocking(b, T0.AddMinutes(-1)).Should().BeTrue();
    }
}

public class HelperTests
{
    [Theory]
    [InlineData("0912345678", "0912345678")]
    [InlineData("+84 912 345 678", "0912345678")]
    [InlineData("84912345678", "0912345678")]
    [InlineData("0912.345.678", "0912345678")]
    [InlineData("0212345678", null)]
    [InlineData("12345", null)]
    public void Vietnamese_phone_normalization(string input, string? expected) => Phone.NormalizeVn(input).Should().Be(expected);

    [Fact]
    public void Booking_codes_are_readable_and_unique_enough()
    {
        var codes = Enumerable.Range(0, 2000).Select(_ => BookingCode.New()).ToList();
        codes.Should().OnlyContain(c => System.Text.RegularExpressions.Regex.IsMatch(c, "^STR-[2-9A-HJKMNP-Z]{6}$"));
        codes.Distinct().Count().Should().BeGreaterThan(1990);
    }
}
