using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// The <c>value_equals</c> path grammar, including the array-index rules that
/// keep <c>length</c> and non-canonical numbers from addressing elements.
/// </summary>
public sealed class ValuePathTests
{
    [Theory]
    [InlineData("[10,20,30]", "0", "10")]
    [InlineData("[10,20,30]", "2", "30")]
    [InlineData("{\"a\":{\"b\":1}}", "a", "{\"b\":1}")]
    [InlineData("{\" \":\"space\"}", " ", "\"space\"")]
    [InlineData("{\"0\":\"zero\"}", "0", "\"zero\"")]
    [InlineData("{\"length\":7}", "length", "7")]
    public void Resolvable_paths_return_the_addressed_value(string document, string segment, string expected)
    {
        JsonValue observed = JsonValue.Parse(document);

        Assert.True(Verify(observed, [segment], JsonValue.Parse(expected)));
    }

    [Theory]
    [InlineData("length")]
    [InlineData("00")]
    [InlineData("01")]
    [InlineData("+1")]
    [InlineData("-1")]
    [InlineData("1.0")]
    [InlineData("1e0")]
    [InlineData(" 1")]
    [InlineData("1 ")]
    [InlineData("0x1")]
    [InlineData("3")]
    [InlineData("99999999999999999999")]
    [InlineData("9007199254740992")]
    public void Non_canonical_array_indexes_never_address_an_element(string segment)
    {
        JsonValue observed = JsonValue.Parse("[10,20,30]");

        Assert.False(Resolves(observed, [segment]));
    }

    [Fact]
    public void Scalars_have_no_addressable_members()
    {
        Assert.False(Resolves(JsonValue.Parse("42"), ["0"]));
        Assert.False(Resolves(JsonValue.Parse("\"text\""), ["0"]));
        Assert.False(Resolves(JsonValue.Parse("null"), ["a"]));
        Assert.False(Resolves(JsonValue.Parse("true"), ["a"]));
    }

    [Fact]
    public void Nested_paths_traverse_objects_and_arrays()
    {
        JsonValue observed = JsonValue.Parse("{\"runs\":[{\"status\":\"passed\"}]}");

        Assert.True(Verify(observed, ["runs", "0", "status"], JsonValue.Create("passed")));
        Assert.False(Resolves(observed, ["runs", "1", "status"]));
        Assert.False(Resolves(observed, ["runs", "0", "missing"]));
    }

    [Fact]
    public void The_array_index_grammar_matches_the_committed_vectors()
    {
        JsonValue index = ConformanceCorpus.Case("verification-vectors.json", "array-index");
        JsonValue length = ConformanceCorpus.Case(
            "verification-vectors.json",
            "array-length-is-not-a-value-path");

        Assert.Equal(
            "CONTRACT_SATISFIED",
            ConformanceCorpus.Member(ConformanceCorpus.Member(index, "expected"), "verdict").GetString());
        Assert.Equal(
            "INSUFFICIENT_EVIDENCE",
            ConformanceCorpus.Member(ConformanceCorpus.Member(length, "expected"), "verdict").GetString());
    }

    private static readonly JsonValue Sentinel =
        JsonValue.Parse("{\"__worldcut_unreachable_sentinel__\":true}");

    private static bool Resolves(JsonValue observed, string[] path) =>
        Evaluate(observed, path, Sentinel).Status != RequirementStatus.Unknown;

    private static bool Verify(JsonValue observed, string[] path, JsonValue expected) =>
        Evaluate(observed, path, expected).Status == RequirementStatus.Satisfied;

    private static RequirementResult Evaluate(JsonValue observed, string[] path, JsonValue expected)
    {
        VerificationResult result = WorldCutVerifier.VerifyJson(
            ValueEqualsInput.Build(observed, path, expected));
        return Assert.Single(result.RequirementResults);
    }
}
