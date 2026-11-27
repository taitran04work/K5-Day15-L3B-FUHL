using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Stayra.Application.Bookings;
using Stayra.Application.Common;
using Stayra.Application.Payments;
using Stayra.Application.Pricing;
using Stayra.Domain;
using Stayra.Infrastructure.Policies;

namespace Stayra.Infrastructure.Concierge;

public record ToolDef(string Name, string Description, string SchemaJson);

public class ToolContext(Tenant tenant, Conversation conversation)
{
    public Tenant Tenant { get; } = tenant;
    public Conversation Conversation { get; } = conversation;
    public List<Card> Cards { get; } = [];
    public bool HandedOff { get; set; }
}

public record ToolResult(string Json, bool IsError, string Summary);

/// <summary>Tool catalogue for the concierge. Every tool is tenant-scoped and executes deterministic server logic.</summary>
public partial class ConciergeTools(
    IAppDbContext db,
    BookingService bookings,
    ChangeService changes,
    PricingService pricing,
    PaymentService payments,
    PolicySearchService policySearch,
    AuditService audit,
    IRealtimeNotifier realtime,
    TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private const string StayProps = """
        "mode": { "type": "string", "enum": ["nightly", "hourly"], "description": "nightly = by the night, hourly = short stay by the hour" },
        "start": { "type": "string", "description": "Nightly: check-in date YYYY-MM-DD. Hourly: local start time YYYY-MM-DDTHH:mm" },
        "end": { "type": "string", "description": "Nightly: check-out date YYYY-MM-DD. Hourly: local end time YYYY-MM-DDTHH:mm" },
        "guests": { "type": "integer", "minimum": 1 }
        """;

    private const string Identity = """
        "code": { "type": "string", "description": "Booking code, e.g. STR-7K3Q9P" },
        "phone": { "type": "string", "description": "Phone number used for the booking" }
        """;

    public static readonly IReadOnlyList<ToolDef> Definitions =
    [
        new("search_policy", "Search the homestay's house rules, policies, FAQs and documents. Use for any question about rules, facilities, breakfast, parking, pets, cancellation terms, the area, etc.",
            """{"type":"object","properties":{"query":{"type":"string","description":"The guest's question in a few words"}},"required":["query"]}"""),
        new("list_rooms", "List the homestay's rooms with base prices and capacity. Shows room cards to the guest.",
            """{"type":"object","properties":{"guests":{"type":"integer","minimum":1},"mode":{"type":"string","enum":["nightly","hourly"]}}}"""),
        new("get_room_details", "Get full details and photos of one room. Shows a photo gallery to the guest.",
            """{"type":"object","properties":{"roomId":{"type":"string"}},"required":["roomId"]}"""),
        new("check_availability", "Check which rooms are free for given dates/times and get exact quotes. Shows available rooms as cards.",
            $$"""{"type":"object","properties":{ {{StayProps}}, "roomId": { "type": "string", "description": "Optional: only check this room" } },"required":["mode","start","end","guests"]}"""),
        new("quote_price", "Get the exact price breakdown and deposit for one room and stay. Shows a quote card.",
            $$"""{"type":"object","properties":{ "roomId": { "type": "string" }, {{StayProps}} },"required":["roomId","mode","start","end","guests"]}"""),
        new("create_booking", "Create the booking (held for a few minutes) and the MoMo deposit payment. Only after the guest confirmed the summary.",
            $$"""{"type":"object","properties":{ "roomId": { "type": "string" }, {{StayProps}}, "guestName": { "type": "string" }, "guestPhone": { "type": "string" }, "guestEmail": { "type": "string" }, "note": { "type": "string", "description": "Special requests" } },"required":["roomId","mode","start","end","guests","guestName","guestPhone"]}"""),
        new("find_booking", "Look up an existing booking. Requires the booking code and the phone number used to book.",
            $$"""{"type":"object","properties":{ {{Identity}} },"required":["code","phone"]}"""),
        new("quote_change", "Quote changing an existing booking's room and/or dates (availability + price difference). Does not change anything.",
            $$"""{"type":"object","properties":{ {{Identity}}, "newRoomId": { "type": "string" }, "newStart": { "type": "string" }, "newEnd": { "type": "string" }, "guests": { "type": "integer" } },"required":["code","phone"]}"""),
        new("request_change", "Apply (or request host approval for) a room/date change after the guest confirmed the quote.",
            $$"""{"type":"object","properties":{ {{Identity}}, "newRoomId": { "type": "string" }, "newStart": { "type": "string" }, "newEnd": { "type": "string" }, "guests": { "type": "integer" } },"required":["code","phone"]}"""),
        new("quote_cancellation", "Quote the refund for cancelling a booking under the active cancellation rules. Does not cancel.",
            $$"""{"type":"object","properties":{ {{Identity}} },"required":["code","phone"]}"""),
        new("request_cancellation", "Cancel the booking (or send the request to the host) after the guest confirmed the refund quote.",
            $$"""{"type":"object","properties":{ {{Identity}}, "reason": { "type": "string" } },"required":["code","phone"]}"""),
        new("create_remaining_payment", "Create a MoMo payment link for the remaining balance of a booking. Shows a payment card.",
            $$"""{"type":"object","properties":{ {{Identity}} },"required":["code","phone"]}"""),
        new("request_checkout", "The guest wants to check out. Notifies the host and sends the remaining payment link if a balance is due.",
            $$"""{"type":"object","properties":{ {{Identity}} },"required":["code","phone"]}"""),
        new("handoff_to_human", "Hand the conversation to the host (a person). Use for complaints, angry guests, requests you can't handle, or unanswered policy questions.",
            """{"type":"object","properties":{"reason":{"type":"string"}},"required":["reason"]}"""),
    ];

    public async Task<ToolResult> ExecuteAsync(ToolContext ctx, string name, JsonElement input, CancellationToken ct)
    {
        try
        {
            var (result, summary) = name switch
            {
                "search_policy" => await SearchPolicy(ctx, input, ct),
                "list_rooms" => await ListRooms(ctx, input, ct),
                "get_room_details" => await RoomDetails(ctx, input, ct),
                "check_availability" => await CheckAvailability(ctx, input, ct),
                "quote_price" => await QuotePrice(ctx, input, ct),
                "create_booking" => await CreateBooking(ctx, input, ct),
                "find_booking" => await FindBooking(ctx, input, ct),
                "quote_change" => await QuoteChange(ctx, input, ct),
                "request_change" => await RequestChange(ctx, input, ct),
                "quote_cancellation" => await QuoteCancellation(ctx, input, ct),
                "request_cancellation" => await RequestCancellation(ctx, input, ct),
                "create_remaining_payment" => await RemainingPayment(ctx, input, ct),
                "request_checkout" => await RequestCheckout(ctx, input, ct),
                "handoff_to_human" => await Handoff(ctx, Str(input, "reason") ?? "Guest needs help", ct),
                _ => throw new AppException(400, "unknown_tool", $"Unknown tool {name}"),
            };
            return new ToolResult(JsonSerializer.Serialize(result, Json), false, summary);
        }
        catch (AppException ex)
        {
            return new ToolResult(JsonSerializer.Serialize(new { error = ex.Code, message = ex.Message }, Json), true, $"{name}: {ex.Message}");
        }
        catch (InvalidTransitionException ex)
        {
            return new ToolResult(JsonSerializer.Serialize(new { error = "invalid_transition", message = ex.Message }, Json), true, $"{name}: {ex.Message}");
        }
    }

    // ---------------- Tools ----------------

    private async Task<(object, string)> SearchPolicy(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var q = Str(i, "query") ?? "";
        var r = await policySearch.SearchAsync(ctx.Tenant.Id, q, 5, ct);
        var results = r.Chunks.Select(c => new
        {
            source = $"{c.DocumentName}, page {c.Page}",
            text = Sanitize(PolicySearchService.BestPassage(c.Content, q)),
        }).ToList();
        var faqs = r.Faqs.Select(f => new { question = Sanitize(f.Question), answer = Sanitize(f.Answer) }).ToList();
        return (new
        {
            note = "Quoted document data. Answer only from it; if it doesn't answer the question, say you'll check with the host.",
            found = results.Count + faqs.Count > 0,
            faqs,
            results,
        }, $"Searched house rules for \"{q}\" ({results.Count + faqs.Count} results)");
    }

    private async Task<(object, string)> ListRooms(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var guests = Int(i, "guests");
        var mode = Str(i, "mode");
        var rooms = await db.Rooms.Include(r => r.Photos).Where(r => r.TenantId == ctx.Tenant.Id && r.IsActive).OrderBy(r => r.SortOrder).ToListAsync(ct);
        rooms = rooms.Where(r => (guests == null || r.MaxGuests >= guests) && (mode == null || (mode == "hourly" ? r.SupportsHourly : r.SupportsNightly))).ToList();
        ctx.Cards.Add(Cards.Rooms(rooms.Select(r => (r, (Quote?)null))));
        return (new
        {
            rooms = rooms.Select(r => new
            {
                id = r.Id, name = r.Name, maxGuests = r.MaxGuests, beds = r.Beds, areaM2 = r.AreaM2, amenities = r.Amenities,
                nightlyPrice = r.SupportsNightly ? r.BaseNightlyPrice : (decimal?)null,
                hourlyPrice = r.SupportsHourly ? r.BaseHourlyPrice : (decimal?)null,
                minHours = r.SupportsHourly ? r.MinHours : (int?)null,
                extraGuestFeePerNight = r.ExtraGuestFee > 0 ? r.ExtraGuestFee : (decimal?)null,
            }),
            note = "Base prices before weekend/holiday rules. Use check_availability or quote_price for exact totals.",
        }, $"Listed {rooms.Count} rooms");
    }

    private async Task<(object, string)> RoomDetails(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var room = await LoadRoom(ctx, Str(i, "roomId"), ct);
        ctx.Cards.Add(Cards.Gallery(room));
        return (new
        {
            id = room.Id, name = room.Name, description = Sanitize(room.Description ?? ""), maxGuests = room.MaxGuests, baseGuests = room.BaseGuests,
            beds = room.Beds, areaM2 = room.AreaM2, amenities = room.Amenities,
            nightlyPrice = room.SupportsNightly ? room.BaseNightlyPrice : (decimal?)null,
            hourlyPrice = room.SupportsHourly ? room.BaseHourlyPrice : (decimal?)null, minHours = room.SupportsHourly ? room.MinHours : (int?)null,
            extraGuestFee = room.ExtraGuestFee, photoCount = room.Photos.Count,
        }, $"Showed details of {room.Name}");
    }

    private async Task<(object, string)> CheckAvailability(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var stay = ParseStay(i, "start", "end");
        var guests = Int(i, "guests") ?? 2;
        Guid? roomId = Guid.TryParse(Str(i, "roomId"), out var rid) ? rid : null;
        var (available, unavailable) = await bookings.SearchAsync(ctx.Tenant, stay, guests, roomId, ct);
        if (available.Count > 0) ctx.Cards.Add(Cards.Rooms(available.Select(a => (a.Room, (Quote?)a.Quote))));
        return (new
        {
            available = available.Select(a => new
            {
                roomId = a.Room.Id, roomName = a.Room.Name, total = a.Quote.Total, deposit = a.Quote.Deposit,
                units = a.Quote.Units, unit = a.Quote.Mode == BookingMode.Nightly ? "nights" : "hours",
            }),
            unavailable = unavailable.Select(u => new { roomName = u.Room.Name, reason = u.Reason }),
        }, $"Checked availability {Describe(stay)} for {guests} guests: {available.Count} free");
    }

    private async Task<(object, string)> QuotePrice(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var room = await LoadRoom(ctx, Str(i, "roomId"), ct);
        var stay = ParseStay(i, "start", "end");
        var q = await pricing.QuoteAsync(ctx.Tenant, room.Id, stay, Int(i, "guests") ?? 2, ct);
        var available = q.StartAt > clock.GetUtcNow() && await bookings.IsAvailableAsync(room.Id, q.StartAt, Availability.BlockedUntil(ctx.Tenant, stay.Mode, q.EndAt), null, ct);
        ctx.Cards.Add(Cards.QuoteCard(q));
        return (new
        {
            roomName = room.Name, available, total = q.Total, deposit = q.Deposit, depositPercent = q.DepositPercent, units = q.Units,
            extraGuestFee = q.ExtraGuestFee, lines = q.Lines.Select(l => new { l.Label, l.Price, rule = l.RuleName }),
        }, $"Quoted {room.Name} {Describe(stay)}: {q.Total:N0} ₫");
    }

    private async Task<(object, string)> CreateBooking(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var room = await LoadRoom(ctx, Str(i, "roomId"), ct);
        var stay = ParseStay(i, "start", "end");
        var source = ctx.Conversation.Channel == ChannelType.Zalo ? BookingSource.Zalo : BookingSource.WebChat;
        var r = await bookings.CreateHoldAsync(ctx.Tenant, new CreateBookingInput(room.Id, stay, Int(i, "guests") ?? 2,
            new GuestInfo(Str(i, "guestName") ?? "", Str(i, "guestPhone") ?? "", Str(i, "guestEmail"), Str(i, "note")), source, ctx.Conversation.Id), ct);
        ctx.Conversation.BookingId = r.Booking.Id;
        ctx.Conversation.GuestName ??= r.Booking.GuestName;
        ctx.Conversation.GuestPhone ??= r.Booking.GuestPhone;
        ctx.Cards.Add(Cards.BookingSummary(r.Booking, r.Room));
        if (r.Deposit != null) ctx.Cards.Add(Cards.PaymentCard(r.Deposit, r.Booking.Code));
        return (new
        {
            code = r.Booking.Code, status = r.Booking.Status.ToString(), roomName = r.Room.Name, total = r.Booking.TotalAmount, deposit = r.Booking.DepositAmount,
            holdExpiresAtLocal = r.Booking.HoldExpiresAt is { } h ? TenantTime.ToLocal(ctx.Tenant, h).ToString("HH:mm") : null,
            holdMinutes = ctx.Tenant.HoldMinutes,
            note = "The guest sees a MoMo payment card. The booking is confirmed automatically once the deposit is paid.",
        }, $"Created booking {r.Booking.Code} (held)");
    }

    private async Task<(object, string)> FindBooking(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var b = await Find(ctx, i, ct);
        ctx.Cards.Add(Cards.BookingSummary(b, b.Room));
        return (BookingInfo(ctx, b), $"Found booking {b.Code}");
    }

    private async Task<(object, string)> QuoteChange(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var b = await Find(ctx, i, ct);
        Guid? newRoom = Guid.TryParse(Str(i, "newRoomId"), out var nr) ? nr : null;
        var stay = Str(i, "newStart") != null && Str(i, "newEnd") != null ? ParseStay(i, "newStart", "newEnd", b.Mode) : null;
        var q = await changes.QuoteChangeAsync(ctx.Tenant, b, newRoom, stay, Int(i, "guests"), ct, language: ctx.Conversation.Language);
        return (new
        {
            q.Available, q.UnavailableReason, q.RoomName, newCheckIn = Local(ctx, q.StartAt), newCheckOut = Local(ctx, q.EndAt),
            q.OldTotal, q.NewTotal, q.PriceDiff, q.AmountToPay, q.AmountToRefund, q.CreditAmount, q.RequiresApproval, q.Explanation,
        }, $"Quoted change for {b.Code}: diff {q.PriceDiff:N0} ₫");
    }

    private async Task<(object, string)> RequestChange(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var b = await Find(ctx, i, ct);
        Guid? newRoom = Guid.TryParse(Str(i, "newRoomId"), out var nr) ? nr : null;
        var stay = Str(i, "newStart") != null && Str(i, "newEnd") != null ? ParseStay(i, "newStart", "newEnd", b.Mode) : null;
        var o = await changes.RequestChangeAsync(ctx.Tenant, b, newRoom, stay, Int(i, "guests"), Actors.Guest, "Requested via chat", ct, language: ctx.Conversation.Language);
        return (new { status = o.Request.Status.ToString(), message = o.Message, newTotal = b.TotalAmount, extraPayment = o.ExtraPayment?.Amount, refunded = o.Refunded },
            $"Change request for {b.Code}: {o.Request.Status}");
    }

    private async Task<(object, string)> QuoteCancellation(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var b = await Find(ctx, i, ct);
        var q = await changes.QuoteCancellationAsync(ctx.Tenant, b, ct, language: ctx.Conversation.Language);
        return (new
        {
            q.RefundAmount, q.RefundPercent, appliesTo = q.AppliesTo?.ToString(), q.RuleLabel, q.HoursBeforeCheckIn, q.RequiresApproval,
            q.Explanation, paid = b.PaidAmount - b.RefundAmount,
        }, $"Quoted cancellation for {b.Code}: refund {q.RefundAmount:N0} ₫");
    }

    private async Task<(object, string)> RequestCancellation(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var b = await Find(ctx, i, ct);
        var o = await changes.RequestCancellationAsync(ctx.Tenant, b, Actors.Guest, Str(i, "reason") ?? "Requested via chat", ct, language: ctx.Conversation.Language);
        return (new { status = o.Request.Status.ToString(), bookingStatus = b.Status.ToString(), refunded = o.Refunded, message = o.Message },
            $"Cancellation for {b.Code}: {o.Request.Status}");
    }

    private async Task<(object, string)> RemainingPayment(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var b = await Find(ctx, i, ct);
        var p = await RemainingFor(ctx, b, ct);
        if (p == null) return (new { balance = 0, message = "Nothing left to pay for this booking." }, $"No balance due for {b.Code}");
        ctx.Cards.Add(Cards.PaymentCard(p, b.Code));
        return (new { balance = p.Amount, note = "The guest sees a MoMo payment card." }, $"Created remaining payment for {b.Code}: {p.Amount:N0} ₫");
    }

    private async Task<(object, string)> RequestCheckout(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var b = await Find(ctx, i, ct);
        if (b.Status is not (BookingStatus.CheckedIn or BookingStatus.Confirmed))
            throw new AppException(409, "not_checked_in", $"Booking {b.Code} is {b.Status}, so it can't be checked out.");
        var p = await RemainingFor(ctx, b, ct);
        if (p != null) ctx.Cards.Add(Cards.PaymentCard(p, b.Code));
        ctx.Conversation.NeedsAttention = true;
        ctx.Conversation.HandoffReason = $"Guest requested check-out for {b.Code}";
        audit.Log(ctx.Tenant.Id, Actors.Guest, "booking.checkout_requested", nameof(Booking), b.Id, new { b.Code, balance = p?.Amount ?? 0 });
        await db.SaveChangesAsync(ct);
        await realtime.ConversationUpdated(ctx.Tenant.Id, ctx.Conversation.Id);
        await realtime.BookingChanged(ctx.Tenant.Id, b.Id);
        return (new
        {
            balance = p?.Amount ?? 0,
            message = p != null
                ? "The host has been notified. The remaining balance must be paid before check-out (payment card shown)."
                : "The host has been notified and will complete the check-out. Nothing is left to pay.",
        }, $"Check-out requested for {b.Code}");
    }

    public async Task<(object, string)> Handoff(ToolContext ctx, string reason, CancellationToken ct)
    {
        ctx.Conversation.Status = ConversationStatus.HumanTakeover;
        ctx.Conversation.NeedsAttention = true;
        ctx.Conversation.HandoffReason = reason.Length > 300 ? reason[..300] : reason;
        ctx.HandedOff = true;
        audit.Log(ctx.Tenant.Id, Actors.Bot, "conversation.handoff", nameof(Conversation), ctx.Conversation.Id, new { reason });
        await db.SaveChangesAsync(ct);
        await realtime.ConversationUpdated(ctx.Tenant.Id, ctx.Conversation.Id);
        return (new { ok = true, note = "The host has been notified and will reply in this conversation." }, $"Handed off to host: {reason}");
    }

    // ---------------- Helpers ----------------

    public async Task<Payment?> RemainingFor(ToolContext ctx, Booking b, CancellationToken ct)
    {
        if (b.Status is not (BookingStatus.Confirmed or BookingStatus.CheckedIn)) throw new AppException(409, "not_confirmed", $"Booking {b.Code} isn't confirmed yet, so there's no remaining balance to pay.");
        var balance = b.TotalAmount - b.PaidAmount + b.RefundAmount - b.CreditAmount;
        if (balance < 1000) return null;
        var open = await db.Payments.Where(p => p.BookingId == b.Id && p.Kind == PaymentKind.Remaining && p.Status == PaymentStatus.Created && p.Amount == balance)
            .OrderByDescending(p => p.CreatedAt).FirstOrDefaultAsync(ct);
        return open ?? await payments.CreateAsync(ctx.Tenant, b, PaymentKind.Remaining, balance, null, ct);
    }

    private async Task<Booking> Find(ToolContext ctx, JsonElement i, CancellationToken ct)
    {
        var code = Str(i, "code") ?? "";
        var phone = Str(i, "phone") ?? "";
        if (code.Length == 0 || phone.Length == 0) throw new AppException(400, "identity_required", "Both the booking code and the phone number are required.");
        var b = await bookings.FindForGuestAsync(ctx.Tenant.Id, code, phone, ct);
        if (ctx.Conversation.BookingId == null)
        {
            ctx.Conversation.BookingId = b.Id;
            ctx.Conversation.GuestName ??= b.GuestName;
            ctx.Conversation.GuestPhone ??= b.GuestPhone;
        }
        return b;
    }

    private object BookingInfo(ToolContext ctx, Booking b) => new
    {
        code = b.Code, status = b.Status.ToString(), roomName = b.Room?.Name, mode = b.Mode.ToString(),
        checkIn = Local(ctx, b.StartAt), checkOut = Local(ctx, b.EndAt), guests = b.Guests, guestName = b.GuestName,
        total = b.TotalAmount, deposit = b.DepositAmount, paid = b.PaidAmount - b.RefundAmount,
        balance = Math.Max(0, b.TotalAmount - b.PaidAmount + b.RefundAmount - b.CreditAmount),
    };

    private async Task<Room> LoadRoom(ToolContext ctx, string? id, CancellationToken ct)
    {
        var rooms = await db.Rooms.Include(r => r.Photos).Where(r => r.TenantId == ctx.Tenant.Id && r.IsActive).ToListAsync(ct);
        if (Guid.TryParse(id, out var g) && rooms.FirstOrDefault(r => r.Id == g) is { } byId) return byId;
        // Be forgiving if the model passes a name or code instead of the id.
        var byName = rooms.FirstOrDefault(r => string.Equals(r.Name, id, StringComparison.OrdinalIgnoreCase) || string.Equals(r.Code, id, StringComparison.OrdinalIgnoreCase));
        return byName ?? throw new AppException(404, "room_not_found", "That room doesn't exist. Call list_rooms to get room ids.");
    }

    private static Stay ParseStay(JsonElement i, string startKey, string endKey, BookingMode? fallback = null)
    {
        var modeStr = Str(i, "mode");
        var mode = modeStr == null ? fallback ?? BookingMode.Nightly : modeStr.Equals("hourly", StringComparison.OrdinalIgnoreCase) ? BookingMode.Hourly : BookingMode.Nightly;
        return Stay.Parse(mode, Str(i, startKey) ?? throw new AppException(400, "missing_dates", "Dates are required."), Str(i, endKey) ?? throw new AppException(400, "missing_dates", "Dates are required."));
    }

    private static string Describe(Stay s) => s.Mode == BookingMode.Nightly ? $"{s.CheckIn:yyyy-MM-dd}→{s.CheckOut:yyyy-MM-dd}" : $"{s.StartLocal:yyyy-MM-dd HH:mm}→{s.EndLocal:HH:mm}";

    private static string Local(ToolContext ctx, DateTimeOffset utc) => TenantTime.ToLocal(ctx.Tenant, utc).ToString("yyyy-MM-dd HH:mm");

    public static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null
            ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText()) is { Length: > 0 } s ? s : null
            : null;

    public static int? Int(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
            ? v.ValueKind == JsonValueKind.Number ? v.GetInt32() : int.TryParse(v.ValueKind == JsonValueKind.String ? v.GetString() : null, out var n) ? n : null
            : null;

    /// <summary>Neutralizes instruction-like text in untrusted content before it goes back to the model.</summary>
    public static string Sanitize(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        var t = InjectionRegex().Replace(text, "[removed]");
        t = t.Replace("<", "‹").Replace(">", "›");
        return t.Length > 1500 ? t[..1500] : t;
    }

    [GeneratedRegex(@"(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)|you are now|new instructions?:|system prompt|act as\b|<\/?\s*(system|assistant|instructions?)\s*>",
        RegexOptions.IgnoreCase)]
    private static partial Regex InjectionRegex();
}
