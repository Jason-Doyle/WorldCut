// -----------------------------------------------------------------------------
// Vendored third-party source. This file is NOT original WorldCut code.
//
// Source:    Jcs.NET 0.1.1 - https://github.com/IsraelIyonsi/Jcs.NET
// Commit:    8aff61685300d5d94b81f05246f95d4681e7178a
// Copyright: Copyright (c) 2026 Israel Iyonsi
// License:   MIT (see the LICENSE file next to this source)
//
// WorldCut modifications are limited to this header and to the changes listed
// in ports/dotnet/THIRD-PARTY-NOTICES.md. Do not edit for style; upstream
// fidelity is deliberate.
// -----------------------------------------------------------------------------
using System.Globalization;
using System.Text;

namespace Jcs.Net;

internal static class EcmaScriptNumberFormatter
{
    private const string Zero = "0";
    private const string ShortestRoundTripFormat = "R";
    private const char DotNetExponentMarker = 'E';
    private const char DecimalPoint = '.';
    private const char ZeroDigit = '0';
    private const char MinusSign = '-';
    private const char PlusSign = '+';
    private const char EcmaScriptExponentMarker = 'e';
    private const int MaxPlainNotationExponent = 21;
    private const int MinPlainNotationExponent = -6;

    internal static string Format(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            throw new JcsException(
                "NaN and Infinity cannot be represented in JSON (RFC 8785 section 3.2.2.3).");
        }

        if (value == 0d)
        {
            return Zero;
        }

        var magnitude = Math.Abs(value);
        var (digits, pointPosition) = DecomposeShortestRoundTrip(magnitude);
        var formatted = ComposeEcmaScriptNotation(digits, pointPosition);
        return value < 0d ? MinusSign + formatted : formatted;
    }

    private static (string Digits, int PointPosition) DecomposeShortestRoundTrip(double magnitude)
    {
        // Depends on the .NET Core 3.0+ runtime contract that "R" yields the
        // shortest round-trippable representation. The ECMAScript re-composition
        // below is only correct for shortest digits; do not change this to "G17".
        var text = magnitude.ToString(ShortestRoundTripFormat, CultureInfo.InvariantCulture);

        var exponent = 0;
        var exponentMarkerIndex = text.IndexOf(DotNetExponentMarker);
        if (exponentMarkerIndex >= 0)
        {
            exponent = int.Parse(text[(exponentMarkerIndex + 1)..], CultureInfo.InvariantCulture);
            text = text[..exponentMarkerIndex];
        }

        var pointIndex = text.IndexOf(DecimalPoint);
        var digits = pointIndex >= 0 ? text.Remove(pointIndex, 1) : text;
        var integerDigitCount = pointIndex >= 0 ? pointIndex : text.Length;

        var leadingZeroCount = digits.Length - digits.TrimStart(ZeroDigit).Length;
        digits = digits.Trim(ZeroDigit);

        var pointPosition = integerDigitCount + exponent - leadingZeroCount;
        return (digits, pointPosition);
    }

    private static string ComposeEcmaScriptNotation(string digits, int pointPosition)
    {
        if (digits.Length <= pointPosition && pointPosition <= MaxPlainNotationExponent)
        {
            return digits + new string(ZeroDigit, pointPosition - digits.Length);
        }

        if (0 < pointPosition && pointPosition <= MaxPlainNotationExponent)
        {
            return digits[..pointPosition] + DecimalPoint + digits[pointPosition..];
        }

        if (MinPlainNotationExponent < pointPosition && pointPosition <= 0)
        {
            return Zero + DecimalPoint + new string(ZeroDigit, -pointPosition) + digits;
        }

        return ComposeExponentialNotation(digits, pointPosition);
    }

    private static string ComposeExponentialNotation(string digits, int pointPosition)
    {
        var builder = new StringBuilder(digits.Length + 8);
        builder.Append(digits[0]);
        if (digits.Length > 1)
        {
            builder.Append(DecimalPoint).Append(digits, 1, digits.Length - 1);
        }

        var exponent = pointPosition - 1;
        builder.Append(EcmaScriptExponentMarker)
               .Append(exponent >= 0 ? PlusSign : MinusSign)
               .Append(Math.Abs(exponent));
        return builder.ToString();
    }
}
