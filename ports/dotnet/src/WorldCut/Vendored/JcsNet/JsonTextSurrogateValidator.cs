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
namespace Jcs.Net;

internal static class JsonTextSurrogateValidator
{
    private const char QuotationMark = '"';
    private const char ReverseSolidus = '\\';
    private const char UnicodeEscapeMarker = 'u';
    private const int UnicodeEscapeHexDigits = 4;
    private const int HexRadix = 16;

    private enum PendingHighSurrogate
    {
        None,
        Literal,
        Escaped
    }

    internal static void Validate(string json)
    {
        var index = 0;
        while (index < json.Length)
        {
            var current = json[index];
            if (current == QuotationMark)
            {
                index = ScanString(json, index + 1);
            }
            else if (char.IsHighSurrogate(current)
                && index + 1 < json.Length
                && char.IsLowSurrogate(json[index + 1]))
            {
                index += 2;
            }
            else if (char.IsSurrogate(current))
            {
                throw MalformedJson();
            }
            else
            {
                index++;
            }
        }
    }

    private static int ScanString(string json, int start)
    {
        var index = start;
        var pending = PendingHighSurrogate.None;
        while (index < json.Length)
        {
            var current = json[index];
            if (current == ReverseSolidus)
            {
                if (!TryReadEscape(json, ref index, out var decoded))
                {
                    ValidateRemainderIsWellFormedUtf16(json, index);
                    return json.Length;
                }

                CheckPairing(ref pending, decoded, PendingHighSurrogate.Escaped);
            }
            else if (current == QuotationMark)
            {
                if (pending != PendingHighSurrogate.None)
                {
                    throw UnpairedSurrogate();
                }

                return index + 1;
            }
            else
            {
                CheckPairing(ref pending, current, PendingHighSurrogate.Literal);
                index++;
            }
        }

        return json.Length;
    }

    private static bool TryReadEscape(string json, ref int index, out char decoded)
    {
        decoded = default;
        if (index + 1 >= json.Length)
        {
            return false;
        }

        if (json[index + 1] != UnicodeEscapeMarker)
        {
            decoded = json[index + 1];
            index += 2;
            return true;
        }

        var hexStart = index + 2;
        if (hexStart + UnicodeEscapeHexDigits > json.Length)
        {
            return false;
        }

        var codeUnit = 0;
        for (var offset = 0; offset < UnicodeEscapeHexDigits; offset++)
        {
            var digit = HexDigitValue(json[hexStart + offset]);
            if (digit < 0)
            {
                return false;
            }

            codeUnit = codeUnit * HexRadix + digit;
        }

        decoded = (char)codeUnit;
        index = hexStart + UnicodeEscapeHexDigits;
        return true;
    }

    private static void CheckPairing(
        ref PendingHighSurrogate pending, char codeUnit, PendingHighSurrogate representation)
    {
        if (pending != PendingHighSurrogate.None)
        {
            if (!char.IsLowSurrogate(codeUnit) || pending != representation)
            {
                throw UnpairedSurrogate();
            }

            pending = PendingHighSurrogate.None;
            return;
        }

        if (char.IsHighSurrogate(codeUnit))
        {
            pending = representation;
        }
        else if (char.IsLowSurrogate(codeUnit))
        {
            throw UnpairedSurrogate();
        }
    }

    private static void ValidateRemainderIsWellFormedUtf16(string json, int start)
    {
        var index = start;
        while (index < json.Length)
        {
            var current = json[index];
            if (char.IsHighSurrogate(current)
                && index + 1 < json.Length
                && char.IsLowSurrogate(json[index + 1]))
            {
                index += 2;
            }
            else if (char.IsSurrogate(current))
            {
                throw MalformedJson();
            }
            else
            {
                index++;
            }
        }
    }

    private static int HexDigitValue(char character) => character switch
    {
        >= '0' and <= '9' => character - '0',
        >= 'a' and <= 'f' => character - 'a' + 10,
        >= 'A' and <= 'F' => character - 'A' + 10,
        _ => -1
    };

    private static JcsException UnpairedSurrogate() =>
        new("Unpaired UTF-16 surrogate in string data (RFC 8785 section 3.2.2.2).");

    private static JcsException MalformedJson() =>
        new("Malformed JSON: the text is not well formed UTF-16.");
}
