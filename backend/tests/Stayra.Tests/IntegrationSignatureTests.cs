using FluentAssertions;
using Stayra.Application.Bookings;
using Stayra.Domain;
using Stayra.Infrastructure.Concierge;
using Stayra.Infrastructure.Messaging;
using Stayra.Infrastructure.Payments;
using Stayra.Infrastructure.Persistence;
using Stayra.Infrastructure.Policies;

namespace Stayra.Tests;

public class MomoSignatureTests
{
    private const string Secret = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
    private const string Access = "F8BBA842ECF85";

    [Fact]
    public void Create_raw_signature_uses_alphabetical_field_order()
    {
        var raw = MomoGateway.CreateRawSignature(Access, 50000, "", "https://example.com/ipn", "STR-TEST-D1", "Deposit STR-TEST", "MOMO",
            "https://example.com/return", "req-1", "captureWallet");
        raw.Should().Be("accessKey=F8BBA842ECF85&amount=50000&extraData=&ipnUrl=https://example.com/ipn&orderId=STR-TEST-D1&orderInfo=Deposit STR-TEST" +
                        "&partnerCode=MOMO&redirectUrl=https://example.com/return&requestId=req-1&requestType=captureWallet");
        // Reference value computed independently with Python's hmac/hashlib.
        MomoGateway.Sign(raw, Secret).Should().Be("1fc37978512eeb456e632249a3aa177a15155fdf57f9a9542701972262104a7b");
    }

    [Fact]
    public void Ipn_signature_verifies_and_rejects_tampering()
    {
        var fields = new Dictionary<string, string>
        {
            ["partnerCode"] = "MOMO", ["orderId"] = "STR-TEST-D1", ["requestId"] = "req-1", ["amount"] = "50000", ["orderInfo"] = "Deposit",
            ["orderType"] = "momo_wallet", ["transId"] = "4088878653", ["resultCode"] = "0", ["message"] = "Successful.", ["payType"] = "qr",
            ["responseTime"] = "1721720663942", ["extraData"] = "",
        };
        var sig = MomoGateway.Sign(MomoGateway.IpnRawSignature(Access, fields), Secret);
        var gateway = new MomoGateway(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new MomoOptions()), new NullProtector(), Microsoft.Extensions.Logging.Abstractions.NullLogger<MomoGateway>.Instance);
        var creds = new Stayra.Application.Payments.GatewayCredentials("MOMO", Access, Secret);

        gateway.VerifyIpn(creds, fields, sig).Should().BeTrue();
        fields["amount"] = "1000";
        gateway.VerifyIpn(creds, fields, sig).Should().BeFalse();
        gateway.VerifyIpn(creds, fields, "").Should().BeFalse();
    }

    private class NullProtector : Stayra.Application.Common.ISecretProtector
    {
        public string? Protect(string? plain) => plain;
        public string? Unprotect(string? cipher) => cipher;
    }
}

public class ZaloSignatureTests
{
    [Fact]
    public void Mac_is_sha256_of_appId_data_timestamp_secret()
    {
        // Reference value computed independently with Python's hashlib.
        ZaloSignature.Compute("app1", "{\"a\":1}", "1700000000000", "secret")
            .Should().Be("7922818691670026e446b17e14a82f7510bdf379925f456e4d6e6ec96a19c2ef");
    }

    [Fact]
    public void Verify_accepts_mac_prefix_and_rejects_wrong_secret()
    {
        var mac = ZaloSignature.Compute("app1", "{\"a\":1}", "1700000000000", "secret");
        ZaloSignature.Verify("mac=" + mac, "app1", "{\"a\":1}", "1700000000000", "secret").Should().BeTrue();
        ZaloSignature.Verify(mac.ToUpperInvariant(), "app1", "{\"a\":1}", "1700000000000", "secret").Should().BeTrue();
        ZaloSignature.Verify("mac=" + mac, "app1", "{\"a\":1}", "1700000000000", "other").Should().BeFalse();
        ZaloSignature.Verify("mac=" + mac, "app1", "{\"a\":2}", "1700000000000", "secret").Should().BeFalse();
        ZaloSignature.Verify(null, "app1", "{}", "1", "secret").Should().BeFalse();
    }
}

public class PolicyExtractionTests
{
    [Fact]
    public void Heuristic_extracts_the_sample_policy_pdf()
    {
        var pages = PdfText.Extract(SeedPdf.PineHillPolicy());
        pages.Should().NotBeEmpty();
        var p = PolicyExtractionService.Heuristic(pages);
        var rules = PolicyExtractionService.Validate(p);

        rules.Should().HaveCount(3);
        rules[0].Should().BeEquivalentTo(new { MinHoursBeforeCheckIn = 168, MaxHoursBeforeCheckIn = (int?)null, RefundPercent = 100m, AppliesTo = Stayra.Domain.RefundAppliesTo.Deposit },
            o => o.ExcludingMissingMembers());
        rules[1].Should().BeEquivalentTo(new { MinHoursBeforeCheckIn = 72, MaxHoursBeforeCheckIn = (int?)168, RefundPercent = 50m }, o => o.ExcludingMissingMembers());
        rules[2].Should().BeEquivalentTo(new { MinHoursBeforeCheckIn = 0, MaxHoursBeforeCheckIn = (int?)72, RefundPercent = 0m }, o => o.ExcludingMissingMembers());
        rules.Should().OnlyContain(r => r.SourceQuote != null && r.SourcePage > 0);
        p.NoShowRefundPercent.Should().Be(0);
        p.SuggestedFaqs.Should().Contain(f => f.Question.Contains("breakfast"));
        p.SuggestedFaqs.Should().OnlyContain(f => !f.Answer.StartsWith("3."));
        Stayra.Application.Refunds.RefundEngine.Analyze(rules).Should().BeEmpty();
    }

    [Fact]
    public void Chunks_keep_page_numbers_and_overlap()
    {
        var long1 = string.Join(" ", Enumerable.Range(0, 400).Select(i => $"Sentence number {i} about the homestay."));
        var chunks = PdfText.Chunk([new PageText(1, long1), new PageText(2, "Short page two.")], maxChars: 1000, overlapChars: 200);
        chunks.Where(c => c.Page == 1).Should().HaveCountGreaterThan(5);
        chunks.Should().OnlyContain(c => c.Content.Length <= 1300);
        chunks.Last().Page.Should().Be(2);
        // consecutive chunks on the same page share some text (overlap)
        var a = chunks[0].Content; var b = chunks[1].Content;
        a.Should().Contain(b[..40]);
    }
}

public class OfflineParsingTests
{
    private static readonly DateOnly Today = new(2026, 11, 27);

    [Theory]
    [InlineData("from 2026-12-24 to 2026-12-26", "2026-12-24,2026-12-26")]
    [InlineData("20/12 den 22/12", "2026-12-20,2026-12-22")]
    [InlineData("tomorrow", "2026-11-28")]
    [InlineData("ngay mai", "2026-11-28")]
    [InlineData("dec 20 - dec 23", "2026-12-20,2026-12-23")]
    [InlineData("3/1", "2027-01-03")]
    [InlineData("2026-11-28T14:00 den 2026-11-28T17:00", "2026-11-28")]
    public void Dates_are_parsed(string text, string expected) =>
        string.Join(",", OfflineConcierge.ParseDates(OfflineConcierge.Plain(text), Today).Select(d => d.ToString("yyyy-MM-dd"))).Should().Be(expected);

    [Fact]
    public void Times_and_phones_are_parsed()
    {
        OfflineConcierge.ParseTimes("tu 14h den 17:30").Should().Equal(new TimeOnly(14, 0), new TimeOnly(17, 30));
        OfflineConcierge.ParseTimes("2pm to 5pm").Should().Equal(new TimeOnly(14, 0), new TimeOnly(17, 0));
        OfflineConcierge.ParseTimes("2026-11-28T14:00 to 2026-11-28T17:00").Should().Equal(new TimeOnly(14, 0), new TimeOnly(17, 0));
        OfflineConcierge.ExtractPhone("call me on +84 912 345 678 please").Should().Be("0912345678");
        OfflineConcierge.ExtractPhone("STR-ABC234").Should().BeNull();
    }

    [Theory]
    [InlineData("bữa sáng", "breakfast")]
    [InlineData("chó mèo", "Pets")]
    [InlineData("đậu xe ô tô", "parking")]
    public void Bilingual_policy_passage_matches_vietnamese_queries(string query, string expectedEnglishWord)
    {
        var chunk = "A simple breakfast is served from 07:00 to 09:30. Pets are not allowed, except registered assistance animals. Free parking is available for motorbikes; car parking is on the street.";
        PolicySearchService.BestPassage(chunk, query).Should().Contain(expectedEnglishWord);
    }

    [Theory]
    [InlineData("Xin chào, còn phòng không?", "vi")]
    [InlineData("Hi, is breakfast included?", "en")]
    [InlineData("cho minh hoi gia phong", "vi")]
    public void Language_detection(string text, string expected) => ConciergeService.DetectLanguage(text, "en").Should().Be(expected);

    [Fact]
    public void Confirmation_email_includes_room_dates_and_escapes_html()
    {
        var tenant = Fixtures.Tenant();
        tenant.Name = "Pine Hill Homestay";
        tenant.Slug = "pine-hill";
        tenant.Address = "12 Hoa Hồng, Đà Lạt";
        tenant.Phone = "0912345678";
        var room = Fixtures.Room(tenant);
        var booking = new Booking
        {
            TenantId = tenant.Id,
            Code = "STR-7K3Q9P",
            RoomId = room.Id,
            Room = room,
            Mode = BookingMode.Nightly,
            StartAt = new DateTimeOffset(2026, 11, 28, 7, 0, 0, TimeSpan.Zero),
            EndAt = new DateTimeOffset(2026, 11, 29, 5, 0, 0, TimeSpan.Zero),
            Guests = 2,
            GuestName = "Lan <script>alert(1)</script>",
            GuestPhone = "0912345678",
            GuestEmail = "guest@example.com",
            Note = "Late arrival",
            TotalAmount = 1_020_000,
            DepositAmount = 306_000,
            PaidAmount = 306_000,
            Status = BookingStatus.Confirmed,
        };

        var vi = BookingEmail.Confirmation(tenant, booking, room, "vi", "http://localhost:5173");
        vi.To.Should().Be("guest@example.com");
        vi.Subject.Should().Contain("STR-7K3Q9P").And.Contain("Pine Hill Homestay");
        vi.TextBody.Should().Contain("Pine Loft").And.Contain("28/11/2026").And.Contain("29/11/2026").And.Contain("306.000 ₫").And.Contain("714.000 ₫");
        vi.HtmlBody.Should().NotContain("<script>").And.Contain("&lt;script&gt;").And.Contain("http://localhost:5173/h/pine-hill/manage?code=STR-7K3Q9P");

        var en = BookingEmail.Confirmation(tenant, booking, room, "en", "http://localhost:5173");
        en.Subject.Should().Contain("Booking confirmed: STR-7K3Q9P");
        en.TextBody.Should().Contain("Pine Loft").And.Contain("₫306,000").And.Contain("₫714,000");
    }
}
