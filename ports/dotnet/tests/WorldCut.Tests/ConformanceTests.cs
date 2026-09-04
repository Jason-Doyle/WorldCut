using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Runs the complete shared conformance corpus from <c>conformance/0.1</c>.
/// </summary>
public sealed class ConformanceTests
{
    public static IEnumerable<TheoryDataRow<string>> VerificationCases() =>
        ConformanceCorpus.CaseNames("verification-vectors.json");

    public static IEnumerable<TheoryDataRow<string>> InvalidCases() =>
        ConformanceCorpus.CaseNames("invalid-vectors.json");

    public static IEnumerable<TheoryDataRow<string>> CanonicalizationCases() =>
        ConformanceCorpus.CaseNames("canonicalization-vectors.json");

    public static IEnumerable<TheoryDataRow<string>> RawCases() =>
        ConformanceCorpus.CaseNames("raw-vectors.json");

    [Theory]
    [MemberData(nameof(VerificationCases))]
    public void Verification_vector_produces_the_exact_golden_result(string name)
    {
        JsonValue vector = ConformanceCorpus.Case("verification-vectors.json", name);
        JsonValue input = ConformanceCorpus.Member(vector, "input");
        JsonValue expected = ConformanceCorpus.Member(vector, "expected");

        VerificationResult result = WorldCutVerifier.VerifyJsonUtf8(ConformanceCorpus.Utf8(input));

        Assert.Equal(CanonicalJson.Serialize(expected), CanonicalJson.Serialize(result.ToJson()));
        Assert.Equal(
            ConformanceCorpus.Member(expected, "verificationRecordDigest").GetString(),
            result.VerificationRecordDigest);
    }

    [Theory]
    [MemberData(nameof(VerificationCases))]
    public void Verification_vector_is_independent_of_input_member_and_array_order(string name)
    {
        JsonValue vector = ConformanceCorpus.Case("verification-vectors.json", name);
        JsonValue expected = ConformanceCorpus.Member(vector, "expected");
        JsonValue reordered = JsonReorder.Reverse(ConformanceCorpus.Member(vector, "input"));

        VerificationResult result = WorldCutVerifier.VerifyJsonUtf8(ConformanceCorpus.Utf8(reordered));

        Assert.Equal(CanonicalJson.Serialize(expected), CanonicalJson.Serialize(result.ToJson()));
    }

    [Theory]
    [MemberData(nameof(InvalidCases))]
    public void Invalid_vector_produces_the_exact_error_code(string name)
    {
        JsonValue vector = ConformanceCorpus.Case("invalid-vectors.json", name);
        JsonValue input = ConformanceCorpus.Member(vector, "input");
        string expectedCode = ConformanceCorpus.Member(vector, "expectedErrorCode").GetString();

        WorldCutException error = Assert.Throws<WorldCutException>(
            () => WorldCutVerifier.VerifyJsonUtf8(ConformanceCorpus.Utf8(input)));

        Assert.Equal(expectedCode, error.WireCode);
    }

    [Theory]
    [MemberData(nameof(CanonicalizationCases))]
    public void Canonicalization_vector_produces_the_exact_bytes_and_digest(string name)
    {
        JsonValue vector = ConformanceCorpus.Case("canonicalization-vectors.json", name);
        JsonValue value = ConformanceCorpus.Member(vector, "value");

        Assert.Equal(
            ConformanceCorpus.Member(vector, "expectedCanonicalJson").GetString(),
            CanonicalJson.Serialize(value));
        Assert.Equal(
            ConformanceCorpus.Member(vector, "expectedSha256").GetString(),
            CanonicalJson.ComputeSha256Hex(value));
    }

    [Theory]
    [MemberData(nameof(RawCases))]
    public void Raw_vector_is_rejected_with_an_accepted_outcome(string name)
    {
        JsonValue vector = ConformanceCorpus.Case("raw-vectors.json", name);
        byte[] source = ConformanceCorpus.ReadBytes(ConformanceCorpus.Member(vector, "file").GetString());

        Assert.Equal(
            ConformanceCorpus.Member(vector, "sha256").GetString(),
            Digest.Sha256Hex(source));

        WorldCutException error = Assert.Throws<WorldCutException>(
            () => WorldCutVerifier.VerifyJsonUtf8(source));

        var accepted = ConformanceCorpus.Member(vector, "acceptedOutcomes").Items
            .Select(item => item.GetString())
            .ToArray();
        Assert.Contains(error.WireCode, accepted);
    }

    [Fact]
    public void Manifest_hashes_and_counts_match_the_mirrored_corpus()
    {
        JsonValue manifest = ConformanceCorpus.ReadVectorFile("manifest.json");

        Assert.Equal(
            WorldCutProtocol.ProtocolVersion,
            ConformanceCorpus.Member(manifest, "protocolVersion").GetString());
        Assert.Equal(
            WorldCutProtocol.EngineVersion,
            ConformanceCorpus.Member(manifest, "engineVersion").GetString());
        Assert.Equal(
            WorldCutProtocol.Canonicalization,
            ConformanceCorpus.Member(manifest, "canonicalization").GetString());

        JsonValue files = ConformanceCorpus.Member(manifest, "files");
        Assert.NotEmpty(files.Members);

        foreach (KeyValuePair<string, JsonValue> entry in files.Members)
        {
            byte[] source = ConformanceCorpus.ReadBytes(entry.Key);

            Assert.Equal(
                ConformanceCorpus.Member(entry.Value, "sha256").GetString(),
                Digest.Sha256Hex(source));

            if (entry.Value.TryGetProperty("cases", out JsonValue? cases))
            {
                Assert.Equal((int)cases.GetNumber(), ConformanceCorpus.Cases(entry.Key).Count);
            }

            if (entry.Value.TryGetProperty("bytes", out JsonValue? bytes))
            {
                Assert.Equal((int)bytes.GetNumber(), source.Length);
            }
        }
    }

    [Fact]
    public void Reordered_equivalent_input_keeps_the_same_verification_record_digest()
    {
        JsonValue coherent = ConformanceCorpus.Case("verification-vectors.json", "coherent");
        JsonValue reversed = ConformanceCorpus.Case("verification-vectors.json", "reversed-ordering");

        Assert.Equal(
            ConformanceCorpus.Member(
                ConformanceCorpus.Member(coherent, "expected"), "verificationRecordDigest").GetString(),
            ConformanceCorpus.Member(
                ConformanceCorpus.Member(reversed, "expected"), "verificationRecordDigest").GetString());
    }
}
