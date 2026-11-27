namespace Stayra.Domain;

public enum TenantStatus { Active, Suspended }
public enum UserRole { PlatformAdmin, Owner, Staff }
public enum RemainingPaymentTrigger { HoursBeforeCheckIn, AtCheckIn, AtCheckOut }
public enum LowerPriceHandling { Refund, Credit }

public enum BookingMode { Nightly, Hourly }
public enum BookingSource { Web, WebChat, Zalo, Owner }

/// <summary>
/// Order matters: values 0-3 are "blocking" statuses that occupy a room (see exclusion constraint).
/// </summary>
public enum BookingStatus
{
    Hold = 0,
    PendingDeposit = 1,
    Confirmed = 2,
    CheckedIn = 3,
    CheckedOut = 4,
    Cancelled = 5,
    Expired = 6,
    NoShow = 7,
}

public enum PaymentKind { Deposit, Remaining, Extra, Refund }
public enum PaymentProvider { MoMo, Cash, Manual }
public enum PaymentStatus { Created, Paid, Failed, Expired, Refunded }

public enum ChangeRequestType { ChangeRoom, ChangeDates, Cancel }
public enum ChangeRequestStatus { Pending, Approved, Rejected, Auto }

public enum PriceRuleType { Weekend, DateRange, Holiday, HourWindow }
public enum AdjustmentType { Percent, Fixed, Override }

public enum DocumentStatus { Uploaded, Processing, Ready, Failed }
public enum RefundPolicyStatus { Draft, Active, Archived }
public enum RefundAppliesTo { Deposit, Total }
public enum FaqStatus { Suggested, Approved }

public enum ChannelType { WebWidget, Zalo }
public enum ConversationStatus { Bot, HumanTakeover, Closed }
public enum MessageRole { Guest, Bot, Owner, System, Tool }
