using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Messaging;
using Stayra.Infrastructure.Persistence;

namespace Stayra.Tests;

[Collection("postgres")]
public class GuestMessageTests(PostgresFixture fixture)
{
    [Theory]
    [InlineData("vi", true)]
    [InlineData("en", false)]
    public async Task Booking_messages_use_the_linked_conversations_language(string language, bool bookingLinksToConversation)
    {
        var (tenant, room) = await fixture.CreateTenantAsync("message-language");
        var vi = language == "vi";
        var otherLanguage = vi ? "en" : "vi";
        tenant.DefaultLanguage = otherLanguage;
        tenant.AutoApproveChanges = true;

        await using var scope = fixture.Scope(tenant.Id);
        var db = scope.ServiceProvider.GetRequiredService<StayraDbContext>();
        var bookings = scope.ServiceProvider.GetRequiredService<BookingService>();
        var changes = scope.ServiceProvider.GetRequiredService<ChangeService>();
        var conversation = new Conversation { TenantId = tenant.Id, Language = language, Channel = ChannelType.WebWidget };
        db.Conversations.Add(conversation);
        await db.SaveChangesAsync();

        var start = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(45);
        var result = await bookings.CreateHoldAsync(tenant, new CreateBookingInput(room.Id, Stay.Nightly(start, start.AddDays(2)), 2,
            new GuestInfo("Demo Guest", "0912345678", null, null), BookingSource.Web,
            bookingLinksToConversation ? conversation.Id : null));
        var booking = result.Booking;
        if (!bookingLinksToConversation) conversation.BookingId = booking.Id;
        booking.PaidAmount = booking.DepositAmount;
        await bookings.TransitionAsync(tenant, booking, BookingStatus.Confirmed, Actors.System);

        var newStay = Stay.Nightly(start, start.AddDays(3));
        var change = await changes.RequestChangeAsync(tenant, booking, null, newStay, null, Actors.Guest, null, language: otherLanguage);
        change.Message.Should().Contain(vi ? "was updated" : "đã được cập nhật");
        var cancel = await changes.RequestCancellationAsync(tenant, booking, Actors.Guest, null);
        cancel.Request.Status.Should().Be(ChangeRequestStatus.Pending);
        cancel.Message.Should().Contain(vi ? "Chưa có quy tắc hủy" : "no active cancellation rules");
        await changes.RejectAsync(tenant, cancel.Request, booking, Actors.System, "Demo note");

        var payment = await bookings.SendRemainingPaymentAsync(tenant, booking, false);
        payment.Should().NotBeNull();

        var messages = await db.Messages.Where(m => m.ConversationId == conversation.Id).ToListAsync();
        messages.Should().Contain(m => m.Role == MessageRole.System && m.Content.Contains(vi ? "đã được xác nhận" : "is confirmed"));
        messages.Should().Contain(m => m.Role == MessageRole.System && m.Content.Contains(vi ? "đã được cập nhật" : "was updated")
            && m.Content.Contains(vi ? "Khoản chênh lệch được cộng" : "added to your remaining balance"));
        messages.Should().Contain(m => m.Role == MessageRole.System && m.Content.Contains(vi ? "Ghi chú từ chủ nhà: Demo note" : "Note from the host: Demo note"));
        messages.Should().Contain(m => m.Role == MessageRole.Bot && m.Content.Contains(vi ? "số tiền còn phải thanh toán" : "your remaining balance")
            && m.Content.Contains(GuestText.Amount(payment!.Amount, language)));

        conversation.Language = otherLanguage;
        await db.SaveChangesAsync();
        var reminderPayment = await bookings.SendRemainingPaymentAsync(tenant, booking, true);
        reminderPayment!.Id.Should().Be(payment!.Id);
        (await db.Messages.Where(m => m.ConversationId == conversation.Id && m.Role == MessageRole.Bot)
            .Select(m => m.Content).ToListAsync()).Should().Contain(m => m.Contains(vi ? "A friendly reminder" : "chưa thanh toán"));
    }

    [Fact]
    public void Zalo_booking_and_payment_cards_are_localized()
    {
        var booking = new Booking { Code = "STR-ABC234", Status = BookingStatus.Confirmed };
        var payment = new Payment { Amount = 1_250_000, PayUrl = "https://pay.example.test" };
        var cards = new[] { Cards.BookingSummary(booking, null), Cards.PaymentCard(payment, booking.Code) };
        var tenant = Fixtures.Tenant();

        DeplaoChannelAdapter.RenderCardsAsText(cards, tenant, "https://stayra.example.test", "vi")
            .Should().Contain("Đặt phòng STR-ABC234").And.Contain("đã xác nhận")
            .And.Contain("Thanh toán 1.250.000 ₫ qua VNPay: https://pay.example.test");
        DeplaoChannelAdapter.RenderCardsAsText(cards, tenant, "https://stayra.example.test")
            .Should().Contain("Booking STR-ABC234").And.Contain("confirmed")
            .And.Contain("Pay ₫1,250,000 with VNPay: https://pay.example.test");
    }
}
