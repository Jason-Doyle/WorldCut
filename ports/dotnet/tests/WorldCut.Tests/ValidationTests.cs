using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Runtime invariants that the JSON Schema cannot express, mutated from a known
/// good fixture so that each test isolates exactly one rule.
/// </summary>
public sealed class ValidationTests
{
    [Fact]
    public void The_reference_fixture_is_accepted()
    {
        VerificationResult result = WorldCutVerifier.VerifyJson(Fixtures.CoherentInput());

        Assert.Equal(ContractVerdict.ContractSatisfied, result.Verdict);
        Assert.Equal("0.1", result.ProtocolVersion);
        Assert.Equal("0.1.2", result.EngineVersion);
        Assert.Equal("worldcut-json-v1", result.Canonicalization);
        Assert.Equal(3, result.Coverage.Required);
        Assert.Equal(3, result.Coverage.Satisfied);
        Assert.Equal(0, result.Coverage.Violated);
        Assert.Equal(0, result.Coverage.Unknown);
        Assert.Equal(0, result.Coverage.Advisory);
        Assert.Equal(AcquisitionPlanStatus.NotNeeded, result.AcquisitionPlan.Status);
    }

    [Theory]
    // Transport shape.
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("null")]
    [InlineData("\"input\"")]
    [InlineData("{}")]
    // Closed field sets.
    [InlineData("{\"protocolVersion\":\"0.1\",\"contract\":{},\"observations\":[],\"extra\":1}")]
    public void Structurally_wrong_documents_are_rejected(string json) =>
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => WorldCutVerifier.VerifyJson(json)).Code);

    [Theory]
    [InlineData("\"protocolVersion\":\"0.1\"", "\"protocolVersion\":\"0.2\"")]
    [InlineData("\"protocolVersion\":\"0.1\"", "\"protocolVersion\":0.1")]
    [InlineData("\"clockModel\":\"trusted_normalized\"", "\"clockModel\":\"untrusted\"")]
    [InlineData("\"intervalModel\":\"half_open\"", "\"intervalModel\":\"closed\"")]
    [InlineData("\"metadataModel\":\"honest_but_possibly_incomplete\"", "\"metadataModel\":\"complete\"")]
    [InlineData("\"provenance\":\"provider_asserted\"", "\"provenance\":\"guessed\"")]
    [InlineData("\"relation\":\"exact\"", "\"relation\":\"compatible\"")]
    [InlineData("\"acquisitionCost\":1", "\"acquisitionCost\":-1")]
    [InlineData("\"acquisitionCost\":1", "\"acquisitionCost\":1.5")]
    [InlineData("\"acquisitionCost\":1", "\"acquisitionCost\":1000000001")]
    [InlineData("\"acquisitionCost\":1", "\"acquisitionCost\":\"1\"")]
    [InlineData("\"acquisitionCost\":1", "\"acquisitionCost\":true")]
    [InlineData("\"acquisitionCost\":1", "\"acquisitionCost\":9007199254740993")]
    [InlineData("\"version\":\"commit-B\"", "\"version\":\"\"")]
    [InlineData("\"id\":\"obs-head-b\"", "\"id\":\"\"")]
    [InlineData("\"role\":\"head\"", "\"role\":\"\"")]
    [InlineData("\"decisionTime\":\"2026-09-02T18:00:00.000Z\"", "\"decisionTime\":\"2026-09-02\"")]
    [InlineData("\"observedAt\":\"2026-09-02T17:59:58.000Z\"", "\"observedAt\":\"2026-09-02T18:00:00.001Z\"")]
    [InlineData("\"type\":\"value_equals\"", "\"type\":\"regex_matches\"")]
    [InlineData("\"type\":\"value_equals\"", "\"type\":7")]
    [InlineData("\"provider\":\"github\"", "\"provider\":\"\"")]
    [InlineData("\"kind\":\"branch_head\"", "\"kind\":null")]
    [InlineData("\"path\":[\"status\"]", "\"path\":[]")]
    [InlineData("\"path\":[\"status\"]", "\"path\":[\"\"]")]
    [InlineData("\"path\":[\"status\"]", "\"path\":\"status\"")]
    [InlineData("\"roles\":[\"approval\",\"quote\"]", "\"roles\":[\"approval\"]")]
    [InlineData("\"roles\":[\"approval\",\"quote\"]", "\"roles\":[\"approval\",\"approval\"]")]
    [InlineData("\"observations\":[", "\"observations\":{\"0\":[")]
    public void Mutating_one_protocol_invariant_is_rejected(string original, string replacement)
    {
        string json = Fixtures.CoherentInput();
        Assert.Contains(original, json, StringComparison.Ordinal);

        WorldCutException error = Assert.Throws<WorldCutException>(
            () => WorldCutVerifier.VerifyJson(ReplaceFirst(json, original, replacement)));

        Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
        Assert.NotEmpty(error.Message);
    }

    [Fact]
    public void An_empty_validity_interval_is_rejected()
    {
        string json = Fixtures.CoherentInput().Replace(
            "\"from\":\"2026-09-02T17:55:00.000Z\",\"until\":\"2026-09-02T18:00:00.001Z\"",
            "\"from\":\"2026-09-02T17:55:00.000Z\",\"until\":\"2026-09-02T17:55:00.000Z\"",
            StringComparison.Ordinal);

        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => WorldCutVerifier.VerifyJson(json)).Code);
    }

    [Fact]
    public void A_contract_of_only_advisory_requirements_is_rejected()
    {
        string json = Fixtures.CoherentInput()
            .Replace("\"type\":\"", "\"required\":false,\"type\":\"", StringComparison.Ordinal);

        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => WorldCutVerifier.VerifyJson(json)).Code);
    }

    [Fact]
    public void A_non_boolean_required_flag_is_rejected()
    {
        string json = ReplaceFirst(
            Fixtures.CoherentInput(),
            "\"type\":\"dependency\"",
            "\"required\":\"yes\",\"type\":\"dependency\"");

        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => WorldCutVerifier.VerifyJson(json)).Code);
    }

    [Fact]
    public void Duplicate_json_members_follow_last_value_wins_during_validation()
    {
        // The trailing member wins, so a leading unsupported protocol version is
        // overwritten by an accepted one, exactly as JSON.parse behaves.
        string json = ReplaceFirst(
            Fixtures.CoherentInput(),
            "{\"protocolVersion\":\"0.1\"",
            "{\"protocolVersion\":\"9.9\",\"protocolVersion\":\"0.1\"");

        VerificationResult result = WorldCutVerifier.VerifyJson(json);

        Assert.Equal(ContractVerdict.ContractSatisfied, result.Verdict);
        Assert.Equal(
            CanonicalJson.Serialize(Fixtures.Expected("coherent")),
            CanonicalJson.Serialize(result.ToJson()));
    }

    [Fact]
    public void Duplicate_members_do_not_trigger_the_rfc8785_duplicate_name_rule()
    {
        string json = ReplaceFirst(
            Fixtures.CoherentInput(),
            "\"value\":{\"commit\":\"commit-B\"}",
            "\"value\":{\"commit\":\"commit-A\",\"commit\":\"commit-B\"}");

        VerificationResult result = WorldCutVerifier.VerifyJson(json);

        Assert.Equal(ContractVerdict.ContractSatisfied, result.Verdict);
    }

    [Theory]
    [InlineData("version")]
    [InlineData("validity")]
    [InlineData("dependencies")]
    public void Optional_witness_members_present_as_null_are_rejected(string member)
    {
        string json = ValueEqualsInput
            .Build(JsonValue.Create("value"), ["ignored"], JsonValue.Create("value"))
            .Replace(
                "\"witness\":{\"provenance\":\"provider_asserted\"}",
                $"\"witness\":{{\"provenance\":\"provider_asserted\",\"{member}\":null}}",
                StringComparison.Ordinal);

        Assert.Contains($"\"{member}\":null", json, StringComparison.Ordinal);
        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => WorldCutVerifier.VerifyJson(json)).Code);
    }

    [Fact]
    public void Advisory_requirements_do_not_change_the_verdict_or_the_plan()
    {
        JsonValue advisory = ConformanceCorpus.Member(
            ConformanceCorpus.Case("verification-vectors.json", "advisory-unknown"),
            "expected");

        Assert.Equal("CONTRACT_SATISFIED", ConformanceCorpus.Member(advisory, "verdict").GetString());
        Assert.Equal(
            1,
            ConformanceCorpus.Member(ConformanceCorpus.Member(advisory, "coverage"), "advisory").GetNumber());
        Assert.Equal(
            "NOT_NEEDED",
            ConformanceCorpus.Member(
                ConformanceCorpus.Member(advisory, "acquisitionPlan"), "status").GetString());
    }

    [Fact]
    public void A_violated_requirement_dominates_an_unknown_one()
    {
        JsonValue expected = ConformanceCorpus.Member(
            ConformanceCorpus.Case("verification-vectors.json", "violation-dominates-unknown"),
            "expected");

        Assert.Equal("CONTRACT_VIOLATED", ConformanceCorpus.Member(expected, "verdict").GetString());
    }

    [Fact]
    public void An_open_ended_validity_interval_is_positive_infinity()
    {
        JsonValue expected = ConformanceCorpus.Member(
            ConformanceCorpus.Case("verification-vectors.json", "open-ended-overlap"),
            "expected");

        Assert.Equal("CONTRACT_SATISFIED", ConformanceCorpus.Member(expected, "verdict").GetString());
    }

    [Fact]
    public void Fetch_required_metadata_costs_a_quarter_rounded_up()
    {
        JsonValue expected = ConformanceCorpus.Member(
            ConformanceCorpus.Case("verification-vectors.json", "missing-dependency"),
            "expected");
        JsonValue plan = ConformanceCorpus.Member(expected, "acquisitionPlan");

        foreach (JsonValue action in ConformanceCorpus.Member(plan, "actions").Items)
        {
            if (string.Equals(
                    ConformanceCorpus.Member(action, "type").GetString(),
                    "FETCH_REQUIRED_METADATA",
                    StringComparison.Ordinal))
            {
                Assert.True(ConformanceCorpus.Member(action, "cost").GetNumber() >= 1);
            }
        }
    }

    [Fact]
    public void Acquisition_action_identifiers_use_the_lowercase_type_role_and_digest()
    {
        VerificationResult result = WorldCutVerifier.VerifyJson(
            Fixtures.InputWithVerdict("INSUFFICIENT_EVIDENCE"));

        Assert.NotEmpty(result.AcquisitionPlan.Actions);
        foreach (AcquisitionAction action in result.AcquisitionPlan.Actions)
        {
            string[] parts = action.Id.Split(':');
            Assert.Equal(3, parts.Length);
#pragma warning disable CA1308 // The protocol specifies a lowercase action-type prefix.
            Assert.Equal(action.Type.ToWireName().ToLowerInvariant(), parts[0]);
#pragma warning restore CA1308
            Assert.Equal(action.Role, parts[1]);
            Assert.Equal(12, parts[2].Length);

            if (action.Expected is null)
            {
                Assert.Equal("none", parts[2]);
            }
            else
            {
                Assert.Equal(CanonicalJson.ComputeSha256Hex(action.Expected)[..12], parts[2]);
            }
        }
    }

    [Fact]
    public void Requirement_results_are_ordered_by_requirement_identifier()
    {
        VerificationResult result = WorldCutVerifier.VerifyJson(Fixtures.CoherentInput());

        var identifiers = result.RequirementResults.Select(item => item.RequirementId).ToArray();
        var sorted = identifiers.ToArray();
        Array.Sort(sorted, Utf16.Compare);

        Assert.Equal(sorted, identifiers);
    }

    private static string ReplaceFirst(string source, string original, string replacement)
    {
        int index = source.IndexOf(original, StringComparison.Ordinal);
        Assert.True(index >= 0, $"{original} is not present in the fixture");
        return string.Concat(source.AsSpan(0, index), replacement, source.AsSpan(index + original.Length));
    }
}
