using System.Buffers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jcs.Net;

namespace WorldCut.Json;

/// <summary>
/// The <c>worldcut-json-v1</c> canonicalization scheme and its SHA-256 digest.
/// </summary>
/// <remarks>
/// <para>
/// <c>worldcut-json-v1</c> is RFC 8785 (JSON Canonicalization Scheme) applied to
/// the accepted WorldCut JSON data domain: object member names are ordered by
/// raw UTF-16 code units, arrays keep their order, numbers use ECMAScript's
/// shortest round-trippable form, negative zero serializes as <c>0</c>, and
/// non-finite numbers and unpaired UTF-16 surrogates are rejected.
/// </para>
/// <para>
/// The RFC 8785 serializer is vendored from Jcs.NET 0.1.1 (MIT). See
/// <c>ports/dotnet/THIRD-PARTY-NOTICES.md</c> for the attribution, the exact
/// modifications, and the WorldCut behaviour layered on top of it.
/// </para>
/// </remarks>
public static class CanonicalJson
{
    private static readonly JsonDocumentOptions DocumentOptions = new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = WorldCutProtocol.MaxCanonicalizationDepth,
    };

    /// <summary>Returns the canonical JSON text for <paramref name="value"/>.</summary>
    /// <param name="value">The value to canonicalize.</param>
    /// <returns>The canonical JSON text.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="value"/> is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">The value cannot be canonicalized.</exception>
    public static string Serialize(JsonValue value)
    {
        ArgumentNullException.ThrowIfNull(value);

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = false }))
        {
            Write(writer, value);
        }

        try
        {
            using JsonDocument document = JsonDocument.Parse(buffer.WrittenMemory, DocumentOptions);
            return JsonCanonicalizer.Canonicalize(document.RootElement);
        }
        catch (JsonException error)
        {
            throw WorldCutException.InvalidInput(
                $"value cannot be canonicalized: {error.Message}",
                error);
        }
    }

    /// <summary>Returns the UTF-8 encoded canonical JSON for <paramref name="value"/>.</summary>
    /// <param name="value">The value to canonicalize.</param>
    /// <returns>The canonical JSON bytes that are hashed to form WorldCut digests.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="value"/> is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">The value cannot be canonicalized.</exception>
    public static byte[] SerializeToUtf8(JsonValue value) =>
        Encoding.UTF8.GetBytes(Serialize(value));

    /// <summary>
    /// Returns the lowercase hexadecimal SHA-256 digest of the canonical form of
    /// <paramref name="value"/>.
    /// </summary>
    /// <param name="value">The value to digest.</param>
    /// <returns>A 64-character lowercase hexadecimal digest.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="value"/> is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">The value cannot be canonicalized.</exception>
    public static string ComputeSha256Hex(JsonValue value)
    {
#pragma warning disable CA1308 // WorldCut digests are specified as lowercase hexadecimal.
        return Convert.ToHexString(SHA256.HashData(SerializeToUtf8(value))).ToLowerInvariant();
#pragma warning restore CA1308
    }

    private static void Write(Utf8JsonWriter writer, JsonValue value)
    {
        switch (value.Kind)
        {
            case JsonKind.Null:
                writer.WriteNullValue();
                break;
            case JsonKind.Boolean:
                writer.WriteBooleanValue(value.GetBoolean());
                break;
            case JsonKind.Number:
                writer.WriteNumberValue(value.GetNumber());
                break;
            case JsonKind.String:
                writer.WriteStringValue(value.GetString());
                break;
            case JsonKind.Array:
                writer.WriteStartArray();
                foreach (JsonValue item in value.Items)
                {
                    Write(writer, item);
                }

                writer.WriteEndArray();
                break;
            case JsonKind.Object:
                writer.WriteStartObject();
                foreach (KeyValuePair<string, JsonValue> member in value.Members)
                {
                    writer.WritePropertyName(member.Key);
                    Write(writer, member.Value);
                }

                writer.WriteEndObject();
                break;
            default:
                throw WorldCutException.InvalidInput($"unsupported JSON kind {value.Kind}");
        }
    }
}
