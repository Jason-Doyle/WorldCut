using WorldCut.Engine;
using WorldCut.Json;
using WorldCut.Model;

namespace WorldCut;

/// <summary>
/// The WorldCut 0.1 decision-coherence verifier.
/// </summary>
/// <remarks>
/// Verification is deterministic and side-effect free. It never fetches
/// evidence, infers missing relationships, or judges whether a provider is
/// truthful; it evaluates the supplied contract against the supplied
/// observations and fails closed when required evidence is absent.
/// </remarks>
public static class WorldCutVerifier
{
    /// <summary>Verifies a validated input.</summary>
    /// <param name="input">The parsed verification input.</param>
    /// <returns>A fully immutable verification result.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="input"/> is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">The input cannot be verified.</exception>
    public static VerificationResult Verify(ParsedVerificationInput input)
    {
        ArgumentNullException.ThrowIfNull(input);

        var observationsByRole = new Dictionary<string, Observation>(
            input.Observations.Count,
            StringComparer.Ordinal);
        foreach (Observation observation in input.Observations)
        {
            observationsByRole.Add(observation.Role, observation);
        }

        IReadOnlyList<ContractRequirement> requirements = input.RequirementsById();
        var results = new RequirementResult[requirements.Count];
        for (int index = 0; index < requirements.Count; index++)
        {
            results[index] = RequirementEvaluator.Evaluate(requirements[index], observationsByRole);
        }

        int satisfied = 0;
        int violated = 0;
        int unknown = 0;
        int advisory = 0;
        foreach (RequirementResult result in results)
        {
            if (!result.Required)
            {
                advisory++;
                continue;
            }

            switch (result.Status)
            {
                case RequirementStatus.Satisfied:
                    satisfied++;
                    break;
                case RequirementStatus.Violated:
                    violated++;
                    break;
                default:
                    unknown++;
                    break;
            }
        }

        ContractVerdict verdict = violated > 0
            ? ContractVerdict.ContractViolated
            : unknown > 0
                ? ContractVerdict.InsufficientEvidence
                : ContractVerdict.ContractSatisfied;

        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(results);
        var coverage = new VerificationCoverage(
            satisfied + violated + unknown,
            satisfied,
            violated,
            unknown,
            advisory);

        JsonValue record = BuildRecord(input, requirements, verdict, results, plan);

        return new VerificationResult(
            input.ProtocolVersion,
            input.Contract.Id,
            input.Contract.Version,
            verdict,
            coverage,
            results,
            plan,
            CanonicalJson.ComputeSha256Hex(record));
    }

    /// <summary>Parses, validates, and verifies one verification input.</summary>
    /// <param name="json">The verification input JSON.</param>
    /// <returns>A fully immutable verification result.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="json"/> is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">The document is not a verifiable input.</exception>
    public static VerificationResult VerifyJson(string json) =>
        Verify(ParsedVerificationInput.Parse(json));

    /// <summary>Parses, validates, and verifies one verification input.</summary>
    /// <param name="utf8Json">The UTF-8 encoded verification input JSON.</param>
    /// <returns>A fully immutable verification result.</returns>
    /// <exception cref="WorldCutException">The bytes are not a verifiable input.</exception>
    public static VerificationResult VerifyJsonUtf8(ReadOnlySpan<byte> utf8Json) =>
        Verify(ParsedVerificationInput.ParseUtf8(utf8Json));

    private static JsonValue BuildRecord(
        ParsedVerificationInput input,
        IReadOnlyList<ContractRequirement> sortedRequirements,
        ContractVerdict verdict,
        RequirementResult[] results,
        AcquisitionPlan plan)
    {
        var sortedRequirementJson = new JsonValue[sortedRequirements.Count];
        for (int index = 0; index < sortedRequirements.Count; index++)
        {
            sortedRequirementJson[index] = sortedRequirements[index].Raw;
        }

        var contractMembers = new List<KeyValuePair<string, JsonValue>>(input.Contract.Raw.Members.Count);
        foreach (KeyValuePair<string, JsonValue> member in input.Contract.Raw.Members)
        {
            contractMembers.Add(string.Equals(member.Key, "requirements", StringComparison.Ordinal)
                ? new KeyValuePair<string, JsonValue>(member.Key, JsonValue.CreateArrayOwned(sortedRequirementJson))
                : member);
        }

        IReadOnlyList<Observation> sortedObservations = input.ObservationsByRole();
        var observationJson = new JsonValue[sortedObservations.Count];
        for (int index = 0; index < sortedObservations.Count; index++)
        {
            observationJson[index] = sortedObservations[index].Raw;
        }

        var resultJson = new JsonValue[results.Length];
        for (int index = 0; index < results.Length; index++)
        {
            resultJson[index] = results[index].ToJson();
        }

        return JsonValue.CreateObject(
        [
            new("protocolVersion", JsonValue.Create(input.ProtocolVersion)),
            new("engineVersion", JsonValue.Create(WorldCutProtocol.EngineVersion)),
            new("canonicalization", JsonValue.Create(WorldCutProtocol.Canonicalization)),
            new("contract", JsonValue.CreateObject(contractMembers)),
            new("observations", JsonValue.CreateArrayOwned(observationJson)),
            new("verdict", JsonValue.Create(verdict.ToWireName())),
            new("requirementResults", JsonValue.CreateArrayOwned(resultJson)),
            new("acquisitionPlan", plan.ToJson()),
        ]);
    }
}
