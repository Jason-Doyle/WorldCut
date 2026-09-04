using System.Text;
using Jcs.Net;

namespace WorldCut.Json;

/// <summary>
/// Renders a <see cref="JsonValue"/> as ordinary JSON text.
/// </summary>
/// <remarks>
/// <para>
/// This is presentation only. Digests always use <see cref="CanonicalJson"/>,
/// never this output. Member order follows the order in which the value was
/// built, rather than the canonical UTF-16 ordinal order.
/// </para>
/// <para>
/// String escaping and number formatting reuse the same RFC 8785 primitives as
/// canonicalization, so non-ASCII characters — including supplementary-plane
/// characters such as emoji — are written literally rather than as
/// <c>\uXXXX</c> escapes.
/// </para>
/// </remarks>
public static class JsonText
{
    private const string Indentation = "  ";

    /// <summary>Renders <paramref name="value"/> with two-space indentation.</summary>
    /// <param name="value">The value to render.</param>
    /// <returns>Indented JSON text.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="value"/> is <see langword="null"/>.</exception>
    public static string Indent(JsonValue value) => Render(value, indented: true);

    /// <summary>Renders <paramref name="value"/> without insignificant whitespace.</summary>
    /// <param name="value">The value to render.</param>
    /// <returns>Compact JSON text.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="value"/> is <see langword="null"/>.</exception>
    public static string Compact(JsonValue value) => Render(value, indented: false);

    private static string Render(JsonValue value, bool indented)
    {
        ArgumentNullException.ThrowIfNull(value);

        var builder = new StringBuilder(256);
        Write(builder, value, indented, depth: 0);
        return builder.ToString();
    }

    private static void Write(StringBuilder builder, JsonValue value, bool indented, int depth)
    {
        switch (value.Kind)
        {
            case JsonKind.Null:
                builder.Append("null");
                break;
            case JsonKind.Boolean:
                builder.Append(value.GetBoolean() ? "true" : "false");
                break;
            case JsonKind.Number:
                builder.Append(EcmaScriptNumberFormatter.Format(value.GetNumber()));
                break;
            case JsonKind.String:
                JsonStringSerializer.Serialize(builder, value.GetString());
                break;
            case JsonKind.Array:
                WriteArray(builder, value, indented, depth);
                break;
            case JsonKind.Object:
                WriteObject(builder, value, indented, depth);
                break;
            default:
                throw WorldCutException.InvalidInput($"unsupported JSON kind {value.Kind}");
        }
    }

    private static void WriteArray(StringBuilder builder, JsonValue value, bool indented, int depth)
    {
        IReadOnlyList<JsonValue> items = value.Items;
        if (items.Count == 0)
        {
            builder.Append("[]");
            return;
        }

        builder.Append('[');
        for (int index = 0; index < items.Count; index++)
        {
            if (index > 0)
            {
                builder.Append(',');
            }

            AppendLineBreak(builder, indented, depth + 1);
            Write(builder, items[index], indented, depth + 1);
        }

        AppendLineBreak(builder, indented, depth);
        builder.Append(']');
    }

    private static void WriteObject(StringBuilder builder, JsonValue value, bool indented, int depth)
    {
        IReadOnlyList<KeyValuePair<string, JsonValue>> members = value.Members;
        if (members.Count == 0)
        {
            builder.Append("{}");
            return;
        }

        builder.Append('{');
        for (int index = 0; index < members.Count; index++)
        {
            if (index > 0)
            {
                builder.Append(',');
            }

            AppendLineBreak(builder, indented, depth + 1);
            JsonStringSerializer.Serialize(builder, members[index].Key);
            builder.Append(':');
            if (indented)
            {
                builder.Append(' ');
            }

            Write(builder, members[index].Value, indented, depth + 1);
        }

        AppendLineBreak(builder, indented, depth);
        builder.Append('}');
    }

    private static void AppendLineBreak(StringBuilder builder, bool indented, int depth)
    {
        if (!indented)
        {
            return;
        }

        builder.Append('\n');
        for (int level = 0; level < depth; level++)
        {
            builder.Append(Indentation);
        }
    }
}
