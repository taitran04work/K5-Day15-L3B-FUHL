using System.Globalization;
using Stayra.Domain;

namespace Stayra.Application.Common;

public static class GuestText
{
    public static bool IsVietnamese(string? language) => language == "vi";

    public static CultureInfo Culture(string? language) =>
        CultureInfo.GetCultureInfo(IsVietnamese(language) ? "vi-VN" : "en-US");

    public static string Amount(decimal amount, string? language)
    {
        var number = amount.ToString("N0", Culture(language));
        return IsVietnamese(language) ? $"{number} ₫" : $"₫{number}";
    }

    public static string Status(BookingStatus status, string? language) => (IsVietnamese(language), status) switch
    {
        (true, BookingStatus.Hold) => "đang giữ chỗ",
        (true, BookingStatus.PendingDeposit) => "chờ đặt cọc",
        (true, BookingStatus.Confirmed) => "đã xác nhận",
        (true, BookingStatus.CheckedIn) => "đã nhận phòng",
        (true, BookingStatus.CheckedOut) => "đã trả phòng",
        (true, BookingStatus.Cancelled) => "đã hủy",
        (true, BookingStatus.Expired) => "đã hết hạn",
        (true, BookingStatus.NoShow) => "không đến",
        (false, BookingStatus.Hold) => "on hold",
        (false, BookingStatus.PendingDeposit) => "awaiting deposit",
        (false, BookingStatus.Confirmed) => "confirmed",
        (false, BookingStatus.CheckedIn) => "checked in",
        (false, BookingStatus.CheckedOut) => "checked out",
        (false, BookingStatus.Cancelled) => "cancelled",
        (false, BookingStatus.Expired) => "expired",
        _ => "no-show",
    };
}
