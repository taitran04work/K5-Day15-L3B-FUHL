using System.Text.Json;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Api.Contracts;

public record PhotoDto(Guid Id, string Url, string? Caption, int SortOrder, bool IsCover);

public record RoomDto(
    Guid Id, string Name, string Code, string? Description, int MaxGuests, int BaseGuests, string? Beds, decimal? AreaM2,
    List<string> Amenities, bool IsActive, bool SupportsNightly, bool SupportsHourly, decimal BaseNightlyPrice, decimal BaseHourlyPrice,
    int MinHours, decimal ExtraGuestFee, int SortOrder, string? CoverUrl, List<PhotoDto> Photos)
{
    public static RoomDto From(Room r) => new(r.Id, r.Name, r.Code, r.Description, r.MaxGuests, r.BaseGuests, r.Beds, r.AreaM2, r.Amenities,
        r.IsActive, r.SupportsNightly, r.SupportsHourly, r.BaseNightlyPrice, r.BaseHourlyPrice, r.MinHours, r.ExtraGuestFee, r.SortOrder,
        Cards.Cover(r), r.Photos.OrderBy(p => p.SortOrder).Select(p => new PhotoDto(p.Id, p.Url, p.Caption, p.SortOrder, p.IsCover)).ToList());
}

public record BookingDto(
    Guid Id, string Code, Guid RoomId, string? RoomName, BookingMode Mode, DateTimeOffset StartAt, DateTimeOffset EndAt, int Guests,
    string GuestName, string GuestPhone, string? GuestEmail, string? Note, BookingSource Source, BookingStatus Status,
    decimal TotalAmount, decimal DepositAmount, decimal PaidAmount, decimal RefundAmount, decimal CreditAmount, decimal Balance,
    DateTimeOffset? HoldExpiresAt, DateTimeOffset CreatedAt, Guid? ConversationId, string? CancelReason)
{
    public static BookingDto From(Booking b, string? roomName = null) => new(b.Id, b.Code, b.RoomId, roomName ?? b.Room?.Name, b.Mode, b.StartAt, b.EndAt,
        b.Guests, b.GuestName, b.GuestPhone, b.GuestEmail, b.Note, b.Source, b.Status, b.TotalAmount, b.DepositAmount, b.PaidAmount,
        b.RefundAmount, b.CreditAmount, Math.Max(0, b.TotalAmount - b.PaidAmount + b.RefundAmount - b.CreditAmount), b.HoldExpiresAt, b.CreatedAt,
        b.ConversationId, b.CancelReason);
}

/// <summary>What a guest sees about their booking (no internal ids beyond what's needed).</summary>
public record GuestBookingDto(
    string Code, BookingStatus Status, BookingMode Mode, DateTimeOffset StartAt, DateTimeOffset EndAt, int Guests, string GuestName,
    RoomDto Room, decimal TotalAmount, decimal DepositAmount, decimal PaidAmount, decimal RefundAmount, decimal Balance,
    DateTimeOffset? HoldExpiresAt, List<PaymentDto> Payments, ChangeRequestDto? PendingRequest)
{
    public static GuestBookingDto From(Booking b, List<Payment> payments, BookingChangeRequest? pending) => new(b.Code, b.Status, b.Mode, b.StartAt, b.EndAt, b.Guests, b.GuestName,
        RoomDto.From(b.Room!), b.TotalAmount, b.DepositAmount, b.PaidAmount, b.RefundAmount,
        Math.Max(0, b.TotalAmount - b.PaidAmount + b.RefundAmount - b.CreditAmount), b.HoldExpiresAt,
        payments.OrderByDescending(p => p.CreatedAt).Select(PaymentDto.From).ToList(), pending is null ? null : ChangeRequestDto.From(pending));
}

public record PaymentDto(Guid Id, Guid BookingId, PaymentKind Kind, decimal Amount, PaymentProvider Provider, string OrderId, string? PayUrl,
    string? QrCodeUrl, string? Deeplink, PaymentStatus Status, long? TransId, string? Message, DateTimeOffset? ExpiresAt, DateTimeOffset CreatedAt, DateTimeOffset? PaidAt)
{
    public static PaymentDto From(Payment p) => new(p.Id, p.BookingId, p.Kind, p.Amount, p.Provider, p.OrderId, p.PayUrl, p.QrCodeUrl, p.Deeplink,
        p.Status, p.TransId, p.Message, p.ExpiresAt, p.CreatedAt, p.PaidAt);
}

public record ChangeRequestDto(Guid Id, Guid BookingId, ChangeRequestType Type, JsonElement Payload, decimal PriceDiff, decimal RefundQuote,
    string? Explanation, string? Reason, ChangeRequestStatus Status, string? DecidedBy, DateTimeOffset? DecidedAt, DateTimeOffset CreatedAt)
{
    public static ChangeRequestDto From(BookingChangeRequest r) => new(r.Id, r.BookingId, r.Type, JsonSerializer.Deserialize<JsonElement>(r.PayloadJson),
        r.PriceDiff, r.RefundQuote, r.Explanation, r.Reason, r.Status, r.DecidedBy, r.DecidedAt, r.CreatedAt);
}

public record PriceRuleDto(Guid Id, Guid? RoomId, string Name, PriceRuleType Type, List<DayOfWeek> DaysOfWeek, DateOnly? StartDate, DateOnly? EndDate,
    TimeOnly? StartTime, TimeOnly? EndTime, AdjustmentType AdjustmentType, decimal Value, int Priority, bool IsActive)
{
    public static PriceRuleDto From(PriceRule r) => new(r.Id, r.RoomId, r.Name, r.Type, r.DaysOfWeek, r.StartDate, r.EndDate, r.StartTime, r.EndTime,
        r.AdjustmentType, r.Value, r.Priority, r.IsActive);
}

public record TenantSettingsDto(
    Guid Id, string Slug, string Name, string? Description, string? Address, string? Phone, string? Email, string? LogoUrl, string? CoverImageUrl,
    string AccentColor, double? Latitude, double? Longitude, string DefaultLanguage, string Currency, string TimeZone,
    string CheckInTime, string CheckOutTime, string OpeningTime, string ClosingTime, int CleaningBufferMinutes,
    int DepositPercent, RemainingPaymentTrigger RemainingPaymentTrigger, int RemainingPaymentHours, int RemainingReminderHours, int HoldMinutes,
    bool BotEnabled, string? BotPersona, bool AutoApproveChanges, bool AutoApproveCancellations, LowerPriceHandling LowerPriceHandling,
    bool ZaloConnected, string? ZaloAppId, string? ZaloOaId, bool MomoCustom, string? MomoPartnerCode)
{
    public static TenantSettingsDto From(Tenant t) => new(t.Id, t.Slug, t.Name, t.Description, t.Address, t.Phone, t.Email, t.LogoUrl, t.CoverImageUrl,
        t.AccentColor, t.Latitude, t.Longitude, t.DefaultLanguage, t.Currency, t.TimeZone,
        t.CheckInTime.ToString("HH:mm"), t.CheckOutTime.ToString("HH:mm"), t.OpeningTime.ToString("HH:mm"), t.ClosingTime.ToString("HH:mm"),
        t.CleaningBufferMinutes, t.DepositPercent, t.RemainingPaymentTrigger, t.RemainingPaymentHours, t.RemainingReminderHours, t.HoldMinutes,
        t.BotEnabled, t.BotPersona, t.AutoApproveChanges, t.AutoApproveCancellations, t.LowerPriceHandling,
        !string.IsNullOrEmpty(t.ZaloAccessTokenEnc), t.ZaloAppId, t.ZaloOaId, !string.IsNullOrEmpty(t.MomoSecretKeyEnc), t.MomoPartnerCode);
}

/// <summary>Public, guest-facing tenant info.</summary>
public record PublicTenantDto(string Slug, string Name, string? Description, string? Address, string? Phone, string? Email, string? LogoUrl,
    string? CoverImageUrl, string AccentColor, double? Latitude, double? Longitude, string DefaultLanguage, string Currency, string TimeZone,
    string CheckInTime, string CheckOutTime, string OpeningTime, string ClosingTime, int DepositPercent, int HoldMinutes, bool BotEnabled)
{
    public static PublicTenantDto From(Tenant t) => new(t.Slug, t.Name, t.Description, t.Address, t.Phone, t.Email, t.LogoUrl, t.CoverImageUrl,
        t.AccentColor, t.Latitude, t.Longitude, t.DefaultLanguage, t.Currency, t.TimeZone, t.CheckInTime.ToString("HH:mm"), t.CheckOutTime.ToString("HH:mm"),
        t.OpeningTime.ToString("HH:mm"), t.ClosingTime.ToString("HH:mm"), t.DepositPercent, t.HoldMinutes, t.BotEnabled);
}

public record FaqDto(Guid Id, string Question, string Answer, FaqStatus Status, int SortOrder)
{
    public static FaqDto From(FaqItem f) => new(f.Id, f.Question, f.Answer, f.Status, f.SortOrder);
}

public record RefundRuleDto(int MinHoursBeforeCheckIn, int? MaxHoursBeforeCheckIn, decimal RefundPercent, RefundAppliesTo AppliesTo, string Label, string? SourceQuote, int? SourcePage);

public record RefundPolicyDto(Guid Id, RefundPolicyStatus Status, int Version, Guid? SourceDocumentId, List<RefundRuleDto> Rules, decimal NoShowRefundPercent,
    string? Notes, List<string> Ambiguities, string? ApprovedBy, DateTimeOffset? ApprovedAt, DateTimeOffset CreatedAt, List<Application.Refunds.PolicyWarning> Warnings)
{
    public static RefundPolicyDto From(RefundPolicy p) => new(p.Id, p.Status, p.Version, p.SourceDocumentId,
        p.Rules.OrderByDescending(r => r.MinHoursBeforeCheckIn).Select(r => new RefundRuleDto(r.MinHoursBeforeCheckIn, r.MaxHoursBeforeCheckIn, r.RefundPercent, r.AppliesTo, r.Label, r.SourceQuote, r.SourcePage)).ToList(),
        p.NoShowRefundPercent, p.Notes, p.Ambiguities, p.ApprovedBy, p.ApprovedAt, p.CreatedAt, Application.Refunds.RefundEngine.Analyze(p.Rules).ToList());
}

public record PolicyDocumentDto(Guid Id, string FileName, string Url, DocumentStatus Status, string? StatusDetail, int PageCount, int ChunkCount, DateTimeOffset UploadedAt)
{
    public static PolicyDocumentDto From(PolicyDocument d) => new(d.Id, d.FileName, d.Url, d.Status, d.StatusDetail, d.PageCount, d.ChunkCount, d.UploadedAt);
}
