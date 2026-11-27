using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Messaging;
using DomainMessage = Stayra.Domain.Message;

namespace Stayra.Infrastructure.Concierge;

/// <summary>
/// Deterministic bilingual (en/vi) guided assistant used when no Anthropic API key is configured. It uses exactly the same
/// tools as the AI concierge (so prices, availability and refunds are still computed server-side) and keeps its
/// progress in Conversation.BotStateJson.
/// </summary>
public partial class OfflineConcierge(IAppDbContext db, ConciergeTools tools, IRealtimeNotifier realtime, TimeProvider clock)
{
    public class BotState
    {
        public string? Flow { get; set; }      // book | lookup
        public string? Step { get; set; }      // dates | guests | room | name | phone | email | confirm | lookup_phone | confirm_cancel
        public string? Intent { get; set; }    // view | cancel | pay | checkout
        public Guid? RoomId { get; set; }
        public string Mode { get; set; } = "nightly";
        public string? Start { get; set; }
        public string? End { get; set; }
        public int? Guests { get; set; }
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public bool AskedEmail { get; set; }
        public string? Code { get; set; }
        public string? CodePhone { get; set; }
        public List<Guid> Options { get; set; } = [];
    }

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private ToolContext _ctx = null!;
    private string _lang = "en";

    private string L(string en, string vi) => _lang == "vi" ? vi : en;

    public async Task<string> ReplyAsync(ToolContext ctx, string text, CancellationToken ct)
    {
        _ctx = ctx;
        _lang = ctx.Conversation.Language;
        var s = string.IsNullOrEmpty(ctx.Conversation.BotStateJson) ? new BotState() : JsonSerializer.Deserialize<BotState>(ctx.Conversation.BotStateJson, Json) ?? new BotState();
        string reply;
        try { reply = await Handle(s, text, ct); }
        finally
        {
            ctx.Conversation.BotStateJson = JsonSerializer.Serialize(s, Json);
            await db.SaveChangesAsync(ct);
        }
        return reply;
    }

    private async Task<string> Handle(BotState s, string text, CancellationToken ct)
    {
        var plain = Plain(text);
        var tenant = _ctx.Tenant;
        var today = DateOnly.FromDateTime(TenantTime.Now(tenant, clock));

        // Escalation always wins.
        if (HumanRx().IsMatch(plain))
        {
            await Call("handoff_to_human", new { reason = $"Guest asked: {Trim(text, 160)}" }, ct);
            Reset(s);
            return L("I've asked the host to join this conversation — they'll reply here shortly.",
                "Mình đã báo chủ nhà, chủ nhà sẽ trả lời bạn ngay trong cuộc trò chuyện này nhé.");
        }

        // ---- Pending confirmations ----
        if (s.Step == "confirm")
        {
            if (Yes(plain)) return await CreateBooking(s, ct);
            if (No(plain))
            {
                Reset(s);
                return L("No problem, nothing was booked. Would you like to try other dates or another room?",
                    "Không sao, mình chưa đặt phòng nào. Bạn muốn thử ngày khác hoặc phòng khác không?");
            }
        }
        if (s.Step == "confirm_cancel")
        {
            if (Yes(plain))
            {
                var r = await Call("request_cancellation", new { code = s.Code, phone = s.CodePhone, reason = "Requested via chat" }, ct);
                s.Step = null;
                s.Intent = null;
                if (r.IsError) return Error(r);
                var cr = JsonDocument.Parse(r.Json).RootElement;
                if (cr.GetProperty("status").GetString() == "Pending")
                    return L("I've sent your cancellation request to the host. You'll get a message here as soon as they respond.",
                        "Mình đã gửi yêu cầu hủy cho chủ nhà. Bạn sẽ nhận được tin nhắn ngay khi chủ nhà phản hồi nhé.");
                var refunded = cr.GetProperty("refunded").GetDecimal();
                return refunded > 0
                    ? L($"Done — booking {s.Code} is cancelled and {Vnd(refunded)} is on its way back to your MoMo wallet. Is there anything else I can help with?",
                        $"Xong rồi — đặt phòng {s.Code} đã được hủy và {Vnd(refunded)} sẽ được hoàn về ví MoMo của bạn. Bạn cần hỗ trợ gì thêm không?")
                    : L($"Done — booking {s.Code} is cancelled. Is there anything else I can help with?",
                        $"Xong rồi — đặt phòng {s.Code} đã được hủy. Bạn cần hỗ trợ gì thêm không?");
            }
            if (No(plain))
            {
                s.Step = null;
                return L("Okay, your booking stays as it is.", "Được rồi, đặt phòng của bạn vẫn giữ nguyên nhé.");
            }
        }

        // ---- Existing bookings (code + phone) ----
        var code = CodeRx().Match(text.ToUpperInvariant()) is { Success: true } cm ? cm.Value.Replace(" ", "") : null;
        var phone = ExtractPhone(text);
        var intent = CancelRx().IsMatch(plain) ? "cancel" : PayRx().IsMatch(plain) ? "pay" : CheckoutRx().IsMatch(plain) ? "checkout" : null;
        if (code != null)
        {
            s.Intent = intent ?? (s.Flow == "lookup" ? s.Intent : null) ?? "view";
            s.Code = code;
            s.Flow = "lookup";
            if (phone != null) s.CodePhone = phone;
            else if (s.CodePhone == null)
            {
                s.Step = "lookup_phone";
                return L($"Thanks! To protect your booking, what phone number did you use for {code}?",
                    $"Cảm ơn bạn! Để bảo mật, bạn cho mình số điện thoại đã dùng khi đặt {code} nhé?");
            }
            return await BookingAction(s, ct);
        }
        if (s.Step == "lookup_phone" && phone != null)
        {
            s.CodePhone = phone;
            return await BookingAction(s, ct);
        }
        if (s.Step == "lookup_phone" && text.Count(char.IsDigit) >= 6 && !BookRx().IsMatch(plain) && ParseDates(plain, today).Count == 0)
            return L("That doesn't look like a Vietnamese mobile number. Please send it like 0912 345 678.",
                "Số điện thoại chưa đúng định dạng. Bạn gửi lại giúp mình dạng 0912 345 678 nhé.");
        if (s.Step == "lookup_phone") { s.Step = null; s.Flow = null; } // the guest moved on to something else
        if (intent != null && s.Code != null && s.CodePhone != null && s.Flow != "book")
        {
            s.Intent = intent;
            return await BookingAction(s, ct);
        }
        if (intent is "cancel" or "pay" or "checkout" && s.Flow != "book")
        {
            s.Flow = "lookup";
            s.Intent = intent;
            s.Step = null;
            return L("Sure. Please send me your booking code (like STR-7K3Q9P) and the phone number you booked with.",
                "Được ạ. Bạn gửi giúp mình mã đặt phòng (ví dụ STR-7K3Q9P) và số điện thoại đã dùng khi đặt nhé.");
        }

        // ---- Booking flow ----
        var rooms = await db.Rooms.Where(r => r.TenantId == tenant.Id && r.IsActive).OrderBy(r => r.SortOrder).ToListAsync(ct);
        var dates = ParseDates(plain, today);
        var nights = NightsRx().Match(plain) is { Success: true } nm ? int.Parse(nm.Groups[1].Value) : (int?)null;
        var guests = GuestsRx().Match(plain) is { Success: true } gm ? int.Parse(gm.Groups[1].Success ? gm.Groups[1].Value : gm.Groups[2].Value) : (int?)null;
        var hourly = HourlyRx().IsMatch(plain);
        var times = ParseTimes(plain);
        var hoursCount = HoursRx().Match(plain) is { Success: true } hm ? int.Parse(hm.Groups[1].Value) : (int?)null;
        var roomMatch = MatchRoom(rooms, plain, s);
        var bookIntent = BookRx().IsMatch(plain) || dates.Count > 0 || s.Flow == "book";

        if (bookIntent)
        {
            if (s.Flow != "book") { Reset(s); s.Flow = "book"; }
            if (hourly || times.Count > 0) s.Mode = "hourly";
            if (roomMatch != null) s.RoomId = roomMatch.Id;
            if (guests is > 0 and < 30) s.Guests = guests;
            else if (s.Step == "guests" && int.TryParse(BareNumberRx().Match(plain).Value, out var bare) && bare is > 0 and < 30) s.Guests = bare;

            if (dates.Count > 0)
            {
                if (s.Mode == "hourly")
                {
                    var d = dates[0];
                    if (times.Count > 0)
                    {
                        var start = d.ToDateTime(times[0]);
                        var end = times.Count > 1 ? d.ToDateTime(times[1]) : start.AddHours(hoursCount ?? 2);
                        s.Start = start.ToString("yyyy-MM-ddTHH:mm");
                        s.End = end.ToString("yyyy-MM-ddTHH:mm");
                    }
                    else { s.Start = d.ToString("yyyy-MM-dd"); s.End = null; }
                }
                else
                {
                    var ci = dates[0];
                    var co = dates.Count > 1 && dates[1] > ci ? dates[1] : ci.AddDays(nights ?? 1);
                    s.Start = ci.ToString("yyyy-MM-dd");
                    s.End = co.ToString("yyyy-MM-dd");
                }
                s.Options.Clear();
            }
            else if (s.Mode == "hourly" && times.Count > 0 && s.Start != null)
            {
                var d = DateOnly.FromDateTime(DateTime.Parse(s.Start, CultureInfo.InvariantCulture));
                var start = d.ToDateTime(times[0]);
                var end = times.Count > 1 ? d.ToDateTime(times[1]) : start.AddHours(hoursCount ?? 2);
                s.Start = start.ToString("yyyy-MM-ddTHH:mm");
                s.End = end.ToString("yyyy-MM-ddTHH:mm");
            }
            else if (nights != null && s.Start != null && s.Mode == "nightly")
                s.End = DateOnly.Parse(s.Start).AddDays(nights.Value).ToString("yyyy-MM-dd");

            // Free-text answers for the current question.
            if (s.Step == "name" && roomMatch == null && dates.Count == 0 && !Yes(plain) && text.Trim().Length is >= 2 and <= 80 && !text.Any(char.IsDigit))
                s.Name = CultureInfo.CurrentCulture.TextInfo.ToTitleCase(text.Trim().ToLower());
            if (phone != null) s.Phone = phone;
            else if (s.Step == "phone" && text.Any(char.IsDigit))
                return L("That doesn't look like a Vietnamese mobile number. Please send it like 0912 345 678.",
                    "Số điện thoại chưa đúng định dạng. Bạn gửi lại giúp mình dạng 0912 345 678 nhé.");
            if (EmailRx().Match(text) is { Success: true } em) { s.Email = em.Value; s.AskedEmail = true; }
            else if (s.Step == "email") s.AskedEmail = true; // "no"/"skip" → no email

            return await NextBookingStep(s, rooms, ct);
        }

        // ---- Rooms / prices ----
        if (RoomsRx().IsMatch(plain))
        {
            var r = await Call("list_rooms", new { guests }, ct);
            return L("Here are our rooms. Tell me your dates and number of guests and I'll check what's free and the exact price.",
                "Đây là các phòng của homestay. Bạn cho mình biết ngày ở và số khách để mình kiểm tra phòng trống và giá chính xác nhé.");
        }

        // ---- Greetings ----
        if (GreetingRx().IsMatch(plain) && plain.Length < 40)
            return L($"Hello! Welcome to {tenant.Name}. Are you looking to book a stay, or do you have a question about an existing booking?",
                $"Chào bạn! Chào mừng bạn đến với {tenant.Name}. Bạn muốn đặt phòng hay cần hỗ trợ về một đặt phòng đã có ạ?");
        if (ThanksRx().IsMatch(plain))
            return L("You're welcome! Let me know if there's anything else I can help with.", "Không có gì ạ! Bạn cần gì thêm cứ nhắn mình nhé.");

        // ---- Policy / FAQ ----
        var p = await Call("search_policy", new { query = text }, ct);
        var doc = JsonDocument.Parse(p.Json).RootElement;
        if (doc.TryGetProperty("faqs", out var faqs) && faqs.GetArrayLength() > 0)
            return faqs[0].GetProperty("answer").GetString()!;
        if (doc.TryGetProperty("results", out var results) && results.GetArrayLength() > 0)
        {
            var hit = results[0];
            return L($"According to our house rules: {hit.GetProperty("text").GetString()}",
                $"Theo nội quy của homestay: {hit.GetProperty("text").GetString()}");
        }

        await Call("handoff_to_human", new { reason = $"Unanswered question: {Trim(text, 160)}" }, ct);
        return L("I'm not sure about that one, so I've asked the host — they'll reply here soon. In the meantime I can check availability or prices for you.",
            "Câu này mình chưa chắc nên đã hỏi chủ nhà, chủ nhà sẽ trả lời bạn sớm nhé. Trong lúc chờ, mình có thể kiểm tra phòng trống hoặc giá cho bạn.");
    }

    private async Task<string> NextBookingStep(BotState s, List<Room> rooms, CancellationToken ct)
    {
        var tenant = _ctx.Tenant;
        if (s.Start == null || s.End == null)
        {
            if (s.Mode == "hourly")
            {
                s.Step = "dates";
                return s.Start == null
                    ? L("Happy to help with an hourly stay. Which day, and from what time to what time? For example: tomorrow 14:00 to 17:00.",
                        "Mình hỗ trợ đặt theo giờ nhé. Bạn muốn ngày nào, từ mấy giờ đến mấy giờ? Ví dụ: ngày mai 14:00 đến 17:00.")
                    : L("What time would you like to start, and for how many hours?", "Bạn muốn bắt đầu lúc mấy giờ và ở mấy tiếng ạ?");
            }
            s.Step = "dates";
            return L("Great! Which dates would you like? For example: 20/12 to 22/12, or \"tomorrow, 2 nights\".",
                "Tuyệt! Bạn muốn ở ngày nào ạ? Ví dụ: 20/12 đến 22/12, hoặc \"ngày mai, 2 đêm\".");
        }
        if (s.Guests == null)
        {
            s.Step = "guests";
            return L("How many guests will be staying?", "Bạn đi mấy người ạ?");
        }
        if (s.RoomId == null || (s.Options.Count > 0 && !s.Options.Contains(s.RoomId.Value)))
        {
            s.RoomId = null;
            var r = await Call("check_availability", new { mode = s.Mode, start = s.Start, end = s.End, guests = s.Guests }, ct);
            if (r.IsError)
            {
                s.Start = s.End = null;
                s.Step = "dates";
                return Error(r) + " " + L("Could you send other dates?", "Bạn gửi giúp mình ngày khác nhé?");
            }
            var avail = JsonDocument.Parse(r.Json).RootElement.GetProperty("available");
            s.Options = avail.EnumerateArray().Select(a => Guid.Parse(a.GetProperty("roomId").GetString()!)).ToList();
            if (s.Options.Count == 0)
            {
                s.Start = s.End = null;
                s.Step = "dates";
                return L("Sorry, nothing is free for those dates and guests. Would you like to try other dates?",
                    "Rất tiếc, không còn phòng phù hợp cho ngày và số khách này. Bạn muốn thử ngày khác không ạ?");
            }
            if (s.Options.Count == 1) s.RoomId = s.Options[0];
            else
            {
                s.Step = "room";
                return L($"Good news — {s.Options.Count} rooms are free. Which one would you like? You can reply with the room name.",
                    $"Tin vui: còn {s.Options.Count} phòng trống. Bạn chọn phòng nào ạ? Bạn có thể trả lời bằng tên phòng.");
            }
        }
        if (s.Name == null)
        {
            s.Step = "name";
            var room = rooms.FirstOrDefault(x => x.Id == s.RoomId);
            return L($"{room?.Name} it is. May I have the full name for the booking?", $"Mình chọn {room?.Name} nhé. Bạn cho mình xin họ tên người đặt phòng?");
        }
        if (s.Phone == null)
        {
            s.Step = "phone";
            return L("Thanks! What's your phone number? We'll use it to find your booking later.", "Cảm ơn bạn! Bạn cho mình số điện thoại để tiện liên hệ và tra cứu đặt phòng nhé.");
        }
        if (!s.AskedEmail)
        {
            s.Step = "email";
            s.AskedEmail = true;
            return L("Would you like a confirmation by email? Send your email, or reply \"skip\".", "Bạn có muốn nhận xác nhận qua email không? Gửi email của bạn, hoặc trả lời \"bỏ qua\".");
        }

        var q = await Call("quote_price", new { roomId = s.RoomId, mode = s.Mode, start = s.Start, end = s.End, guests = s.Guests }, ct);
        if (q.IsError)
        {
            s.RoomId = null;
            s.Options.Clear();
            s.Step = "dates";
            return Error(q);
        }
        var qd = JsonDocument.Parse(q.Json).RootElement;
        if (!qd.GetProperty("available").GetBoolean())
        {
            s.RoomId = null;
            s.Options.Clear();
            return L("That room was just taken. Let me check the others for you — please send your dates again.", "Phòng này vừa có người đặt. Bạn gửi lại ngày để mình tìm phòng khác nhé.");
        }
        s.Step = "confirm";
        var roomName = qd.GetProperty("roomName").GetString();
        var when = s.Mode == "nightly"
            ? $"{Fmt(DateOnly.Parse(s.Start))} → {Fmt(DateOnly.Parse(s.End))}"
            : $"{DateTime.Parse(s.Start, CultureInfo.InvariantCulture):dd/MM HH:mm} → {DateTime.Parse(s.End, CultureInfo.InvariantCulture):HH:mm}";
        return L($"Here's your summary: {roomName}, {when}, {s.Guests} guest(s), {s.Name}, {s.Phone}. Total {Vnd(qd.GetProperty("total").GetDecimal())}, deposit {Vnd(qd.GetProperty("deposit").GetDecimal())}. Confirm?",
            $"Tóm tắt đặt phòng: {roomName}, {when}, {s.Guests} khách, {s.Name}, {s.Phone}. Tổng {Vnd(qd.GetProperty("total").GetDecimal())}, đặt cọc {Vnd(qd.GetProperty("deposit").GetDecimal())}. Bạn xác nhận đặt phòng nhé?");
    }

    private async Task<string> CreateBooking(BotState s, CancellationToken ct)
    {
        var r = await Call("create_booking", new
        {
            roomId = s.RoomId, mode = s.Mode, start = s.Start, end = s.End, guests = s.Guests,
            guestName = s.Name, guestPhone = s.Phone, guestEmail = s.Email,
        }, ct);
        if (r.IsError)
        {
            s.Step = null;
            s.RoomId = null;
            s.Options.Clear();
            return Error(r) + " " + L("Would you like to try other dates?", "Bạn có muốn thử ngày khác không?");
        }
        var d = JsonDocument.Parse(r.Json).RootElement;
        var code = d.GetProperty("code").GetString();
        var phone = s.Phone;
        Reset(s);
        s.Code = code;
        s.CodePhone = phone;
        var holdUntil = d.TryGetProperty("holdExpiresAtLocal", out var h) ? h.GetString() : null;
        return L($"Your booking {code} is on hold until {holdUntil}. Pay the deposit of {Vnd(d.GetProperty("deposit").GetDecimal())} with MoMo below to confirm it.",
            $"Đặt phòng {code} đang được giữ đến {holdUntil}. Bạn thanh toán cọc {Vnd(d.GetProperty("deposit").GetDecimal())} qua MoMo bên dưới để xác nhận nhé.");
    }

    private async Task<string> BookingAction(BotState s, CancellationToken ct)
    {
        s.Step = null;
        var id = new { code = s.Code, phone = s.CodePhone };
        switch (s.Intent)
        {
            case "cancel":
                {
                    var q = await Call("quote_cancellation", id, ct);
                    if (q.IsError) { ForgetIdentityOnNotFound(s, q); return Error(q); }
                    var d = JsonDocument.Parse(q.Json).RootElement;
                    s.Step = "confirm_cancel";
                    var refund = d.GetProperty("refundAmount").GetDecimal();
                    return L($"{d.GetProperty("explanation").GetString()} Refund: {Vnd(refund)}. Do you want to cancel booking {s.Code}?",
                        $"{d.GetProperty("explanation").GetString()} Số tiền hoàn: {Vnd(refund)}. Bạn có chắc muốn hủy đặt phòng {s.Code} không?");
                }
            case "pay":
                {
                    var r = await Call("create_remaining_payment", id, ct);
                    if (r.IsError) { ForgetIdentityOnNotFound(s, r); return Error(r); }
                    var bal = JsonDocument.Parse(r.Json).RootElement.GetProperty("balance").GetDecimal();
                    return bal > 0
                        ? L($"Here's your payment link for the remaining {Vnd(bal)}.", $"Đây là link thanh toán số tiền còn lại {Vnd(bal)}.")
                        : L("You're all paid up — nothing left to pay.", "Bạn đã thanh toán đủ rồi ạ.");
                }
            case "checkout":
                {
                    var r = await Call("request_checkout", id, ct);
                    if (r.IsError) { ForgetIdentityOnNotFound(s, r); return Error(r); }
                    var bal = JsonDocument.Parse(r.Json).RootElement.GetProperty("balance").GetDecimal();
                    return bal > 0
                        ? L($"I've let the host know you're checking out. Please settle the remaining {Vnd(bal)} with the link below.",
                            $"Mình đã báo chủ nhà bạn trả phòng. Bạn vui lòng thanh toán số còn lại {Vnd(bal)} qua link bên dưới nhé.")
                        : L("I've let the host know you're checking out. Thank you for staying with us!", "Mình đã báo chủ nhà bạn trả phòng. Cảm ơn bạn đã ở cùng chúng mình!");
                }
            default:
                {
                    var r = await Call("find_booking", id, ct);
                    if (r.IsError) { ForgetIdentityOnNotFound(s, r); return Error(r); }
                    var d = JsonDocument.Parse(r.Json).RootElement;
                    var status = StatusText(d.GetProperty("status").GetString());
                    return L($"Here's booking {s.Code} ({status}). I can help you change the dates, cancel, or pay the remaining balance.",
                        $"Đây là đặt phòng {s.Code} ({status}). Mình có thể giúp bạn đổi ngày, hủy phòng hoặc thanh toán số tiền còn lại.");
                }
        }
    }

    private string StatusText(string? status) => status switch
    {
        "Hold" => L("waiting for the deposit", "đang chờ đặt cọc"),
        "PendingDeposit" => L("waiting for the deposit", "đang chờ đặt cọc"),
        "Confirmed" => L("confirmed", "đã xác nhận"),
        "CheckedIn" => L("checked in", "đã nhận phòng"),
        "CheckedOut" => L("checked out", "đã trả phòng"),
        "Cancelled" => L("cancelled", "đã hủy"),
        "Expired" => L("expired", "đã hết hạn giữ chỗ"),
        "NoShow" => L("no-show", "không đến"),
        _ => status ?? "",
    };

    private static void ForgetIdentityOnNotFound(BotState s, ToolResult r)
    {
        if (r.Json.Contains("booking_not_found")) { s.Code = null; s.CodePhone = null; s.Flow = null; }
    }

    private async Task<ToolResult> Call(string name, object input, CancellationToken ct)
    {
        var el = JsonSerializer.SerializeToElement(input, Json);
        var r = await tools.ExecuteAsync(_ctx, name, el, ct);
        var msg = new DomainMessage
        {
            ConversationId = _ctx.Conversation.Id, Role = MessageRole.Tool, Content = r.Summary, ToolName = name,
            ToolInputJson = el.GetRawText(), ToolOutputJson = r.Json,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync(ct);
        await realtime.MessageAdded(_ctx.Tenant.Id, _ctx.Conversation.Id, MessageDto.From(msg));
        return r;
    }

    private string Error(ToolResult r)
    {
        var d = JsonDocument.Parse(r.Json).RootElement;
        var msg = d.TryGetProperty("message", out var m) ? m.GetString() : null;
        if (_lang == "vi")
        {
            var code = d.TryGetProperty("error", out var c) ? c.GetString() : null;
            return code switch
            {
                "booking_not_found" => "Mình không tìm thấy đặt phòng với mã và số điện thoại này. Bạn kiểm tra lại giúp mình nhé.",
                "room_unavailable" => "Phòng này vừa có người đặt cho thời gian đó.",
                "too_many_guests" => "Phòng này không đủ chỗ cho số khách đó.",
                "min_hours" => "Thời gian ở theo giờ ngắn hơn mức tối thiểu của phòng.",
                "outside_hours" => "Thời gian này nằm ngoài giờ nhận khách theo giờ.",
                "in_the_past" => "Thời gian này đã qua rồi.",
                "invalid_phone" => "Số điện thoại chưa hợp lệ.",
                _ => msg ?? "Có lỗi xảy ra, bạn thử lại giúp mình nhé.",
            };
        }
        return msg ?? "Something went wrong, please try again.";
    }

    private static string? Str(ToolResult r, string name) =>
        JsonDocument.Parse(r.Json).RootElement.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static void Reset(BotState s)
    {
        s.Flow = null; s.Step = null; s.Intent = null; s.RoomId = null; s.Mode = "nightly"; s.Start = null; s.End = null; s.Guests = null;
        s.Name = null; s.Phone = null; s.Email = null; s.AskedEmail = false; s.Options = [];
    }

    private string Vnd(decimal v) => _lang == "vi"
        ? v.ToString("N0", CultureInfo.GetCultureInfo("vi-VN")) + " ₫"
        : "₫" + v.ToString("N0", CultureInfo.InvariantCulture);

    private string Fmt(DateOnly d) => _lang == "vi" ? d.ToString("dd/MM/yyyy") : d.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

    private static string Trim(string s, int n) => s.Length > n ? s[..n] + "…" : s;

    // ---------------- Parsing ----------------

    public static string Plain(string text)
    {
        var n = text.ToLowerInvariant().Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var c in n)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
    }

    private static bool Yes(string plain) => YesRx().IsMatch(plain);
    private static bool No(string plain) => NoRx().IsMatch(plain);

    public static string? ExtractPhone(string text)
    {
        foreach (Match m in PhoneRx().Matches(text))
            if (Phone.NormalizeVn(m.Value) is { } p) return p;
        return null;
    }

    private static Room? MatchRoom(List<Room> rooms, string plain, BotState s)
    {
        var hit = rooms.Where(r => plain.Contains(Plain(r.Name)) || Regex.IsMatch(plain, $@"\b{Regex.Escape(r.Code.ToLowerInvariant())}\b"))
            .OrderByDescending(r => r.Name.Length).FirstOrDefault();
        if (hit != null) return hit;
        if (s.Step == "room" && s.Options.Count > 0)
        {
            // "the first one", "1", "số 2"
            var ordinals = new Dictionary<string, int> { ["first"] = 0, ["second"] = 1, ["third"] = 2, ["dau tien"] = 0, ["thu hai"] = 1, ["thu ba"] = 2 };
            foreach (var (k, v) in ordinals) if (plain.Contains(k) && v < s.Options.Count) return rooms.FirstOrDefault(r => r.Id == s.Options[v]);
            if (int.TryParse(BareNumberRx().Match(plain).Value, out var n) && n >= 1 && n <= s.Options.Count) return rooms.FirstOrDefault(r => r.Id == s.Options[n - 1]);
            // Partial word match on the remaining options (e.g. "loft", "garden").
            var words = plain.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length >= 4).ToList();
            return rooms.Where(r => s.Options.Contains(r.Id)).FirstOrDefault(r => words.Any(w => Plain(r.Name).Split(' ').Contains(w)));
        }
        return null;
    }

    private static readonly string[] Months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

    public static List<DateOnly> ParseDates(string plain, DateOnly today)
    {
        var found = new List<(int Pos, DateOnly Date)>();
        var consumed = new List<(int, int)>();
        bool Free(Match m) => !consumed.Any(c => m.Index < c.Item2 && c.Item1 < m.Index + m.Length);
        void Add(Match m, int y, int mo, int d, bool explicitYear)
        {
            if (mo is < 1 or > 12 || d < 1 || d > DateTime.DaysInMonth(y, mo)) return;
            var date = new DateOnly(y, mo, d);
            if (!explicitYear && date < today) date = date.AddYears(1);
            found.Add((m.Index, date));
            consumed.Add((m.Index, m.Index + m.Length));
        }

        foreach (Match m in Regex.Matches(plain, @"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"))
            Add(m, int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value), true);
        foreach (Match m in Regex.Matches(plain, @"\bngay\s*(\d{1,2})\s*thang\s*(\d{1,2})(?:\s*nam\s*(\d{4}))?"))
            if (Free(m)) Add(m, m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : today.Year, int.Parse(m.Groups[2].Value), int.Parse(m.Groups[1].Value), m.Groups[3].Success);
        foreach (Match m in Regex.Matches(plain, @"\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b"))
            if (Free(m))
            {
                var y = m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : today.Year;
                if (y < 100) y += 2000;
                Add(m, y, int.Parse(m.Groups[2].Value), int.Parse(m.Groups[1].Value), m.Groups[3].Success);
            }
        foreach (Match m in Regex.Matches(plain, @"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b"))
            if (Free(m)) Add(m, today.Year, Array.IndexOf(Months, m.Groups[2].Value) + 1, int.Parse(m.Groups[1].Value), false);
        foreach (Match m in Regex.Matches(plain, @"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b"))
            if (Free(m)) Add(m, today.Year, Array.IndexOf(Months, m.Groups[1].Value) + 1, int.Parse(m.Groups[2].Value), false);

        void Rel(string pattern, int offset)
        {
            foreach (Match m in Regex.Matches(plain, pattern))
                if (Free(m)) { found.Add((m.Index, today.AddDays(offset))); consumed.Add((m.Index, m.Index + m.Length)); }
        }
        Rel(@"\bday after tomorrow\b|\bngay kia\b|\bngay mot\b", 2);
        Rel(@"\btomorrow\b|\bngay mai\b|\btoi mai\b", 1);
        Rel(@"\btoday\b|\btonight\b|\bhom nay\b|\btoi nay\b", 0);
        foreach (Match m in Regex.Matches(plain, @"\bthis weekend\b|\bcuoi tuan( nay)?\b"))
            if (Free(m))
            {
                var fri = today.AddDays(((int)DayOfWeek.Friday - (int)today.DayOfWeek + 7) % 7);
                found.Add((m.Index, fri));
                found.Add((m.Index + 1, fri.AddDays(2)));
                consumed.Add((m.Index, m.Index + m.Length));
            }
        return found.OrderBy(f => f.Pos).Select(f => f.Date).Distinct().ToList();
    }

    public static List<TimeOnly> ParseTimes(string plain)
    {
        var list = new List<TimeOnly>();
        foreach (Match m in Regex.Matches(plain, @"\b(\d{1,2})(?::(\d{2})|h(\d{2})?|\s*(am|pm))(?!\d)"))
        {
            var h = int.Parse(m.Groups[1].Value);
            var min = m.Groups[2].Success ? int.Parse(m.Groups[2].Value) : m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : 0;
            if (m.Groups[4].Value == "pm" && h < 12) h += 12;
            if (m.Groups[4].Value == "am" && h == 12) h = 0;
            if (h is >= 0 and <= 24 && min is >= 0 and < 60) list.Add(h == 24 ? new TimeOnly(23, 59) : new TimeOnly(h, min));
        }
        return list;
    }

    [GeneratedRegex(@"\b(human|real person|someone real|staff|manager|speak to (the )?(owner|host)|talk to (the )?(owner|host)|nguoi that|gap chu nha|noi chuyen voi chu nha|nhan vien|complain|complaint|angry|terrible|awful|disgusting|scam|lua dao|khieu nai|buc minh|qua te)\b")]
    private static partial Regex HumanRx();
    [GeneratedRegex(@"^\W*(yes|yeah|yep|yup|ok|okay|sure|confirm|confirmed|correct|right|go ahead|book it|dong y|xac nhan|co|u|uh|dung|dung roi|chot|duoc|ok luon|oke)\b")]
    private static partial Regex YesRx();
    [GeneratedRegex(@"^\W*(no|nope|not now|don'?t|khong|thoi|khoi|chua)\b")]
    private static partial Regex NoRx();
    [GeneratedRegex(@"\b[A-Z]{2,4}-[23456789A-Z]{6}\b")]
    private static partial Regex CodeRx();
    [GeneratedRegex(@"(?:\+?84|0)(?:[\s.\-]?\d){8,10}")]
    private static partial Regex PhoneRx();
    [GeneratedRegex(@"[\w.+-]+@[\w-]+\.[\w.]+")]
    private static partial Regex EmailRx();
    [GeneratedRegex(@"\b(cancel|cancellation|huy|refund|hoan tien)\b")]
    private static partial Regex CancelRx();
    [GeneratedRegex(@"\b(pay|payment|balance|remaining|thanh toan|tra tien|chuyen khoan|con lai)\b")]
    private static partial Regex PayRx();
    [GeneratedRegex(@"\b(check ?-?out|tra phong)\b")]
    private static partial Regex CheckoutRx();
    [GeneratedRegex(@"\b(book|booking a|reserve|reservation|availability|available|free room|vacan\w*|stay|dat phong|dat cho|muon dat|con phong|phong trong|con trong|o lai)\b")]
    private static partial Regex BookRx();
    [GeneratedRegex(@"\b(rooms?|prices?|rates?|cost|how much|phong|gia|bao nhieu)\b")]
    private static partial Regex RoomsRx();
    [GeneratedRegex(@"^\W*(hi|hello|hey|hiya|good (morning|afternoon|evening)|chao|xin chao|alo|helo)\b")]
    private static partial Regex GreetingRx();
    [GeneratedRegex(@"\b(thanks|thank you|cam on|thank)\b")]
    private static partial Regex ThanksRx();
    [GeneratedRegex(@"(\d+)\s*(nights?|dem)\b")]
    private static partial Regex NightsRx();
    [GeneratedRegex(@"(?:(\d+)\s*(?:guests?|people|persons?|pax|adults?|nguoi|khach)\b)|(?:\bfor\s+(\d+)\b(?!\s*(?:nights?|hours?|days?)))")]
    private static partial Regex GuestsRx();
    [GeneratedRegex(@"\b(hourly|by the hour|per hour|theo gio|nghi gio|vai tieng|\d+\s*(hours?|tieng))\b")]
    private static partial Regex HourlyRx();
    [GeneratedRegex(@"(\d+)\s*(hours?|tieng|gio)\b")]
    private static partial Regex HoursRx();
    [GeneratedRegex(@"\b\d{1,2}\b")]
    private static partial Regex BareNumberRx();
}
