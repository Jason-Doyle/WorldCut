namespace WorldCut.Model;

/// <summary>
/// A normalized ISO-8601 UTC instant of the exact form
/// <c>YYYY-MM-DDTHH:MM:SS.mmmZ</c>.
/// </summary>
/// <remarks>
/// <para>
/// WorldCut deliberately does not use <see cref="DateTime"/> or
/// <see cref="DateTimeOffset"/> here. The reference implementation accepts the
/// full ECMAScript date domain, which includes year <c>0000</c>, while
/// <see cref="DateTime.MinValue"/> starts at year <c>0001</c>. This type parses
/// the literal grammar and keeps both the original text and a proleptic
/// Gregorian millisecond ordinal for comparison.
/// </para>
/// <para>
/// The ordinal is only used for ordering. Emitted timestamps always reuse the
/// original accepted text, so no reformatting can change a digest.
/// </para>
/// </remarks>
public readonly struct NormalizedTimestamp : IEquatable<NormalizedTimestamp>, IComparable<NormalizedTimestamp>
{
    private const int TimestampLength = 24;

    private NormalizedTimestamp(string text, long epochMilliseconds)
    {
        Text = text;
        EpochMilliseconds = epochMilliseconds;
    }

    /// <summary>The exact accepted timestamp text.</summary>
    public string Text { get; }

    /// <summary>Milliseconds relative to 1970-01-01T00:00:00.000Z, proleptic Gregorian.</summary>
    public long EpochMilliseconds { get; }

    /// <summary>Compares two instants for equality.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when both describe the same instant.</returns>
    public static bool operator ==(NormalizedTimestamp left, NormalizedTimestamp right) =>
        left.Equals(right);

    /// <summary>Compares two instants for inequality.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when the instants differ.</returns>
    public static bool operator !=(NormalizedTimestamp left, NormalizedTimestamp right) =>
        !left.Equals(right);

    /// <summary>Reports whether <paramref name="left"/> precedes <paramref name="right"/>.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when <paramref name="left"/> is earlier.</returns>
    public static bool operator <(NormalizedTimestamp left, NormalizedTimestamp right) =>
        left.EpochMilliseconds < right.EpochMilliseconds;

    /// <summary>Reports whether <paramref name="left"/> follows <paramref name="right"/>.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when <paramref name="left"/> is later.</returns>
    public static bool operator >(NormalizedTimestamp left, NormalizedTimestamp right) =>
        left.EpochMilliseconds > right.EpochMilliseconds;

    /// <summary>Reports whether <paramref name="left"/> is not later than <paramref name="right"/>.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when <paramref name="left"/> is earlier or equal.</returns>
    public static bool operator <=(NormalizedTimestamp left, NormalizedTimestamp right) =>
        left.EpochMilliseconds <= right.EpochMilliseconds;

    /// <summary>Reports whether <paramref name="left"/> is not earlier than <paramref name="right"/>.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when <paramref name="left"/> is later or equal.</returns>
    public static bool operator >=(NormalizedTimestamp left, NormalizedTimestamp right) =>
        left.EpochMilliseconds >= right.EpochMilliseconds;

    /// <summary>Parses a normalized ISO-8601 UTC timestamp.</summary>
    /// <param name="text">The candidate timestamp text.</param>
    /// <param name="timestamp">The parsed instant when the text is accepted.</param>
    /// <returns><see langword="true"/> when the text is a normalized timestamp.</returns>
    public static bool TryParse(string? text, out NormalizedTimestamp timestamp)
    {
        timestamp = default;
        if (text is null || text.Length != TimestampLength)
        {
            return false;
        }

        if (text[4] != '-' || text[7] != '-' || text[10] != 'T'
            || text[13] != ':' || text[16] != ':' || text[19] != '.' || text[23] != 'Z')
        {
            return false;
        }

        if (!TryReadDigits(text, 0, 4, out int year)
            || !TryReadDigits(text, 5, 2, out int month)
            || !TryReadDigits(text, 8, 2, out int day)
            || !TryReadDigits(text, 11, 2, out int hour)
            || !TryReadDigits(text, 14, 2, out int minute)
            || !TryReadDigits(text, 17, 2, out int second)
            || !TryReadDigits(text, 20, 3, out int millisecond))
        {
            return false;
        }

        if (month is < 1 or > 12 || day < 1 || day > DaysInMonth(year, month)
            || hour > 23 || minute > 59 || second > 59)
        {
            return false;
        }

        long days = DaysFromCivil(year, month, day);
        long milliseconds = ((((days * 24) + hour) * 60 + minute) * 60 + second) * 1000 + millisecond;
        timestamp = new NormalizedTimestamp(text, milliseconds);
        return true;
    }

    /// <summary>Returns the later of two instants.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns>The later instant, preferring <paramref name="left"/> when equal.</returns>
    public static NormalizedTimestamp Max(NormalizedTimestamp left, NormalizedTimestamp right) =>
        right.EpochMilliseconds > left.EpochMilliseconds ? right : left;

    /// <summary>Returns the earlier of two instants.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns>The earlier instant, preferring <paramref name="left"/> when equal.</returns>
    public static NormalizedTimestamp Min(NormalizedTimestamp left, NormalizedTimestamp right) =>
        right.EpochMilliseconds < left.EpochMilliseconds ? right : left;

    /// <inheritdoc />
    public bool Equals(NormalizedTimestamp other) => EpochMilliseconds == other.EpochMilliseconds;

    /// <inheritdoc />
    public override bool Equals(object? obj) => obj is NormalizedTimestamp other && Equals(other);

    /// <inheritdoc />
    public override int GetHashCode() => EpochMilliseconds.GetHashCode();

    /// <inheritdoc />
    public int CompareTo(NormalizedTimestamp other) =>
        EpochMilliseconds.CompareTo(other.EpochMilliseconds);

    /// <inheritdoc />
    public override string ToString() => Text ?? string.Empty;

    private static bool TryReadDigits(string text, int start, int length, out int value)
    {
        value = 0;
        for (int offset = 0; offset < length; offset++)
        {
            char digit = text[start + offset];
            if (digit is < '0' or > '9')
            {
                return false;
            }

            value = (value * 10) + (digit - '0');
        }

        return true;
    }

    private static bool IsLeapYear(int year) =>
        year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);

    private static int DaysInMonth(int year, int month) => month switch
    {
        2 => IsLeapYear(year) ? 29 : 28,
        4 or 6 or 9 or 11 => 30,
        _ => 31,
    };

    /// <summary>
    /// Converts a proleptic Gregorian civil date to days relative to
    /// 1970-01-01, using Howard Hinnant's era-based algorithm.
    /// </summary>
    /// <remarks>
    /// The era form is used because it stays exact for year <c>0000</c>, which
    /// the ECMAScript date domain accepts and <see cref="DateTime"/> does not.
    /// </remarks>
    private static long DaysFromCivil(int year, int month, int day)
    {
        long shiftedYear = month <= 2 ? year - 1L : year;
        long era = (shiftedYear >= 0 ? shiftedYear : shiftedYear - 399) / 400;
        long yearOfEra = shiftedYear - (era * 400);
        long dayOfYear = ((153 * (month + (month > 2 ? -3 : 9))) + 2) / 5 + day - 1;
        long dayOfEra = (yearOfEra * 365) + (yearOfEra / 4) - (yearOfEra / 100) + dayOfYear;
        return (era * 146097) + dayOfEra - 719468;
    }
}
