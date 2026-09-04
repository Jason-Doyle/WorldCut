using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Focused checks on the <c>worldcut-json-v1</c> canonicalization rules that
/// the shared vectors only cover by example.
/// </summary>
public sealed class CanonicalJsonTests
{
    [Fact]
    public void Negative_zero_serializes_as_zero()
    {
        Assert.Equal("0", CanonicalJson.Serialize(JsonValue.Create(-0.0)));
        Assert.Equal("0", CanonicalJson.Serialize(JsonValue.Create(0.0)));
        Assert.Equal(
            CanonicalJson.ComputeSha256Hex(JsonValue.Create(0.0)),
            CanonicalJson.ComputeSha256Hex(JsonValue.Create(-0.0)));
    }

    [Fact]
    public void Negative_zero_is_normalised_on_creation()
    {
        double value = JsonValue.Create(-0.0).GetNumber();

        Assert.False(double.IsNegative(value));
    }

    [Theory]
    [InlineData(0d, "0")]
    [InlineData(1d, "1")]
    [InlineData(-1d, "-1")]
    [InlineData(4.5d, "4.5")]
    [InlineData(0.002d, "0.002")]
    [InlineData(1e30d, "1e+30")]
    [InlineData(1e-27d, "1e-27")]
    [InlineData(1e21d, "1e+21")]
    [InlineData(1e20d, "100000000000000000000")]
    [InlineData(1e-6d, "0.000001")]
    [InlineData(1e-7d, "1e-7")]
    [InlineData(333333333.33333329d, "333333333.3333333")]
    [InlineData(9007199254740991d, "9007199254740991")]
    [InlineData(5e-324d, "5e-324")]
    [InlineData(1.7976931348623157e308d, "1.7976931348623157e+308")]
    public void Numbers_use_the_ecmascript_shortest_round_trip_form(double value, string expected) =>
        Assert.Equal(expected, CanonicalJson.Serialize(JsonValue.Create(value)));

    [Fact]
    public void Object_member_names_sort_by_raw_utf16_code_units()
    {
        JsonValue value = JsonValue.Parse(
            "{\"\\ud83d\\ude00\":1,\"\\u20ac\":2,\"\\u00f6\":3,\"1\":4,\"\\r\":5}");

        Assert.Equal(
            "{\"\\r\":5,\"1\":4,\"\u00f6\":3,\"\u20ac\":2,\"\ud83d\ude00\":1}",
            CanonicalJson.Serialize(value));
    }

    [Fact]
    public void Supplementary_characters_sort_after_the_basic_plane_by_code_unit()
    {
        // U+FFFD is a single code unit above the surrogate range, so it sorts
        // after a supplementary character whose leading code unit is U+D83D.
        JsonValue value = JsonValue.Parse("{\"\\ufffd\":1,\"\\ud83d\\ude00\":2}");

        Assert.Equal("{\"\ud83d\ude00\":2,\"\ufffd\":1}", CanonicalJson.Serialize(value));
    }

    [Fact]
    public void Arrays_keep_their_original_order()
    {
        JsonValue value = JsonValue.Parse("[3,1,2]");

        Assert.Equal("[3,1,2]", CanonicalJson.Serialize(value));
    }

    [Theory]
    [InlineData("\"text\"", "\"text\"")]
    [InlineData("42", "42")]
    [InlineData("true", "true")]
    [InlineData("false", "false")]
    [InlineData("null", "null")]
    public void Top_level_scalars_canonicalize(string json, string expected) =>
        Assert.Equal(expected, CanonicalJson.Serialize(JsonValue.Parse(json)));

    [Fact]
    public void Control_characters_use_lowercase_short_escapes()
    {
        JsonValue value = JsonValue.Create("\u0000\u001f\b\t\n\f\r\"\\/");

        Assert.Equal(
            "\"\\u0000\\u001f\\b\\t\\n\\f\\r\\\"\\\\/\"",
            CanonicalJson.Serialize(value));
    }

    [Fact]
    public void Non_finite_numbers_are_rejected()
    {
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Create(double.NaN)).Code);
        Assert.Throws<WorldCutException>(() => JsonValue.Create(double.PositiveInfinity));
        Assert.Throws<WorldCutException>(() => JsonValue.Create(double.NegativeInfinity));
    }

    [Theory]
    [InlineData("1e400")]
    [InlineData("-1e400")]
    [InlineData("[1e999]")]
    public void Json_numbers_outside_the_binary64_domain_are_rejected(string json) =>
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Parse(json)).Code);

    [Fact]
    public void Underflowing_numbers_parse_as_zero_like_the_reference()
    {
        Assert.Equal("0", CanonicalJson.Serialize(JsonValue.Parse("1e-400")));
    }

    [Fact]
    public void Digest_is_the_sha256_of_the_canonical_utf8_bytes()
    {
        JsonValue value = JsonValue.Parse("{\"b\":1,\"a\":\"\u20ac\"}");

        Assert.Equal(
            Digest.Sha256Hex(CanonicalJson.SerializeToUtf8(value)),
            CanonicalJson.ComputeSha256Hex(value));
        Assert.Equal(64, CanonicalJson.ComputeSha256Hex(value).Length);
    }

    [Fact]
    public void Duplicate_object_members_follow_last_value_wins()
    {
        JsonValue value = JsonValue.Parse("{\"a\":1,\"b\":2,\"a\":3}");

        Assert.Equal("{\"a\":3,\"b\":2}", CanonicalJson.Serialize(value));
    }

    [Fact]
    public void Explicitly_constructed_objects_reject_duplicate_member_names()
    {
        WorldCutException error = Assert.Throws<WorldCutException>(() => JsonValue.CreateObject(
        [
            new("a", JsonValue.Create(1)),
            new("a", JsonValue.Create(2)),
        ]));

        Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
    }

    [Fact]
    public void Canonicalization_accepts_the_documented_maximum_depth()
    {
        string json = new string('[', WorldCutProtocol.MaxCanonicalizationDepth)
            + "0"
            + new string(']', WorldCutProtocol.MaxCanonicalizationDepth);

        JsonValue value = BuildNestedArray(WorldCutProtocol.MaxCanonicalizationDepth);

        Assert.Equal(WorldCutProtocol.MaxCanonicalizationDepth, value.Depth);
        Assert.Equal(json, CanonicalJson.Serialize(value));
    }

    [Fact]
    public void Canonicalization_rejects_one_level_beyond_the_documented_maximum()
    {
        WorldCutException error = Assert.Throws<WorldCutException>(
            () => BuildNestedArray(WorldCutProtocol.MaxCanonicalizationDepth + 1));

        Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
    }

    [Fact]
    public void Serialize_rejects_a_null_argument() =>
        Assert.Throws<ArgumentNullException>(() => CanonicalJson.Serialize(null!));

    private static JsonValue BuildNestedArray(int depth)
    {
        JsonValue value = JsonValue.Create(0);
        for (int level = 0; level < depth; level++)
        {
            value = JsonValue.CreateArray(value);
        }

        return value;
    }
}
