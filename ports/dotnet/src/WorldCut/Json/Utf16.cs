namespace WorldCut.Json;

/// <summary>
/// UTF-16 helpers shared by parsing, canonicalization, and protocol ordering.
/// </summary>
/// <remarks>
/// WorldCut orders object members and protocol identifiers by raw UTF-16 code
/// units, which is exactly <see cref="string.CompareOrdinal(string, string)"/>.
/// </remarks>
public static class Utf16
{
    /// <summary>
    /// Compares two strings by raw UTF-16 code units, as the protocol requires.
    /// </summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns>A negative, zero, or positive ordering value.</returns>
    public static int Compare(string? left, string? right) => string.CompareOrdinal(left, right);

    /// <summary>
    /// Returns an ordinal comparer over raw UTF-16 code units.
    /// </summary>
    public static StringComparer Comparer => StringComparer.Ordinal;

    /// <summary>
    /// Returns the index of the first unpaired UTF-16 surrogate code unit.
    /// </summary>
    /// <param name="value">The text to inspect.</param>
    /// <returns>The index of the offending code unit, or <c>-1</c> when the text is well formed.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="value"/> is <see langword="null"/>.</exception>
    public static int IndexOfUnpairedSurrogate(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        for (int index = 0; index < value.Length; index++)
        {
            char current = value[index];
            if (char.IsHighSurrogate(current))
            {
                if (index + 1 >= value.Length || !char.IsLowSurrogate(value[index + 1]))
                {
                    return index;
                }

                index++;
                continue;
            }

            if (char.IsLowSurrogate(current))
            {
                return index;
            }
        }

        return -1;
    }

    internal static void RejectUnpairedSurrogates(string value, string field)
    {
        int index = IndexOfUnpairedSurrogate(value);
        if (index >= 0)
        {
            throw WorldCutException.InvalidInput(
                $"{field} contains an unpaired UTF-16 surrogate U+{(int)value[index]:X4} at index {index}");
        }
    }
}
