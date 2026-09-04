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

internal static class CanonicalJsonSerializer
{
    private const char BeginObject = '{';
    private const char EndObject = '}';
    private const char BeginArray = '[';
    private const char EndArray = ']';
    private const char NameSeparator = ':';
    private const char ValueSeparator = ',';
    private const string TrueLiteral = "true";
    private const string FalseLiteral = "false";
    private const string NullLiteral = "null";

    // Matches the effective nesting cap the string entry point already enforces:
    // System.Text.Json's JsonDocument default MaxDepth is 64. Guarding the
    // JsonElement path at the same limit keeps both entry points uniform and
    // turns unbounded recursion on hostile input into a catchable JcsException
    // instead of an uncatchable StackOverflowException.
    private const int MaxNestingDepth = 64;

    internal static void Serialize(StringBuilder builder, JsonElement element)
    {
        Serialize(builder, element, depth: 1);
    }

    private static void Serialize(StringBuilder builder, JsonElement element, int depth)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                SerializeObject(builder, element, depth);
                break;
            case JsonValueKind.Array:
                SerializeArray(builder, element, depth);
                break;
            case JsonValueKind.String:
                JsonStringSerializer.Serialize(builder, ReadStringValue(element));
                break;
            case JsonValueKind.Number:
                builder.Append(EcmaScriptNumberFormatter.Format(ToFiniteDouble(element)));
                break;
            case JsonValueKind.True:
                builder.Append(TrueLiteral);
                break;
            case JsonValueKind.False:
                builder.Append(FalseLiteral);
                break;
            case JsonValueKind.Null:
                builder.Append(NullLiteral);
                break;
            default:
                throw new JcsException("An undefined JsonElement cannot be canonicalized.");
        }
    }

    private static void SerializeObject(StringBuilder builder, JsonElement element, int depth)
    {
        RejectExcessiveDepth(depth);

        var properties = new List<(string Name, JsonElement Value)>();
        foreach (var property in element.EnumerateObject())
        {
            properties.Add((ReadPropertyName(property), property.Value));
        }

        properties.Sort(static (left, right) => string.CompareOrdinal(left.Name, right.Name));
        RejectDuplicateNames(properties);

        builder.Append(BeginObject);
        for (var index = 0; index < properties.Count; index++)
        {
            if (index > 0)
            {
                builder.Append(ValueSeparator);
            }

            JsonStringSerializer.Serialize(builder, properties[index].Name);
            builder.Append(NameSeparator);
            Serialize(builder, properties[index].Value, depth + 1);
        }

        builder.Append(EndObject);
    }

    private static void SerializeArray(StringBuilder builder, JsonElement element, int depth)
    {
        RejectExcessiveDepth(depth);

        builder.Append(BeginArray);
        var first = true;
        foreach (var item in element.EnumerateArray())
        {
            if (!first)
            {
                builder.Append(ValueSeparator);
            }

            first = false;
            Serialize(builder, item, depth + 1);
        }

        builder.Append(EndArray);
    }

    private static void RejectExcessiveDepth(int depth)
    {
        if (depth > MaxNestingDepth)
        {
            throw new JcsException(
                $"JSON nesting exceeds the maximum supported depth of {MaxNestingDepth} levels.");
        }
    }

    private static void RejectDuplicateNames(List<(string Name, JsonElement Value)> sortedProperties)
    {
        for (var index = 1; index < sortedProperties.Count; index++)
        {
            if (string.CompareOrdinal(sortedProperties[index - 1].Name, sortedProperties[index].Name) == 0)
            {
                throw new JcsException(
                    $"Duplicate object member name \"{sortedProperties[index].Name}\" violates I-JSON (RFC 8785 section 3.1).");
            }
        }
    }

    private static string ReadStringValue(JsonElement element)
    {
        try
        {
            return element.GetString()!;
        }
        catch (InvalidOperationException exception)
        {
            throw new JcsException(
                "String value contains an unpaired UTF-16 surrogate (RFC 8785 section 3.2.2.2).", exception);
        }
    }

    private static string ReadPropertyName(JsonProperty property)
    {
        try
        {
            return property.Name;
        }
        catch (InvalidOperationException exception)
        {
            throw new JcsException(
                "Property name contains an unpaired UTF-16 surrogate (RFC 8785 section 3.2.2.2).", exception);
        }
    }

    private static double ToFiniteDouble(JsonElement element)
    {
        if (!element.TryGetDouble(out var value) || double.IsNaN(value) || double.IsInfinity(value))
        {
            throw new JcsException(
                $"Number {element.GetRawText()} cannot be represented as an IEEE 754 double (RFC 8785 section 3.1).");
        }

        return value;
    }
}
