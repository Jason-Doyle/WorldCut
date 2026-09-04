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
using System.Text;

namespace Jcs.Net;

internal static class JsonStringSerializer
{
    private const char QuotationMark = '"';
    private const char ReverseSolidus = '\\';
    private const char Backspace = '\b';
    private const char HorizontalTab = '\t';
    private const char LineFeed = '\n';
    private const char FormFeed = '\f';
    private const char CarriageReturn = '\r';
    private const char ControlRangeEnd = '\u001f';
    private const string LowercaseHexEscapePrefix = "\\u";
    private const string LowercaseFourDigitHexFormat = "x4";

    internal static void Serialize(StringBuilder builder, string value)
    {
        builder.Append(QuotationMark);
        for (var index = 0; index < value.Length; index++)
        {
            var current = value[index];
            if (char.IsHighSurrogate(current))
            {
                var hasLowSurrogate = index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]);
                if (!hasLowSurrogate)
                {
                    throw UnpairedSurrogate(current);
                }

                builder.Append(current).Append(value[index + 1]);
                index++;
                continue;
            }

            if (char.IsLowSurrogate(current))
            {
                throw UnpairedSurrogate(current);
            }

            AppendBasicPlaneCharacter(builder, current);
        }

        builder.Append(QuotationMark);
    }

    private static void AppendBasicPlaneCharacter(StringBuilder builder, char character)
    {
        switch (character)
        {
            case QuotationMark:
            case ReverseSolidus:
                builder.Append(ReverseSolidus).Append(character);
                return;
            case Backspace:
                builder.Append(ReverseSolidus).Append('b');
                return;
            case HorizontalTab:
                builder.Append(ReverseSolidus).Append('t');
                return;
            case LineFeed:
                builder.Append(ReverseSolidus).Append('n');
                return;
            case FormFeed:
                builder.Append(ReverseSolidus).Append('f');
                return;
            case CarriageReturn:
                builder.Append(ReverseSolidus).Append('r');
                return;
            case <= ControlRangeEnd:
                builder.Append(LowercaseHexEscapePrefix)
                       .Append(((int)character).ToString(
                           LowercaseFourDigitHexFormat, System.Globalization.CultureInfo.InvariantCulture));
                return;
            default:
                builder.Append(character);
                return;
        }
    }

    private static JcsException UnpairedSurrogate(char surrogate) =>
        new($"Unpaired UTF-16 surrogate U+{(int)surrogate:X4} in string data (RFC 8785 section 3.2.2.2).");
}
