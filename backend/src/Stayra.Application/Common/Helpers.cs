using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Stayra.Domain;

namespace Stayra.Application.Common;

public static partial class Phone
{
    [GeneratedRegex(@"^(0|84)(3|5|7|8|9)\d{8}$")]
    private static partial Regex VnMobile();

    /// <summary>Normalizes "+84 912 345 678" / "0912.345.678" to "0912345678". Returns null if not a valid VN mobile number.</summary>
    public static string? NormalizeVn(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var digits = new string(input.Where(char.IsDigit).ToArray());
        if (!VnMobile().IsMatch(digits)) return null;
        return digits.StartsWith("84") ? "0" + digits[2..] : digits;
    }

    public static bool Matches(string? a, string? b)
    {
        var na = NormalizeVn(a) ?? a?.Trim();
        var nb = NormalizeVn(b) ?? b?.Trim();
        return !string.IsNullOrEmpty(na) && na == nb;
    }
}

public static class Money
{
    /// <summary>Round to nearest 1,000 VND.</summary>
    public static decimal RoundThousand(decimal v) => Math.Round(v / 1000m, MidpointRounding.AwayFromZero) * 1000m;
}

public static class BookingCode
{
    // No 0/O/1/I/L to avoid confusion when read over the phone.
    private const string Alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

    public static string New(string prefix = "STR")
    {
        Span<char> chars = stackalloc char[6];
        for (var i = 0; i < chars.Length; i++) chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return $"{prefix}-{new string(chars)}";
    }

    public static string Normalize(string code) => code.Trim().ToUpperInvariant().Replace(" ", "");
}

public static class TenantTime
{
    public static TimeZoneInfo Zone(Tenant t)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(t.TimeZone); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"); }
    }

    public static DateTimeOffset ToUtc(Tenant t, DateOnly date, TimeOnly time)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        var zone = Zone(t);
        return new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }

    public static DateTimeOffset ToUtc(Tenant t, DateTime localUnspecified)
    {
        var local = DateTime.SpecifyKind(localUnspecified, DateTimeKind.Unspecified);
        return new DateTimeOffset(local, Zone(t).GetUtcOffset(local)).ToUniversalTime();
    }

    public static DateTime ToLocal(Tenant t, DateTimeOffset utc) => TimeZoneInfo.ConvertTime(utc, Zone(t)).DateTime;

    public static DateTime Now(Tenant t, TimeProvider clock) => ToLocal(t, clock.GetUtcNow());
}

public static class Slug
{
    public static string From(string text)
    {
        var normalized = text.Normalize(System.Text.NormalizationForm.FormD);
        var sb = new System.Text.StringBuilder();
        foreach (var c in normalized)
        {
            var cat = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c);
            if (cat == System.Globalization.UnicodeCategory.NonSpacingMark) continue;
            var ch = c == 'đ' || c == 'Đ' ? 'd' : char.ToLowerInvariant(c);
            sb.Append(char.IsLetterOrDigit(ch) ? ch : '-');
        }
        return Regex.Replace(sb.ToString(), "-+", "-").Trim('-');
    }
}
