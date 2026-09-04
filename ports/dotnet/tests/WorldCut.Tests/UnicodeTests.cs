using System.Text;
using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Unicode and transport-encoding rules that protect the digest from silent
/// repair by <see cref="System.Text.Json"/>.
/// </summary>
public sealed class UnicodeTests
{
    [Fact]
    public void Raw_invalid_utf8_is_a_structured_input_error()
    {
        byte[] source = [0x22, 0xC3, 0x28, 0x22];

        WorldCutException error = Assert.Throws<WorldCutException>(() => JsonValue.ParseUtf8(source));

        Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
        Assert.Equal("WORLDCUT_INVALID_INPUT", error.WireCode);
    }

    [Fact]
    public void Cesu8_encoded_surrogates_are_a_structured_input_error()
    {
        byte[] source = [0x22, 0xED, 0xA0, 0xBD, 0xED, 0xB8, 0x80, 0x22];

        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.ParseUtf8(source)).Code);
    }

    [Theory]
    [InlineData("\"\\ud800\"")]
    [InlineData("\"\\udc00\"")]
    [InlineData("\"\\ud800\\ud800\"")]
    [InlineData("\"\\ud800abc\"")]
    [InlineData("{\"\\udfff\":1}")]
    [InlineData("[\"a\",\"\\ud83d\"]")]
    public void Escaped_unpaired_surrogates_are_rejected(string json)
    {
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Parse(json)).Code);
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(
                () => JsonValue.ParseUtf8(Encoding.UTF8.GetBytes(json))).Code);
    }

    [Fact]
    public void Escaped_surrogate_pairs_are_accepted()
    {
        JsonValue value = JsonValue.Parse("\"\\ud83d\\ude00\"");

        Assert.Equal("\ud83d\ude00", value.GetString());
        Assert.Equal("\"\ud83d\ude00\"", CanonicalJson.Serialize(value));
    }

    [Fact]
    public void Raw_unpaired_surrogates_in_a_dotnet_string_are_rejected()
    {
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Create("\ud800")).Code);
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Create("\udc00")).Code);
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Parse("\"\ud800\"")).Code);
    }

    [Fact]
    public void Unpaired_surrogates_in_member_names_are_rejected()
    {
        WorldCutException error = Assert.Throws<WorldCutException>(() => JsonValue.CreateObject(
        [
            new("\ud800", JsonValue.Null),
        ]));

        Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
    }

    [Fact]
    public void An_unpaired_surrogate_never_becomes_a_replacement_character()
    {
        // System.Text.Json substitutes U+FFFD when writing an unpaired
        // surrogate. WorldCut must refuse the value rather than repair it into
        // a different digest.
        string replacement = CanonicalJson.ComputeSha256Hex(JsonValue.Create("\ufffd"));

        Assert.Throws<WorldCutException>(() => JsonValue.Create("\ud800"));
        Assert.NotEqual(replacement, CanonicalJson.ComputeSha256Hex(JsonValue.Create("\ud83d\ude00")));
    }

    [Fact]
    public void A_byte_order_mark_is_not_valid_transport_json()
    {
        byte[] source = [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("{}")];

        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.ParseUtf8(source)).Code);
    }

    [Fact]
    public void More_than_one_json_value_is_rejected()
    {
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Parse("{} {}")).Code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("{")]
    [InlineData("[1,]")]
    [InlineData("// comment\n1")]
    [InlineData("NaN")]
    [InlineData("Infinity")]
    [InlineData("'single'")]
    [InlineData("{a:1}")]
    public void Malformed_json_is_a_structured_input_error(string json) =>
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Parse(json)).Code);

    [Fact]
    public void Excessive_nesting_is_a_structured_input_error_and_never_overflows_the_stack()
    {
        string json = new string('[', 200_000) + new string(']', 200_000);

        WorldCutException error = Assert.Throws<WorldCutException>(
            () => WorldCutVerifier.VerifyJson(json));

        Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
    }

    [Fact]
    public void Parsing_accepts_the_documented_maximum_input_depth()
    {
        string json = new string('[', WorldCutProtocol.MaxJsonDepth)
            + "0"
            + new string(']', WorldCutProtocol.MaxJsonDepth);

        Assert.Equal(WorldCutProtocol.MaxJsonDepth, JsonValue.Parse(json).Depth);
    }

    [Fact]
    public void Parsing_rejects_one_level_beyond_the_documented_maximum_input_depth()
    {
        int depth = WorldCutProtocol.MaxJsonDepth + 1;
        string json = new string('[', depth) + "0" + new string(']', depth);

        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => JsonValue.Parse(json)).Code);
    }

    [Fact]
    public void Non_ascii_content_survives_a_full_verification_round_trip()
    {
        string json = Fixtures.CoherentInput()
            .Replace("ci-status-passed", "ci-status-passed-\ud83d\udc0d", StringComparison.Ordinal);

        VerificationResult result = WorldCutVerifier.VerifyJson(json);

        Assert.Contains(
            result.RequirementResults,
            item => item.RequirementId.Contains('\udc0d', StringComparison.Ordinal));
        Assert.Contains("\ud83d\udc0d", JsonText.Indent(result.ToJson()), StringComparison.Ordinal);
    }
}
