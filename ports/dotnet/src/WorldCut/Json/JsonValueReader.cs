using System.Buffers;
using System.Text;
using System.Text.Json;

namespace WorldCut.Json;

/// <summary>
/// Reads transport JSON into the immutable <see cref="JsonValue"/> domain.
/// </summary>
/// <remarks>
/// <para>
/// WorldCut owns the pre-validation performed here rather than relying on
/// <see cref="System.Text.Json"/> defaults, because those defaults substitute
/// <c>U+FFFD</c> for unpaired UTF-16 surrogates when writing. Repairing a
/// malformed string would silently change a verification-record digest, so
/// every unpaired surrogate — raw or <c>\uXXXX</c> escaped — is rejected before
/// any value is constructed.
/// </para>
/// <para>
/// Object members follow last-value-wins semantics, matching
/// <c>JSON.parse</c> in the TypeScript reference and the Go and Python ports.
/// </para>
/// </remarks>
internal static class JsonValueReader
{
    private static readonly UTF8Encoding StrictUtf8 = new(
        encoderShouldEmitUTF8Identifier: false,
        throwOnInvalidBytes: true);

    private static readonly JsonReaderOptions ReaderOptions = new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = WorldCutProtocol.MaxJsonDepth,
    };

    internal static JsonValue Parse(string json)
    {
        RejectUnpairedSurrogates(json);
        return ParseValidatedUtf8(StrictUtf8.GetBytes(json));
    }

    internal static JsonValue Parse(ReadOnlySpan<byte> utf8Json)
    {
        string text;
        try
        {
            text = StrictUtf8.GetString(utf8Json);
        }
        catch (DecoderFallbackException error)
        {
            throw WorldCutException.InvalidInput("input is not valid UTF-8", error);
        }

        RejectUnpairedSurrogates(text);
        return ParseValidatedUtf8(utf8Json);
    }

    private static JsonValue ParseValidatedUtf8(ReadOnlySpan<byte> utf8Json)
    {
        try
        {
            var reader = new Utf8JsonReader(utf8Json, ReaderOptions);
            if (!reader.Read())
            {
                throw WorldCutException.InvalidInput("input contains no JSON value");
            }

            JsonValue value = ReadValue(ref reader);
            if (reader.Read())
            {
                throw WorldCutException.InvalidInput("input contains more than one JSON value");
            }

            return value;
        }
        catch (JsonException error)
        {
            throw WorldCutException.InvalidInput($"input is not valid JSON: {error.Message}", error);
        }
        catch (InvalidOperationException error)
        {
            throw WorldCutException.InvalidInput($"input is not valid JSON: {error.Message}", error);
        }
    }

    private static JsonValue ReadValue(ref Utf8JsonReader reader)
    {
        switch (reader.TokenType)
        {
            case JsonTokenType.StartObject:
                return ReadObject(ref reader);
            case JsonTokenType.StartArray:
                return ReadArray(ref reader);
            case JsonTokenType.String:
                return JsonValue.Create(reader.GetString()!);
            case JsonTokenType.Number:
                return ReadNumber(ref reader);
            case JsonTokenType.True:
                return JsonValue.True;
            case JsonTokenType.False:
                return JsonValue.False;
            case JsonTokenType.Null:
                return JsonValue.Null;
            default:
                throw WorldCutException.InvalidInput(
                    $"input contains an unexpected JSON token: {reader.TokenType}");
        }
    }

    private static JsonValue ReadObject(ref Utf8JsonReader reader)
    {
        var members = new List<KeyValuePair<string, JsonValue>>();
        while (true)
        {
            if (!reader.Read())
            {
                throw WorldCutException.InvalidInput("input ends inside a JSON object");
            }

            if (reader.TokenType == JsonTokenType.EndObject)
            {
                return JsonValue.CreateObjectLastWins(members);
            }

            string name = reader.GetString()!;
            if (!reader.Read())
            {
                throw WorldCutException.InvalidInput("input ends after a JSON member name");
            }

            members.Add(new KeyValuePair<string, JsonValue>(name, ReadValue(ref reader)));
        }
    }

    private static JsonValue ReadArray(ref Utf8JsonReader reader)
    {
        var items = new List<JsonValue>();
        while (true)
        {
            if (!reader.Read())
            {
                throw WorldCutException.InvalidInput("input ends inside a JSON array");
            }

            if (reader.TokenType == JsonTokenType.EndArray)
            {
                return items.Count == 0
                    ? JsonValue.EmptyArray
                    : JsonValue.CreateArrayOwned(items.ToArray());
            }

            items.Add(ReadValue(ref reader));
        }
    }

    private static JsonValue ReadNumber(ref Utf8JsonReader reader)
    {
        if (!reader.TryGetDouble(out double value) || !double.IsFinite(value))
        {
            throw WorldCutException.InvalidInput(
                $"input contains a JSON number outside the finite binary64 domain: {ReadRawNumber(ref reader)}");
        }

        return JsonValue.Create(value);
    }

    private static string ReadRawNumber(ref Utf8JsonReader reader)
    {
        ReadOnlySpan<byte> raw = reader.HasValueSequence
            ? reader.ValueSequence.ToArray()
            : reader.ValueSpan;
        return Encoding.UTF8.GetString(raw);
    }

    private static void RejectUnpairedSurrogates(string text)
    {
        int index = 0;
        bool inString = false;

        while (index < text.Length)
        {
            char current = text[index];

            if (!inString)
            {
                if (current == '"')
                {
                    inString = true;
                    index++;
                    continue;
                }

                index += SkipLiteral(text, index);
                continue;
            }

            if (current == '"')
            {
                inString = false;
                index++;
                continue;
            }

            if (current != '\\')
            {
                index += SkipLiteral(text, index);
                continue;
            }

            index++;
            if (index >= text.Length)
            {
                throw WorldCutException.InvalidInput("input ends inside a JSON escape sequence");
            }

            if (text[index] != 'u')
            {
                index++;
                continue;
            }

            int hexStart = index + 1;
            if (hexStart + 4 > text.Length || !TryReadHex4(text, hexStart, out int codeUnit))
            {
                throw WorldCutException.InvalidInput("input contains an incomplete Unicode escape");
            }

            index = hexStart + 4;

            if (codeUnit is >= 0xD800 and <= 0xDBFF)
            {
                if (index + 6 > text.Length
                    || text[index] != '\\'
                    || text[index + 1] != 'u'
                    || !TryReadHex4(text, index + 2, out int lowUnit)
                    || lowUnit is < 0xDC00 or > 0xDFFF)
                {
                    throw WorldCutException.InvalidInput(
                        "input contains an escaped unpaired high surrogate");
                }

                index += 6;
            }
            else if (codeUnit is >= 0xDC00 and <= 0xDFFF)
            {
                throw WorldCutException.InvalidInput(
                    "input contains an escaped unpaired low surrogate");
            }
        }
    }

    private static int SkipLiteral(string text, int index)
    {
        char current = text[index];
        if (char.IsHighSurrogate(current))
        {
            if (index + 1 >= text.Length || !char.IsLowSurrogate(text[index + 1]))
            {
                throw WorldCutException.InvalidInput("input contains an unpaired high surrogate");
            }

            return 2;
        }

        if (char.IsLowSurrogate(current))
        {
            throw WorldCutException.InvalidInput("input contains an unpaired low surrogate");
        }

        return 1;
    }

    private static bool TryReadHex4(string text, int start, out int value)
    {
        value = 0;
        for (int offset = 0; offset < 4; offset++)
        {
            int digit = HexDigit(text[start + offset]);
            if (digit < 0)
            {
                return false;
            }

            value = (value * 16) + digit;
        }

        return true;
    }

    private static int HexDigit(char character) => character switch
    {
        >= '0' and <= '9' => character - '0',
        >= 'a' and <= 'f' => character - 'a' + 10,
        >= 'A' and <= 'F' => character - 'A' + 10,
        _ => -1,
    };
}
