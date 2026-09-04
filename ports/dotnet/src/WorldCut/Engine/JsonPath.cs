using System.Diagnostics.CodeAnalysis;
using WorldCut.Json;

namespace WorldCut.Engine;

/// <summary>
/// Resolves a deterministic <c>value_equals</c> path through observed JSON.
/// </summary>
/// <remarks>
/// An array index is <c>0</c> or a non-zero decimal digit followed only by
/// decimal digits. Leading zeroes, signs, fractions, and properties such as
/// <c>length</c> never address an array element.
/// </remarks>
internal static class JsonPath
{
    internal static bool TryResolve(
        JsonValue value,
        IReadOnlyList<string> path,
        [NotNullWhen(true)] out JsonValue? resolved)
    {
        JsonValue current = value;
        foreach (string segment in path)
        {
            switch (current.Kind)
            {
                case JsonKind.Array:
                    if (!TryParseArrayIndex(segment, out long index) || index >= current.Items.Count)
                    {
                        resolved = null;
                        return false;
                    }

                    current = current.Items[(int)index];
                    continue;

                case JsonKind.Object:
                    if (!current.TryGetProperty(segment, out JsonValue? member))
                    {
                        resolved = null;
                        return false;
                    }

                    current = member;
                    continue;

                default:
                    resolved = null;
                    return false;
            }
        }

        resolved = current;
        return true;
    }

    private static bool TryParseArrayIndex(string segment, out long index)
    {
        index = 0;
        if (segment.Length == 0 || segment.Length > 18)
        {
            return false;
        }

        if (segment[0] == '0')
        {
            return segment.Length == 1;
        }

        foreach (char digit in segment)
        {
            if (digit is < '0' or > '9')
            {
                return false;
            }

            index = (index * 10) + (digit - '0');
        }

        return true;
    }
}
