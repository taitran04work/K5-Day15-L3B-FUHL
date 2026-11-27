namespace Stayra.Domain;

public class InvalidTransitionException(BookingStatus from, BookingStatus to)
    : Exception($"A booking cannot move from {from} to {to}.")
{
    public BookingStatus From { get; } = from;
    public BookingStatus To { get; } = to;
}

public static class BookingStateMachine
{
    private static readonly Dictionary<BookingStatus, BookingStatus[]> Allowed = new()
    {
        [BookingStatus.Hold] = [BookingStatus.PendingDeposit, BookingStatus.Confirmed, BookingStatus.Expired, BookingStatus.Cancelled],
        [BookingStatus.PendingDeposit] = [BookingStatus.Confirmed, BookingStatus.Expired, BookingStatus.Cancelled],
        [BookingStatus.Confirmed] = [BookingStatus.CheckedIn, BookingStatus.Cancelled, BookingStatus.NoShow],
        [BookingStatus.CheckedIn] = [BookingStatus.CheckedOut],
        [BookingStatus.CheckedOut] = [],
        [BookingStatus.Cancelled] = [],
        [BookingStatus.Expired] = [],
        [BookingStatus.NoShow] = [],
    };

    public static readonly BookingStatus[] BlockingStatuses =
        [BookingStatus.Hold, BookingStatus.PendingDeposit, BookingStatus.Confirmed, BookingStatus.CheckedIn];

    public static bool IsBlocking(BookingStatus s) => (int)s <= (int)BookingStatus.CheckedIn;

    public static bool CanTransition(BookingStatus from, BookingStatus to) =>
        Allowed.TryGetValue(from, out var next) && next.Contains(to);

    public static IReadOnlyList<BookingStatus> NextStatuses(BookingStatus from) => Allowed[from];

    public static void EnsureCanTransition(BookingStatus from, BookingStatus to)
    {
        if (!CanTransition(from, to)) throw new InvalidTransitionException(from, to);
    }

    public static bool IsModifiable(BookingStatus s) =>
        s is BookingStatus.Hold or BookingStatus.PendingDeposit or BookingStatus.Confirmed;
}
