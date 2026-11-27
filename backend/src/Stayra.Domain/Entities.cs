namespace Stayra.Domain;

public interface ITenantOwned
{
    Guid TenantId { get; set; }
}

public abstract class Entity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
}

public class Tenant : Entity
{
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public TenantStatus Status { get; set; } = TenantStatus.Active;
    public string? Description { get; set; }
    public string? Address { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? LogoUrl { get; set; }
    public string? CoverImageUrl { get; set; }
    // Background photos for the guest home page slides (the hero uses CoverImageUrl). Empty = auto from room photos.
    public string? BgAboutUrl { get; set; }
    public string? BgRoomsUrl { get; set; }
    public string? BgPoliciesUrl { get; set; }
    public string? BgContactUrl { get; set; }
    public string AccentColor { get; set; } = "#1F5F4A";
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public string DefaultLanguage { get; set; } = "en";
    public string Currency { get; set; } = "VND";
    public string TimeZone { get; set; } = "Asia/Ho_Chi_Minh";
    public TimeOnly CheckInTime { get; set; } = new(14, 0);
    public TimeOnly CheckOutTime { get; set; } = new(12, 0);
    public TimeOnly OpeningTime { get; set; } = new(7, 0);
    public TimeOnly ClosingTime { get; set; } = new(23, 0);
    public int CleaningBufferMinutes { get; set; } = 60;
    public int DepositPercent { get; set; } = 30;
    public RemainingPaymentTrigger RemainingPaymentTrigger { get; set; } = RemainingPaymentTrigger.HoursBeforeCheckIn;
    public int RemainingPaymentHours { get; set; } = 24;
    public int RemainingReminderHours { get; set; } = 6;
    public int HoldMinutes { get; set; } = 15;

    // Bot / automation
    public bool BotEnabled { get; set; } = true;
    public string? BotPersona { get; set; }
    public bool AutoApproveChanges { get; set; } = true;
    public bool AutoApproveCancellations { get; set; } = true;
    public LowerPriceHandling LowerPriceHandling { get; set; } = LowerPriceHandling.Refund;

    // Zalo OA (secrets encrypted at rest)
    public string? ZaloAppId { get; set; }
    public string? ZaloOaId { get; set; }
    public string? ZaloOaSecretKeyEnc { get; set; }
    public string? ZaloAppSecretEnc { get; set; }
    public string? ZaloAccessTokenEnc { get; set; }
    public string? ZaloRefreshTokenEnc { get; set; }
    public DateTimeOffset? ZaloTokenExpiresAt { get; set; }

    // VNPay (per tenant, encrypted; falls back to platform sandbox)
    public string? VnpayTmnCode { get; set; }
    public string? VnpayHashSecretEnc { get; set; }

    // AI concierge: the homestay brings its own Anthropic key (encrypted at rest) and picks a model
    public string? AnthropicApiKeyEnc { get; set; }
    /// <summary>Last 4 characters of the key, so the owner can recognise it without us ever returning it.</summary>
    public string? AnthropicKeyHint { get; set; }
    public string? AiModel { get; set; }

    // Email notifications (per tenant, password encrypted at rest; falls back to platform SMTP)
    public string? SmtpHost { get; set; }
    public int? SmtpPort { get; set; }
    public string? SmtpUsername { get; set; }
    public string? SmtpPasswordEnc { get; set; }
    public string? SmtpFromEmail { get; set; }
    public string? SmtpFromName { get; set; }
    public bool SmtpEnableSsl { get; set; } = true;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class User : Entity
{
    public Guid? TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public UserRole Role { get; set; }
    public bool IsActive { get; set; } = true;
    public string? ResetToken { get; set; }
    public DateTimeOffset? ResetTokenExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastLoginAt { get; set; }
}

public class Room : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public string Name { get; set; } = "";
    public string Code { get; set; } = "";
    public string? Description { get; set; }
    public int MaxGuests { get; set; } = 2;
    public int BaseGuests { get; set; } = 2;
    public string? Beds { get; set; }
    public decimal? AreaM2 { get; set; }
    public List<string> Amenities { get; set; } = [];
    public bool IsActive { get; set; } = true;
    public bool SupportsNightly { get; set; } = true;
    public bool SupportsHourly { get; set; }
    public decimal BaseNightlyPrice { get; set; }
    public decimal BaseHourlyPrice { get; set; }
    public int MinHours { get; set; } = 2;
    public decimal ExtraGuestFee { get; set; }
    public int SortOrder { get; set; }
    public List<RoomPhoto> Photos { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class RoomPhoto : Entity
{
    public Guid RoomId { get; set; }
    public string Url { get; set; } = "";
    public string? Caption { get; set; }
    public int SortOrder { get; set; }
    public bool IsCover { get; set; }
}

public class PriceRule : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid? RoomId { get; set; }
    public string Name { get; set; } = "";
    public PriceRuleType Type { get; set; }
    public List<DayOfWeek> DaysOfWeek { get; set; } = [];
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    public AdjustmentType AdjustmentType { get; set; }
    public decimal Value { get; set; }
    public int Priority { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Booking : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public string Code { get; set; } = "";
    public Guid RoomId { get; set; }
    public Room? Room { get; set; }
    public BookingMode Mode { get; set; }
    public DateTimeOffset StartAt { get; set; }
    public DateTimeOffset EndAt { get; set; }
    /// <summary>EndAt plus cleaning buffer — the range the room is blocked for (used by the exclusion constraint).</summary>
    public DateTimeOffset BlockedUntil { get; set; }
    public int Guests { get; set; }
    public string GuestName { get; set; } = "";
    public string GuestPhone { get; set; } = "";
    public string? GuestEmail { get; set; }
    public string? Note { get; set; }
    public BookingSource Source { get; set; }
    public BookingStatus Status { get; set; }
    public decimal TotalAmount { get; set; }
    public decimal DepositAmount { get; set; }
    public decimal PaidAmount { get; set; }
    public decimal RefundAmount { get; set; }
    public decimal CreditAmount { get; set; }
    public string PriceBreakdownJson { get; set; } = "{}";
    public DateTimeOffset? HoldExpiresAt { get; set; }
    public Guid? ConversationId { get; set; }
    public string? CancelReason { get; set; }
    public string? RemainingJobId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ConfirmedAt { get; set; }
    public DateTimeOffset? CheckedInAt { get; set; }
    public DateTimeOffset? CheckedOutAt { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public List<Payment> Payments { get; set; } = [];

    public decimal Balance => TotalAmount - PaidAmount + RefundAmount;
}

public class Payment : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid BookingId { get; set; }
    public Booking? Booking { get; set; }
    public PaymentKind Kind { get; set; }
    public decimal Amount { get; set; }
    public PaymentProvider Provider { get; set; } = PaymentProvider.VNPay;
    public string OrderId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string? PayUrl { get; set; }
    public string? QrCodeUrl { get; set; }
    public string? Deeplink { get; set; }
    public PaymentStatus Status { get; set; } = PaymentStatus.Created;
    public long? TransId { get; set; }
    public Guid? RefundOfPaymentId { get; set; }
    public string? RawCallbackJson { get; set; }
    public string? Message { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? PaidAt { get; set; }
}

public class BookingChangeRequest : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid BookingId { get; set; }
    public Booking? Booking { get; set; }
    public ChangeRequestType Type { get; set; }
    public string PayloadJson { get; set; } = "{}";
    public decimal PriceDiff { get; set; }
    public decimal RefundQuote { get; set; }
    public string? Explanation { get; set; }
    public string? Reason { get; set; }
    public ChangeRequestStatus Status { get; set; } = ChangeRequestStatus.Pending;
    public string? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class PolicyDocument : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public string FileName { get; set; } = "";
    public string Url { get; set; } = "";
    public DocumentStatus Status { get; set; } = DocumentStatus.Uploaded;
    public string? StatusDetail { get; set; }
    public int PageCount { get; set; }
    public int ChunkCount { get; set; }
    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class PolicyChunk : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid DocumentId { get; set; }
    public string Content { get; set; } = "";
    public int Page { get; set; }
    public int Ordinal { get; set; }
    public Pgvector.Vector? Embedding { get; set; }
}

public class RefundPolicy : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public RefundPolicyStatus Status { get; set; } = RefundPolicyStatus.Draft;
    public int Version { get; set; }
    public Guid? SourceDocumentId { get; set; }
    public List<RefundRule> Rules { get; set; } = [];
    public decimal NoShowRefundPercent { get; set; }
    public string? Notes { get; set; }
    public List<string> Ambiguities { get; set; } = [];
    public string? ApprovedBy { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class RefundRule
{
    public int MinHoursBeforeCheckIn { get; set; }
    public int? MaxHoursBeforeCheckIn { get; set; }
    public decimal RefundPercent { get; set; }
    public RefundAppliesTo AppliesTo { get; set; }
    public string Label { get; set; } = "";
    public string? SourceQuote { get; set; }
    public int? SourcePage { get; set; }
}

public class FaqItem : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public string Question { get; set; } = "";
    public string Answer { get; set; } = "";
    public FaqStatus Status { get; set; } = FaqStatus.Approved;
    public Guid? SourceDocumentId { get; set; }
    public int SortOrder { get; set; }
}

public class Conversation : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public ChannelType Channel { get; set; }
    public string? ExternalUserId { get; set; }
    public string? VisitorToken { get; set; }
    public string? GuestName { get; set; }
    public string? GuestPhone { get; set; }
    public Guid? BookingId { get; set; }
    public string Language { get; set; } = "en";
    public ConversationStatus Status { get; set; } = ConversationStatus.Bot;
    public string? HandoffReason { get; set; }
    public bool NeedsAttention { get; set; }
    public int UnreadCount { get; set; }
    public string? LastMessagePreview { get; set; }
    /// <summary>State for the offline (no API key) guided assistant.</summary>
    public string? BotStateJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastMessageAt { get; set; } = DateTimeOffset.UtcNow;
    public List<Message> Messages { get; set; } = [];
}

public class Message : Entity
{
    public Guid ConversationId { get; set; }
    public MessageRole Role { get; set; }
    public string Content { get; set; } = "";
    public string? CardsJson { get; set; }
    public string? ToolName { get; set; }
    public string? ToolInputJson { get; set; }
    public string? ToolOutputJson { get; set; }
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public string? AuthorName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class AuditLog : Entity
{
    public Guid? TenantId { get; set; }
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string EntityType { get; set; } = "";
    public Guid? EntityId { get; set; }
    public string? DataJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
