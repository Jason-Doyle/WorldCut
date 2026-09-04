using System.Collections.ObjectModel;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;

namespace WorldCut.Json;

/// <summary>
/// An immutable, validated JSON value in the WorldCut data domain.
/// </summary>
/// <remarks>
/// <para>
/// A <see cref="JsonValue"/> can only be created through the factory members on
/// this type, so it can never hold data that WorldCut would refuse to
/// canonicalize: numbers are finite, strings contain no unpaired UTF-16
/// surrogate, object member names are unique, and nesting never exceeds
/// <see cref="WorldCutProtocol.MaxCanonicalizationDepth"/>.
/// </para>
/// <para>
/// Numbers use IEEE 754 binary64, matching <c>JSON.parse</c> in the reference
/// implementation. Negative zero is normalised to positive zero on creation.
/// </para>
/// </remarks>
public sealed class JsonValue
{
    /// <summary>
    /// The largest integer magnitude an IEEE 754 binary64 value represents exactly.
    /// </summary>
    public const long MaxSafeInteger = 9_007_199_254_740_991L;

    private static readonly ReadOnlyCollection<JsonValue> EmptyItems =
        new(Array.Empty<JsonValue>());

    private static readonly ReadOnlyCollection<KeyValuePair<string, JsonValue>> EmptyMembers =
        new(Array.Empty<KeyValuePair<string, JsonValue>>());

    private static readonly JsonValue NullValue = new();
    private static readonly JsonValue TrueValue = new(true);
    private static readonly JsonValue FalseValue = new(false);

    private readonly bool _boolean;
    private readonly double _number;
    private readonly string? _text;
    private readonly ReadOnlyCollection<JsonValue>? _items;
    private readonly ReadOnlyCollection<KeyValuePair<string, JsonValue>>? _members;
    private readonly Dictionary<string, int>? _memberIndex;

    private JsonValue()
    {
        Kind = JsonKind.Null;
    }

    private JsonValue(bool value)
    {
        Kind = JsonKind.Boolean;
        _boolean = value;
    }

    private JsonValue(double value)
    {
        Kind = JsonKind.Number;
        _number = value;
    }

    private JsonValue(string value)
    {
        Kind = JsonKind.String;
        _text = value;
    }

    private JsonValue(ReadOnlyCollection<JsonValue> items, int depth)
    {
        Kind = JsonKind.Array;
        _items = items;
        Depth = depth;
    }

    private JsonValue(
        ReadOnlyCollection<KeyValuePair<string, JsonValue>> members,
        Dictionary<string, int> memberIndex,
        int depth)
    {
        Kind = JsonKind.Object;
        _members = members;
        _memberIndex = memberIndex;
        Depth = depth;
    }

    /// <summary>The shape of this value.</summary>
    public JsonKind Kind { get; }

    /// <summary>
    /// The container nesting depth of this value: <c>0</c> for scalars, and one
    /// more than the deepest child for arrays and objects.
    /// </summary>
    public int Depth { get; }

    /// <summary>The shared JSON <c>null</c> value.</summary>
    public static JsonValue Null => NullValue;

    /// <summary>The shared JSON <c>true</c> value.</summary>
    public static JsonValue True => TrueValue;

    /// <summary>The shared JSON <c>false</c> value.</summary>
    public static JsonValue False => FalseValue;

    /// <summary>The shared empty JSON array.</summary>
    public static JsonValue EmptyArray { get; } = new(EmptyItems, 1);

    /// <summary>The shared empty JSON object.</summary>
    public static JsonValue EmptyObject { get; } =
        new(EmptyMembers, new Dictionary<string, int>(StringComparer.Ordinal), 1);

    /// <summary>The array elements, in document order.</summary>
    /// <exception cref="InvalidOperationException">This value is not an array.</exception>
    public IReadOnlyList<JsonValue> Items =>
        _items ?? throw NotOfKind(JsonKind.Array);

    /// <summary>The object members, in the order they were supplied.</summary>
    /// <exception cref="InvalidOperationException">This value is not an object.</exception>
    public IReadOnlyList<KeyValuePair<string, JsonValue>> Members =>
        _members ?? throw NotOfKind(JsonKind.Object);

    /// <summary>Creates a JSON boolean.</summary>
    /// <param name="value">The boolean value.</param>
    /// <returns>The shared <see cref="True"/> or <see cref="False"/> instance.</returns>
    public static JsonValue Create(bool value) => value ? TrueValue : FalseValue;

    /// <summary>Creates a finite JSON number.</summary>
    /// <param name="value">The numeric value.</param>
    /// <returns>The created value, with negative zero normalised to zero.</returns>
    /// <exception cref="WorldCutException"><paramref name="value"/> is not finite.</exception>
    public static JsonValue Create(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            throw WorldCutException.InvalidInput(
                FormattableString.Invariant($"value {value} is not a finite JSON number"));
        }

        return new JsonValue(value == 0d ? 0d : value);
    }

    /// <summary>Creates a JSON number from a safe integer.</summary>
    /// <param name="value">The integer value.</param>
    /// <returns>The created value.</returns>
    /// <exception cref="WorldCutException">
    /// <paramref name="value"/> is outside the IEEE 754 safe-integer domain.
    /// </exception>
    public static JsonValue Create(long value)
    {
        if (Math.Abs(value) > MaxSafeInteger)
        {
            throw WorldCutException.InvalidInput(
                FormattableString.Invariant(
                    $"value {value} is outside the safe JSON integer domain"));
        }

        return new JsonValue((double)value);
    }

    /// <summary>Creates a JSON number from an integer.</summary>
    /// <param name="value">The integer value.</param>
    /// <returns>The created value.</returns>
    public static JsonValue Create(int value) => new(value);

    /// <summary>Creates a JSON string.</summary>
    /// <param name="value">The string value.</param>
    /// <returns>The created value.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="value"/> is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException"><paramref name="value"/> contains an unpaired surrogate.</exception>
    public static JsonValue Create(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        Utf16.RejectUnpairedSurrogates(value, "string value");
        return new JsonValue(value);
    }

    /// <summary>Creates a JSON array.</summary>
    /// <param name="items">The elements, in order.</param>
    /// <returns>The created value.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="items"/> or an element is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">The resulting nesting is too deep.</exception>
    public static JsonValue CreateArray(IEnumerable<JsonValue> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        return CreateArray(items as IReadOnlyList<JsonValue> ?? items.ToArray());
    }

    /// <summary>Creates a JSON array.</summary>
    /// <param name="items">The elements, in order.</param>
    /// <returns>The created value.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="items"/> or an element is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">The resulting nesting is too deep.</exception>
    public static JsonValue CreateArray(params JsonValue[] items)
    {
        ArgumentNullException.ThrowIfNull(items);
        return CreateArray((IReadOnlyList<JsonValue>)items);
    }

    /// <summary>Creates a JSON object.</summary>
    /// <param name="members">The members, in order. Names must be unique.</param>
    /// <returns>The created value.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="members"/> or a member value is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">
    /// A member name repeats, a name contains an unpaired surrogate, or the
    /// resulting nesting is too deep.
    /// </exception>
    public static JsonValue CreateObject(IEnumerable<KeyValuePair<string, JsonValue>> members)
    {
        ArgumentNullException.ThrowIfNull(members);
        return BuildObject(members, allowDuplicateNames: false);
    }

    /// <summary>Parses one JSON document from UTF-16 text.</summary>
    /// <param name="json">The JSON text.</param>
    /// <returns>The parsed value.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="json"/> is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">The text is not a single acceptable JSON document.</exception>
    public static JsonValue Parse(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        return JsonValueReader.Parse(json);
    }

    /// <summary>Parses one JSON document from UTF-8 bytes.</summary>
    /// <param name="utf8Json">The UTF-8 encoded JSON document.</param>
    /// <returns>The parsed value.</returns>
    /// <exception cref="WorldCutException">The bytes are not a single acceptable JSON document.</exception>
    public static JsonValue ParseUtf8(ReadOnlySpan<byte> utf8Json) => JsonValueReader.Parse(utf8Json);

    /// <summary>Reads a JSON boolean.</summary>
    /// <returns>The boolean value.</returns>
    /// <exception cref="InvalidOperationException">This value is not a boolean.</exception>
    public bool GetBoolean() => Kind == JsonKind.Boolean
        ? _boolean
        : throw NotOfKind(JsonKind.Boolean);

    /// <summary>Reads a JSON number.</summary>
    /// <returns>The finite numeric value.</returns>
    /// <exception cref="InvalidOperationException">This value is not a number.</exception>
    public double GetNumber() => Kind == JsonKind.Number
        ? _number
        : throw NotOfKind(JsonKind.Number);

    /// <summary>Reads a JSON string.</summary>
    /// <returns>The string value.</returns>
    /// <exception cref="InvalidOperationException">This value is not a string.</exception>
    public string GetString() => Kind == JsonKind.String
        ? _text!
        : throw NotOfKind(JsonKind.String);

    /// <summary>Looks up an object member by exact name.</summary>
    /// <param name="name">The member name.</param>
    /// <param name="value">The member value when present.</param>
    /// <returns><see langword="true"/> when the member exists.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="name"/> is <see langword="null"/>.</exception>
    public bool TryGetProperty(string name, [NotNullWhen(true)] out JsonValue? value)
    {
        ArgumentNullException.ThrowIfNull(name);

        if (_memberIndex is not null && _memberIndex.TryGetValue(name, out int index))
        {
            value = _members![index].Value;
            return true;
        }

        value = null;
        return false;
    }

    /// <summary>Looks up an object member by exact name.</summary>
    /// <param name="name">The member name.</param>
    /// <returns>The member value.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="name"/> is <see langword="null"/>.</exception>
    /// <exception cref="KeyNotFoundException">The member does not exist.</exception>
    public JsonValue GetProperty(string name) =>
        TryGetProperty(name, out JsonValue? value)
            ? value
            : throw new KeyNotFoundException(
                string.Create(CultureInfo.InvariantCulture, $"The JSON value has no member {name}."));

    /// <summary>Reports whether this value is the JSON <c>null</c> literal.</summary>
    public bool IsNull => Kind == JsonKind.Null;

    /// <summary>Returns the <c>worldcut-json-v1</c> canonical form of this value.</summary>
    /// <returns>The canonical JSON text.</returns>
    public override string ToString() => CanonicalJson.Serialize(this);

    internal static JsonValue CreateObjectLastWins(
        IEnumerable<KeyValuePair<string, JsonValue>> members) =>
        BuildObject(members, allowDuplicateNames: true);

    internal static JsonValue CreateArrayOwned(JsonValue[] items)
    {
        if (items.Length == 0)
        {
            return EmptyArray;
        }

        int depth = 0;
        foreach (JsonValue item in items)
        {
            depth = Math.Max(depth, item.Depth);
        }

        return new JsonValue(new ReadOnlyCollection<JsonValue>(items), RequireDepth(depth + 1));
    }

    private static JsonValue CreateArray(IReadOnlyList<JsonValue> items)
    {
        if (items.Count == 0)
        {
            return EmptyArray;
        }

        var copy = new JsonValue[items.Count];
        for (int index = 0; index < items.Count; index++)
        {
            copy[index] = items[index] ?? throw new ArgumentNullException(
                nameof(items),
                FormattableString.Invariant($"array element {index} is null"));
        }

        return CreateArrayOwned(copy);
    }

    private static JsonValue BuildObject(
        IEnumerable<KeyValuePair<string, JsonValue>> members,
        bool allowDuplicateNames)
    {
        var ordered = new List<KeyValuePair<string, JsonValue>>();
        var index = new Dictionary<string, int>(StringComparer.Ordinal);
        int depth = 0;

        foreach (KeyValuePair<string, JsonValue> member in members)
        {
            string name = member.Key ?? throw new ArgumentNullException(
                nameof(members),
                "object member name is null");
            JsonValue value = member.Value ?? throw new ArgumentNullException(
                nameof(members),
                FormattableString.Invariant($"object member {name} has a null value"));

            Utf16.RejectUnpairedSurrogates(name, "object member name");

            if (index.TryGetValue(name, out int existing))
            {
                if (!allowDuplicateNames)
                {
                    throw WorldCutException.InvalidInput(
                        $"object member {name} is declared more than once");
                }

                ordered[existing] = new KeyValuePair<string, JsonValue>(name, value);
            }
            else
            {
                index.Add(name, ordered.Count);
                ordered.Add(new KeyValuePair<string, JsonValue>(name, value));
            }

            depth = Math.Max(depth, value.Depth);
        }

        if (ordered.Count == 0)
        {
            return EmptyObject;
        }

        return new JsonValue(
            new ReadOnlyCollection<KeyValuePair<string, JsonValue>>(ordered.ToArray()),
            index,
            RequireDepth(depth + 1));
    }

    private static int RequireDepth(int depth)
    {
        if (depth > WorldCutProtocol.MaxCanonicalizationDepth)
        {
            throw WorldCutException.InvalidInput(
                FormattableString.Invariant(
                    $"JSON nesting exceeds the supported depth of {WorldCutProtocol.MaxCanonicalizationDepth} levels"));
        }

        return depth;
    }

    private InvalidOperationException NotOfKind(JsonKind expected) =>
        new(string.Create(
            CultureInfo.InvariantCulture,
            $"The JSON value is {Kind}, not {expected}."));
}
