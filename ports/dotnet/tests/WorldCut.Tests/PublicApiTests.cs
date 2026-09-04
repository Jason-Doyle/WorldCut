using System.Collections;
using System.Collections.ObjectModel;
using System.Reflection;
using WorldCut.Json;
using WorldCut.Model;

namespace WorldCut.Tests;

/// <summary>
/// The public contract: stable versions, structured errors, and results that
/// cannot be mutated into a different later verification.
/// </summary>
public sealed class PublicApiTests
{
    [Fact]
    public void Protocol_identifiers_are_stable()
    {
        Assert.Equal("0.1", WorldCutProtocol.ProtocolVersion);
        Assert.Equal("0.1.2", WorldCutProtocol.EngineVersion);
        Assert.Equal("worldcut-json-v1", WorldCutProtocol.Canonicalization);
        Assert.Equal(1_000_000_000L, WorldCutProtocol.MaxAcquisitionCost);
        Assert.Equal(64_000_000_000L, WorldCutProtocol.MaxPlanTotalCost);
        Assert.Equal(64, WorldCutProtocol.MaxUnresolvedRequirements);
        Assert.Equal(65_536, WorldCutProtocol.MaxOptionCombinations);
        Assert.Equal(4_259_840, WorldCutProtocol.MaxSearchStates);
    }

    [Fact]
    public void The_package_version_matches_the_released_port_version()
    {
        var version = typeof(WorldCutVerifier).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()!
            .InformationalVersion;

        Assert.StartsWith("0.1.0", version, StringComparison.Ordinal);
    }

    [Fact]
    public void Error_codes_round_trip_to_their_wire_spelling()
    {
        Assert.Equal("WORLDCUT_INVALID_INPUT", WorldCutErrorCode.InvalidInput.ToWireCode());
        Assert.Equal("WORLDCUT_INVALID_ARGUMENT", WorldCutErrorCode.InvalidArgument.ToWireCode());
        Assert.Equal("WORLDCUT_FILE_READ_FAILED", WorldCutErrorCode.FileReadFailed.ToWireCode());
        Assert.Equal("WORLDCUT_RUNTIME_ERROR", WorldCutErrorCode.RuntimeError.ToWireCode());
        Assert.Throws<ArgumentOutOfRangeException>(() => ((WorldCutErrorCode)99).ToWireCode());
    }

    [Fact]
    public void Result_names_use_the_protocol_spelling()
    {
        Assert.Equal("SATISFIED", RequirementStatus.Satisfied.ToWireName());
        Assert.Equal("VIOLATED", RequirementStatus.Violated.ToWireName());
        Assert.Equal("UNKNOWN", RequirementStatus.Unknown.ToWireName());
        Assert.Equal("CONTRACT_SATISFIED", ContractVerdict.ContractSatisfied.ToWireName());
        Assert.Equal("CONTRACT_VIOLATED", ContractVerdict.ContractViolated.ToWireName());
        Assert.Equal("INSUFFICIENT_EVIDENCE", ContractVerdict.InsufficientEvidence.ToWireName());
        Assert.Equal("REFRESH_OBSERVATION", AcquisitionActionType.RefreshObservation.ToWireName());
        Assert.Equal("FETCH_REQUIRED_METADATA", AcquisitionActionType.FetchRequiredMetadata.ToWireName());
        Assert.Equal("ACQUIRE_COMPATIBLE_EVIDENCE", AcquisitionActionType.AcquireCompatibleEvidence.ToWireName());
        Assert.Equal("NOT_NEEDED", AcquisitionPlanStatus.NotNeeded.ToWireName());
        Assert.Equal("AVAILABLE", AcquisitionPlanStatus.Available.ToWireName());
        Assert.Equal("INCOMPLETE", AcquisitionPlanStatus.Incomplete.ToWireName());
    }

    [Fact]
    public void Parsed_input_has_no_public_constructor()
    {
        Assert.Empty(typeof(ParsedVerificationInput).GetConstructors(BindingFlags.Public | BindingFlags.Instance));
        Assert.Empty(typeof(VerificationResult).GetConstructors(BindingFlags.Public | BindingFlags.Instance));
        Assert.Empty(typeof(RequirementResult).GetConstructors(BindingFlags.Public | BindingFlags.Instance));
        Assert.Empty(typeof(AcquisitionPlan).GetConstructors(BindingFlags.Public | BindingFlags.Instance));
        Assert.Empty(typeof(Observation).GetConstructors(BindingFlags.Public | BindingFlags.Instance));
    }

    [Fact]
    public void Every_public_property_on_the_result_graph_is_read_only()
    {
        Type[] resultTypes =
        [
            typeof(VerificationResult),
            typeof(VerificationCoverage),
            typeof(RequirementResult),
            typeof(AcquisitionPlan),
            typeof(AcquisitionOption),
            typeof(AcquisitionAction),
            typeof(ParsedVerificationInput),
            typeof(DecisionContract),
            typeof(Observation),
            typeof(ObservationWitness),
            typeof(DependencyWitness),
            typeof(ValidityInterval),
            typeof(ResourceIdentity),
            typeof(JsonValue),
        ];

        foreach (Type type in resultTypes)
        {
            Assert.Empty(type.GetFields(BindingFlags.Public | BindingFlags.Instance));

            foreach (PropertyInfo property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                Assert.False(
                    property.CanWrite,
                    $"{type.Name}.{property.Name} must not be writable");
            }
        }
    }

    [Fact]
    public void Result_collections_are_not_mutable_aliases()
    {
        VerificationResult result = WorldCutVerifier.VerifyJson(
            Fixtures.InputWithVerdict("CONTRACT_VIOLATED"));

        AssertReadOnly(result.RequirementResults);
        AssertReadOnly(result.AcquisitionPlan.Actions);
        AssertReadOnly(result.AcquisitionPlan.SelectedOptionIds);
        AssertReadOnly(result.AcquisitionPlan.CoveredRequirementIds);
        AssertReadOnly(result.AcquisitionPlan.UnresolvedRequirementIds);

        foreach (RequirementResult requirement in result.RequirementResults)
        {
            AssertReadOnly(requirement.AcquisitionOptions);
            foreach (AcquisitionOption option in requirement.AcquisitionOptions)
            {
                AssertReadOnly(option.Actions);
            }
        }
    }

    [Fact]
    public void Json_value_collections_are_not_mutable_aliases()
    {
        JsonValue value = JsonValue.Parse("{\"a\":[1,2,3]}");

        AssertReadOnly(value.Members);
        AssertReadOnly(value.GetProperty("a").Items);
    }

    [Fact]
    public void A_parsed_input_can_be_verified_repeatedly_with_identical_results()
    {
        ParsedVerificationInput input = ParsedVerificationInput.Parse(Fixtures.CoherentInput());

        VerificationResult first = WorldCutVerifier.Verify(input);
        VerificationResult second = WorldCutVerifier.Verify(input);

        Assert.NotSame(first, second);
        Assert.Equal(first.VerificationRecordDigest, second.VerificationRecordDigest);
        Assert.Equal(
            CanonicalJson.Serialize(first.ToJson()),
            CanonicalJson.Serialize(second.ToJson()));
        Assert.Equal(
            CanonicalJson.Serialize(Fixtures.Expected("coherent")),
            CanonicalJson.Serialize(second.ToJson()));
    }

    [Fact]
    public void A_result_json_projection_is_a_fresh_immutable_value()
    {
        VerificationResult result = WorldCutVerifier.VerifyJson(Fixtures.CoherentInput());

        JsonValue first = result.ToJson();
        JsonValue second = result.ToJson();

        Assert.NotSame(first, second);
        Assert.Equal(CanonicalJson.Serialize(first), CanonicalJson.Serialize(second));
    }

    [Fact]
    public void Parsed_input_exposes_the_validated_snapshot()
    {
        ParsedVerificationInput input = ParsedVerificationInput.Parse(Fixtures.CoherentInput());

        Assert.Equal("0.1", input.ProtocolVersion);
        Assert.Equal("deploy-current-tested-release", input.Contract.Id);
        Assert.Equal("1", input.Contract.Version);
        Assert.Equal("2026-09-02T18:00:00.000Z", input.Contract.DecisionTime.Text);
        Assert.Equal(4, input.Observations.Count);
        Assert.Equal(3, input.Contract.Requirements.Count);

        Observation ci = input.Observations.Single(item => item.Role == "ci");
        Assert.Equal("obs-ci-b", ci.Id);
        Assert.Equal(4, ci.AcquisitionCost);
        Assert.Equal(WitnessProvenance.ProviderAsserted, ci.Witness.Provenance);
        Assert.Equal("run-2041", ci.Witness.Version);
        Assert.Equal("exact", DependencyWitness.Relation);

        DependencyWitness dependency = Assert.Single(ci.Witness.Dependencies);
        Assert.Equal("tested_head", dependency.Name);
        Assert.Equal("commit-B", dependency.Version);
        Assert.Equal(
            new ResourceIdentity("github", "acme", "branch_head", "payments/main"),
            dependency.Resource);
    }

    [Fact]
    public void Resource_identity_compares_every_component()
    {
        var left = new ResourceIdentity("p", "a", "k", "key");

        Assert.True(left == new ResourceIdentity("p", "a", "k", "key"));
        Assert.False(left != new ResourceIdentity("p", "a", "k", "key"));
        Assert.NotEqual(left, new ResourceIdentity("P", "a", "k", "key"));
        Assert.NotEqual(left, new ResourceIdentity("p", "A", "k", "key"));
        Assert.NotEqual(left, new ResourceIdentity("p", "a", "K", "key"));
        Assert.NotEqual(left, new ResourceIdentity("p", "a", "k", "KEY"));
        Assert.False(left == null);
        Assert.True((ResourceIdentity?)null == null);
        Assert.Equal(
            left.GetHashCode(),
            new ResourceIdentity("p", "a", "k", "key").GetHashCode());
    }

    [Fact]
    public void Null_arguments_are_rejected_before_any_work_happens()
    {
        Assert.Throws<ArgumentNullException>(() => ParsedVerificationInput.Parse(null!));
        Assert.Throws<ArgumentNullException>(() => WorldCutVerifier.VerifyJson(null!));
        Assert.Throws<ArgumentNullException>(() => WorldCutVerifier.Verify(null!));
        Assert.Throws<ArgumentNullException>(() => JsonValue.Create((string)null!));
        Assert.Throws<ArgumentNullException>(() => JsonValue.CreateArray((IEnumerable<JsonValue>)null!));
        Assert.Throws<ArgumentNullException>(() => JsonText.Indent(null!));
    }

    [Fact]
    public void Reading_a_json_value_as_the_wrong_kind_throws()
    {
        JsonValue value = JsonValue.Parse("{\"a\":1}");

        Assert.Throws<InvalidOperationException>(() => value.GetString());
        Assert.Throws<InvalidOperationException>(() => value.GetNumber());
        Assert.Throws<InvalidOperationException>(() => value.GetBoolean());
        Assert.Throws<InvalidOperationException>(() => value.Items);
        Assert.Throws<KeyNotFoundException>(() => value.GetProperty("missing"));
        Assert.False(value.IsNull);
        Assert.True(JsonValue.Null.IsNull);
    }

    [Fact]
    public void The_worldcut_exception_exposes_a_stable_code()
    {
        var runtime = new WorldCutException();
        Assert.Equal(WorldCutErrorCode.RuntimeError, runtime.Code);
        Assert.Equal("WORLDCUT_RUNTIME_ERROR", runtime.WireCode);

        var wrapped = new WorldCutException("boom", new InvalidOperationException("cause"));
        Assert.Equal("boom", wrapped.Message);
        Assert.IsType<InvalidOperationException>(wrapped.InnerException);

        var input = new WorldCutException(WorldCutErrorCode.InvalidInput, "bad", null);
        Assert.Equal("WORLDCUT_INVALID_INPUT", input.WireCode);
    }

    [Fact]
    public void No_public_type_leaks_the_vendored_canonicalizer()
    {
        Type[] exported = typeof(WorldCutVerifier).Assembly.GetExportedTypes();

        Assert.DoesNotContain(
            exported,
            type => type.Namespace?.StartsWith("Jcs", StringComparison.Ordinal) == true);
        Assert.All(
            exported,
            type => Assert.StartsWith("WorldCut", type.Namespace!, StringComparison.Ordinal));
    }

    private static void AssertReadOnly<T>(IReadOnlyList<T> collection)
    {
        Assert.IsNotType<T[]>(collection);
        Assert.IsNotType<List<T>>(collection);

        if (collection is IList list)
        {
            Assert.True(list.IsReadOnly, $"{collection.GetType().Name} must be read-only");
        }
        else
        {
            Assert.True(
                collection is ReadOnlyCollection<T>,
                $"{collection.GetType().Name} must be a read-only collection");
        }
    }
}
