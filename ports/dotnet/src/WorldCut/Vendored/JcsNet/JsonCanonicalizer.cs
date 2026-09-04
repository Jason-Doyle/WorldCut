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
using System.Text.Json;

namespace Jcs.Net;

/// <summary>
/// Canonicalizes JSON per RFC 8785 (JSON Canonicalization Scheme) so that
/// equivalent documents always serialize to the same byte sequence.
/// </summary>
internal static class JsonCanonicalizer
{
    private const int DefaultBuilderCapacity = 256;

    /// <summary>Canonicalizes a JSON text.</summary>
    /// <param name="json">The JSON text to canonicalize.</param>
    /// <returns>The canonical form as a string.</returns>
    /// <exception cref="ArgumentNullException">When <paramref name="json"/> is null.</exception>
    /// <exception cref="JsonException">When the input is not valid RFC 8785 input.</exception>
    public static string Canonicalize(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        JsonTextSurrogateValidator.Validate(json);
        using var document = JsonDocument.Parse(json);
        return Canonicalize(document.RootElement);
    }

    /// <summary>Canonicalizes a parsed <see cref="JsonElement"/>.</summary>
    /// <param name="element">The element to canonicalize.</param>
    /// <returns>The canonical form as a string.</returns>
    /// <exception cref="JsonException">When the element is not valid RFC 8785 input.</exception>
    public static string Canonicalize(JsonElement element)
    {
        var builder = new StringBuilder(DefaultBuilderCapacity);
        CanonicalJsonSerializer.Serialize(builder, element);
        return builder.ToString();
    }

    /// <summary>Canonicalizes a JSON text and encodes the result as UTF-8.</summary>
    /// <param name="json">The JSON text to canonicalize.</param>
    /// <returns>The canonical form as UTF-8 bytes, suitable for hashing or signing.</returns>
    /// <exception cref="ArgumentNullException">When <paramref name="json"/> is null.</exception>
    /// <exception cref="JsonException">When the input is not valid RFC 8785 input.</exception>
    public static byte[] CanonicalizeToUtf8(string json)
    {
        return Encoding.UTF8.GetBytes(Canonicalize(json));
    }

    /// <summary>Canonicalizes a parsed <see cref="JsonElement"/> and encodes the result as UTF-8.</summary>
    /// <param name="element">The element to canonicalize.</param>
    /// <returns>The canonical form as UTF-8 bytes, suitable for hashing or signing.</returns>
    /// <exception cref="JsonException">When the element is not valid RFC 8785 input.</exception>
    public static byte[] CanonicalizeToUtf8(JsonElement element)
    {
        return Encoding.UTF8.GetBytes(Canonicalize(element));
    }

    /// <summary>Attempts to canonicalize a JSON text without throwing.</summary>
    /// <param name="json">The JSON text to canonicalize.</param>
    /// <param name="canonical">The canonical form, or null when the input is invalid.</param>
    /// <returns>True when canonicalization succeeded; false for any invalid input, including null.</returns>
    public static bool TryCanonicalize(string? json, out string? canonical)
    {
        canonical = null;
        if (json is null)
        {
            return false;
        }

        try
        {
            canonical = Canonicalize(json);
            return true;
        }
        catch (JsonException)
        {
            // Invariant: every failure in the pipeline is JsonException-derived.
            // The validator and serializer throw JcsException (including translations
            // of the reader's InvalidOperationException) and the parser throws
            // JsonException. Preserve that invariant or this method loses its
            // no-throw guarantee.
            return false;
        }
    }
}
