using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Application.Refunds;

public record RefundQuote(
    bool Covered,
    bool RequiresApproval,
    decimal RefundAmount,
    decimal RefundPercent,
    RefundAppliesTo? AppliesTo,
    string? RuleLabel,
    double HoursBeforeCheckIn,
    int? PolicyVersion,
    string Explanation);

public record PolicyWarning(string Code, string Message, int? FromHours, int? ToHours);

/// <summary>Pure refund calculation. Uses only the rules passed in (callers pass the Active policy).</summary>
public static class RefundEngine
{
    public static RefundQuote Quote(RefundPolicy? policy, Booking booking, DateTimeOffset cancelAt, bool noShow = false, string language = "en")
    {
        var vi = GuestText.IsVietnamese(language);
        var culture = GuestText.Culture(language);
        var hours = Math.Round((booking.StartAt - cancelAt).TotalHours, 1);
        if (policy is null || policy.Status != RefundPolicyStatus.Active)
            return new RefundQuote(false, true, 0, 0, null, null, hours, null,
                vi ? "Chưa có quy tắc hủy đang áp dụng. Chủ nhà sẽ xem xét yêu cầu hủy này."
                   : "There are no active cancellation rules yet, so the host will review this cancellation.");

        if (booking.PaidAmount <= 0)
            return new RefundQuote(true, false, 0, 0, null, null, hours, policy.Version,
                vi ? "Đặt phòng này chưa được thanh toán nên không có khoản hoàn tiền."
                   : "Nothing has been paid for this booking, so there is nothing to refund.");

        if (noShow || hours <= 0)
        {
            var pct = policy.NoShowRefundPercent;
            var amt = Math.Min(booking.PaidAmount, Money.RoundThousand(booking.DepositAmount * pct / 100m));
            var percent = pct.ToString("0.#", culture);
            return new RefundQuote(true, false, amt, pct, RefundAppliesTo.Deposit, vi ? "Không đến / từ giờ nhận phòng" : "No-show / after check-in time",
                hours, policy.Version, vi ? $"Hủy từ giờ nhận phòng được tính là không đến. Mức hoàn tiền là {percent}%."
                                           : $"Cancelling at or after the check-in time counts as a no-show: {percent}% refund.");
        }

        var rule = policy.Rules
            .Where(r => hours >= r.MinHoursBeforeCheckIn && (r.MaxHoursBeforeCheckIn == null || hours < r.MaxHoursBeforeCheckIn))
            .OrderByDescending(r => r.MinHoursBeforeCheckIn)
            .FirstOrDefault();

        if (rule is null)
            return new RefundQuote(false, true, 0, 0, null, null, hours, policy.Version,
                vi ? $"Chưa có quy tắc hủy áp dụng cho mốc {hours.ToString("0.#", culture)} giờ trước khi nhận phòng. Chủ nhà sẽ xem xét yêu cầu này."
                   : $"No cancellation rule covers {hours.ToString("0.#", culture)} hours before check-in, so the host will review this request.");

        var baseAmount = rule.AppliesTo == RefundAppliesTo.Deposit ? booking.DepositAmount : booking.TotalAmount;
        var refund = Math.Min(booking.PaidAmount, Money.RoundThousand(baseAmount * rule.RefundPercent / 100m));
        var deposit = rule.AppliesTo == RefundAppliesTo.Deposit;
        var refundPercent = rule.RefundPercent.ToString("0.#", culture);
        var duration = hours >= 48
            ? $"{Math.Floor(hours / 24).ToString(culture)} {(vi ? "ngày" : "days")}"
            : $"{hours.ToString("0.#", culture)} {(vi ? "giờ" : hours == 1 ? "hour" : "hours")}";
        var capped = refund < baseAmount * rule.RefundPercent / 100m;
        var explanation = vi
            ? $"Hủy trước giờ nhận phòng {duration} áp dụng quy tắc \"{rule.Label}\". Bạn được hoàn {refundPercent}% {(deposit ? "tiền cọc" : "tổng giá phòng")}" +
              (capped ? ", tối đa bằng số tiền đã thanh toán." : ".")
            : $"Cancelling {duration} before check-in falls under \"{rule.Label}\": {refundPercent}% of the {(deposit ? "deposit" : "total price")}" +
              (capped ? ", limited to the amount already paid." : ".");
        return new RefundQuote(true, false, refund, rule.RefundPercent, rule.AppliesTo, rule.Label, hours, policy.Version, explanation);
    }

    /// <summary>Finds gaps (uncovered hour ranges) and overlaps between rules.</summary>
    public static IReadOnlyList<PolicyWarning> Analyze(IReadOnlyList<RefundRule> rules)
    {
        var warnings = new List<PolicyWarning>();
        if (rules.Count == 0)
        {
            warnings.Add(new("empty", "Add at least one rule.", null, null));
            return warnings;
        }

        foreach (var r in rules)
        {
            if (r.MaxHoursBeforeCheckIn is { } mx && mx <= r.MinHoursBeforeCheckIn)
                warnings.Add(new("invalid_range", $"\"{r.Label}\" ends before it starts.", r.MinHoursBeforeCheckIn, mx));
            if (r.RefundPercent is < 0 or > 100)
                warnings.Add(new("invalid_percent", $"\"{r.Label}\" must refund between 0% and 100%.", r.MinHoursBeforeCheckIn, r.MaxHoursBeforeCheckIn));
        }

        var sorted = rules.OrderBy(r => r.MinHoursBeforeCheckIn).ToList();
        if (sorted[0].MinHoursBeforeCheckIn > 0)
            warnings.Add(new("gap", $"Cancellations less than {sorted[0].MinHoursBeforeCheckIn} hours before check-in aren't covered.", 0, sorted[0].MinHoursBeforeCheckIn));

        for (var i = 0; i < sorted.Count - 1; i++)
        {
            var cur = sorted[i];
            var next = sorted[i + 1];
            if (cur.MaxHoursBeforeCheckIn is null)
            {
                warnings.Add(new("overlap", $"\"{cur.Label}\" and \"{next.Label}\" overlap.", next.MinHoursBeforeCheckIn, null));
                continue;
            }
            if (cur.MaxHoursBeforeCheckIn < next.MinHoursBeforeCheckIn)
                warnings.Add(new("gap", $"Cancellations between {cur.MaxHoursBeforeCheckIn} and {next.MinHoursBeforeCheckIn} hours before check-in aren't covered.",
                    cur.MaxHoursBeforeCheckIn, next.MinHoursBeforeCheckIn));
            else if (cur.MaxHoursBeforeCheckIn > next.MinHoursBeforeCheckIn)
                warnings.Add(new("overlap", $"\"{cur.Label}\" and \"{next.Label}\" overlap between {next.MinHoursBeforeCheckIn} and {cur.MaxHoursBeforeCheckIn} hours.",
                    next.MinHoursBeforeCheckIn, cur.MaxHoursBeforeCheckIn));
        }

        var last = sorted[^1];
        if (last.MaxHoursBeforeCheckIn is { } lastMax)
            warnings.Add(new("gap", $"Cancellations more than {lastMax} hours before check-in aren't covered.", lastMax, null));

        return warnings;
    }
}
