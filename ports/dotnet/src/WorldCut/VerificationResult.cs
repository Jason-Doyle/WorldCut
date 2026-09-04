using WorldCut.Json;

namespace WorldCut;

/// <summary>The status of one evaluated requirement.</summary>
public enum RequirementStatus
{
    /// <summary>Available metadata establishes the requirement.</summary>
    Satisfied = 0,

    /// <summary>Available metadata establishes that the requirement is false.</summary>
    Violated = 1,

    /// <summary>A required observation or witness is missing.</summary>
    Unknown = 2,
}

/// <summary>The aggregate verdict for one verification.</summary>
public enum ContractVerdict
{
    /// <summary>Every required requirement is satisfied.</summary>
    ContractSatisfied = 0,

    /// <summary>At least one required requirement is violated.</summary>
    ContractViolated = 1,

    /// <summary>No required requirement is violated, but evidence is missing.</summary>
    InsufficientEvidence = 2,
}

/// <summary>The kinds of acquisition action a plan can contain.</summary>
public enum AcquisitionActionType
{
    /// <summary>Acquire or refresh an observation for a role.</summary>
    RefreshObservation = 0,

    /// <summary>Fetch missing witness metadata for an existing observation.</summary>
    FetchRequiredMetadata = 1,

    /// <summary>Acquire evidence compatible with a selected resource or version.</summary>
    AcquireCompatibleEvidence = 2,
}

/// <summary>The state of an acquisition plan.</summary>
public enum AcquisitionPlanStatus
{
    /// <summary>No required requirement needs additional evidence.</summary>
    NotNeeded = 0,

    /// <summary>An exact minimum-cost plan covers every unresolved requirement.</summary>
    Available = 1,

    /// <summary>Exact optimality could not be established for every requirement.</summary>
    Incomplete = 2,
}

/// <summary>Wire spellings for the result enumerations.</summary>
public static class ResultNames
{
    /// <summary>Returns the wire spelling of a requirement status.</summary>
    /// <param name="status">The status.</param>
    /// <returns>The wire spelling.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="status"/> is not defined.</exception>
    public static string ToWireName(this RequirementStatus status) => status switch
    {
        RequirementStatus.Satisfied => "SATISFIED",
        RequirementStatus.Violated => "VIOLATED",
        RequirementStatus.Unknown => "UNKNOWN",
        _ => throw new ArgumentOutOfRangeException(nameof(status)),
    };

    /// <summary>Returns the wire spelling of an aggregate verdict.</summary>
    /// <param name="verdict">The verdict.</param>
    /// <returns>The wire spelling.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="verdict"/> is not defined.</exception>
    public static string ToWireName(this ContractVerdict verdict) => verdict switch
    {
        ContractVerdict.ContractSatisfied => "CONTRACT_SATISFIED",
        ContractVerdict.ContractViolated => "CONTRACT_VIOLATED",
        ContractVerdict.InsufficientEvidence => "INSUFFICIENT_EVIDENCE",
        _ => throw new ArgumentOutOfRangeException(nameof(verdict)),
    };

    /// <summary>Returns the wire spelling of an acquisition action type.</summary>
    /// <param name="type">The action type.</param>
    /// <returns>The wire spelling.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="type"/> is not defined.</exception>
    public static string ToWireName(this AcquisitionActionType type) => type switch
    {
        AcquisitionActionType.RefreshObservation => "REFRESH_OBSERVATION",
        AcquisitionActionType.FetchRequiredMetadata => "FETCH_REQUIRED_METADATA",
        AcquisitionActionType.AcquireCompatibleEvidence => "ACQUIRE_COMPATIBLE_EVIDENCE",
        _ => throw new ArgumentOutOfRangeException(nameof(type)),
    };

    /// <summary>Returns the wire spelling of an acquisition plan status.</summary>
    /// <param name="status">The plan status.</param>
    /// <returns>The wire spelling.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="status"/> is not defined.</exception>
    public static string ToWireName(this AcquisitionPlanStatus status) => status switch
    {
        AcquisitionPlanStatus.NotNeeded => "NOT_NEEDED",
        AcquisitionPlanStatus.Available => "AVAILABLE",
        AcquisitionPlanStatus.Incomplete => "INCOMPLETE",
        _ => throw new ArgumentOutOfRangeException(nameof(status)),
    };
}

/// <summary>One concrete evidence-acquisition step.</summary>
public sealed class AcquisitionAction
{
    internal AcquisitionAction(
        string id,
        AcquisitionActionType type,
        string role,
        long cost,
        string description,
        JsonValue? expected)
    {
        Id = id;
        Type = type;
        Role = role;
        Cost = cost;
        Description = description;
        Expected = expected;
    }

    /// <summary>The action identifier used to deduplicate work across options.</summary>
    public string Id { get; }

    /// <summary>The action kind.</summary>
    public AcquisitionActionType Type { get; }

    /// <summary>The role the action applies to.</summary>
    public string Role { get; }

    /// <summary>The declared integer cost of performing the action.</summary>
    public long Cost { get; }

    /// <summary>The human-readable action description.</summary>
    public string Description { get; }

    /// <summary>The expected evidence shape, or <see langword="null"/>.</summary>
    public JsonValue? Expected { get; }

    internal JsonValue ToJson() => JsonValue.CreateObject(
    [
        new("id", JsonValue.Create(Id)),
        new("type", JsonValue.Create(Type.ToWireName())),
        new("role", JsonValue.Create(Role)),
        new("cost", JsonValue.Create(Cost)),
        new("description", JsonValue.Create(Description)),
        new("expected", Expected ?? JsonValue.Null),
    ]);
}

/// <summary>One alternative set of conjunctive acquisition actions.</summary>
public sealed class AcquisitionOption
{
    internal AcquisitionOption(string id, string description, AcquisitionAction[] actions)
    {
        Id = id;
        Description = description;
        Actions = Array.AsReadOnly(actions);
    }

    /// <summary>The option identifier.</summary>
    public string Id { get; }

    /// <summary>The human-readable option description.</summary>
    public string Description { get; }

    /// <summary>All actions in the option; they are conjunctive.</summary>
    public IReadOnlyList<AcquisitionAction> Actions { get; }

    internal JsonValue ToJson() => JsonValue.CreateObject(
    [
        new("id", JsonValue.Create(Id)),
        new("description", JsonValue.Create(Description)),
        new("actions", JsonValue.CreateArray(Actions.Select(action => action.ToJson()))),
    ]);
}

/// <summary>The result of evaluating one contract requirement.</summary>
public sealed class RequirementResult
{
    internal RequirementResult(
        string requirementId,
        string requirementType,
        bool required,
        RequirementStatus status,
        string summary,
        JsonValue details,
        AcquisitionOption[] acquisitionOptions)
    {
        RequirementId = requirementId;
        RequirementType = requirementType;
        Required = required;
        Status = status;
        Summary = summary;
        Details = details;
        AcquisitionOptions = Array.AsReadOnly(acquisitionOptions);
    }

    /// <summary>The evaluated requirement identifier.</summary>
    public string RequirementId { get; }

    /// <summary>The wire spelling of the requirement kind.</summary>
    public string RequirementType { get; }

    /// <summary>Whether the requirement affects the aggregate verdict.</summary>
    public bool Required { get; }

    /// <summary>The requirement status.</summary>
    public RequirementStatus Status { get; }

    /// <summary>The human-readable explanation, which is part of the record contract.</summary>
    public string Summary { get; }

    /// <summary>Structured detail explaining the status.</summary>
    public JsonValue Details { get; }

    /// <summary>The alternative acquisition options for this requirement.</summary>
    public IReadOnlyList<AcquisitionOption> AcquisitionOptions { get; }

    internal JsonValue ToJson() => JsonValue.CreateObject(
    [
        new("requirementId", JsonValue.Create(RequirementId)),
        new("requirementType", JsonValue.Create(RequirementType)),
        new("required", JsonValue.Create(Required)),
        new("status", JsonValue.Create(Status.ToWireName())),
        new("summary", JsonValue.Create(Summary)),
        new("details", Details),
        new("acquisitionOptions", JsonValue.CreateArray(AcquisitionOptions.Select(option => option.ToJson()))),
    ]);
}

/// <summary>The bounded evidence-acquisition plan for one verification.</summary>
public sealed class AcquisitionPlan
{
    internal AcquisitionPlan(
        AcquisitionPlanStatus status,
        string? reason,
        AcquisitionAction[] actions,
        string[] selectedOptionIds,
        long totalCost,
        string[] coveredRequirementIds,
        string[] unresolvedRequirementIds)
    {
        Status = status;
        Reason = reason;
        Actions = Array.AsReadOnly(actions);
        SelectedOptionIds = Array.AsReadOnly(selectedOptionIds);
        TotalCost = totalCost;
        CoveredRequirementIds = Array.AsReadOnly(coveredRequirementIds);
        UnresolvedRequirementIds = Array.AsReadOnly(unresolvedRequirementIds);
    }

    /// <summary>The plan status.</summary>
    public AcquisitionPlanStatus Status { get; }

    /// <summary>Why the plan is incomplete, or <see langword="null"/>.</summary>
    public string? Reason { get; }

    /// <summary>The distinct selected actions, ordered by action identifier.</summary>
    public IReadOnlyList<AcquisitionAction> Actions { get; }

    /// <summary>The selected option identifiers, ordered by UTF-16 code units.</summary>
    public IReadOnlyList<string> SelectedOptionIds { get; }

    /// <summary>The sum of the distinct action costs.</summary>
    public long TotalCost { get; }

    /// <summary>Requirements that have at least one acquisition option.</summary>
    public IReadOnlyList<string> CoveredRequirementIds { get; }

    /// <summary>Requirements that could not be covered.</summary>
    public IReadOnlyList<string> UnresolvedRequirementIds { get; }

    internal JsonValue ToJson() => JsonValue.CreateObject(
    [
        new("status", JsonValue.Create(Status.ToWireName())),
        new("reason", Reason is null ? JsonValue.Null : JsonValue.Create(Reason)),
        new("actions", JsonValue.CreateArray(Actions.Select(action => action.ToJson()))),
        new("selectedOptionIds", JsonValue.CreateArray(SelectedOptionIds.Select(JsonValue.Create))),
        new("totalCost", JsonValue.Create(TotalCost)),
        new("coveredRequirementIds", JsonValue.CreateArray(CoveredRequirementIds.Select(JsonValue.Create))),
        new("unresolvedRequirementIds", JsonValue.CreateArray(UnresolvedRequirementIds.Select(JsonValue.Create))),
    ]);
}

/// <summary>Requirement counts for one verification.</summary>
public sealed class VerificationCoverage
{
    internal VerificationCoverage(int required, int satisfied, int violated, int unknown, int advisory)
    {
        Required = required;
        Satisfied = satisfied;
        Violated = violated;
        Unknown = unknown;
        Advisory = advisory;
    }

    /// <summary>The number of required requirement results.</summary>
    public int Required { get; }

    /// <summary>Required results with status <c>SATISFIED</c>.</summary>
    public int Satisfied { get; }

    /// <summary>Required results with status <c>VIOLATED</c>.</summary>
    public int Violated { get; }

    /// <summary>Required results with status <c>UNKNOWN</c>.</summary>
    public int Unknown { get; }

    /// <summary>The number of advisory requirement results.</summary>
    public int Advisory { get; }

    internal JsonValue ToJson() => JsonValue.CreateObject(
    [
        new("required", JsonValue.Create(Required)),
        new("satisfied", JsonValue.Create(Satisfied)),
        new("violated", JsonValue.Create(Violated)),
        new("unknown", JsonValue.Create(Unknown)),
        new("advisory", JsonValue.Create(Advisory)),
    ]);
}

/// <summary>The complete, immutable outcome of one verification.</summary>
public sealed class VerificationResult
{
    internal VerificationResult(
        string protocolVersion,
        string contractId,
        string contractVersion,
        ContractVerdict verdict,
        VerificationCoverage coverage,
        RequirementResult[] requirementResults,
        AcquisitionPlan acquisitionPlan,
        string verificationRecordDigest)
    {
        ProtocolVersion = protocolVersion;
        ContractId = contractId;
        ContractVersion = contractVersion;
        Verdict = verdict;
        Coverage = coverage;
        RequirementResults = Array.AsReadOnly(requirementResults);
        AcquisitionPlan = acquisitionPlan;
        VerificationRecordDigest = verificationRecordDigest;
    }

    /// <summary>The protocol version echoed from the input.</summary>
    public string ProtocolVersion { get; }

    /// <summary>The engine ruleset that produced this result.</summary>
    public string EngineVersion { get; } = WorldCutProtocol.EngineVersion;

    /// <summary>The canonicalization scheme used for the digest.</summary>
    public string Canonicalization { get; } = WorldCutProtocol.Canonicalization;

    /// <summary>The verified contract identifier.</summary>
    public string ContractId { get; }

    /// <summary>The verified contract version.</summary>
    public string ContractVersion { get; }

    /// <summary>The aggregate verdict.</summary>
    public ContractVerdict Verdict { get; }

    /// <summary>Requirement counts.</summary>
    public VerificationCoverage Coverage { get; }

    /// <summary>Requirement results, ordered by requirement identifier.</summary>
    public IReadOnlyList<RequirementResult> RequirementResults { get; }

    /// <summary>The bounded acquisition plan.</summary>
    public AcquisitionPlan AcquisitionPlan { get; }

    /// <summary>The SHA-256 digest of the canonical verification record.</summary>
    public string VerificationRecordDigest { get; }

    /// <summary>Returns the complete result as protocol JSON.</summary>
    /// <returns>An immutable JSON object matching the published result schema.</returns>
    public JsonValue ToJson() => JsonValue.CreateObject(
    [
        new("protocolVersion", JsonValue.Create(ProtocolVersion)),
        new("engineVersion", JsonValue.Create(EngineVersion)),
        new("canonicalization", JsonValue.Create(Canonicalization)),
        new("contractId", JsonValue.Create(ContractId)),
        new("contractVersion", JsonValue.Create(ContractVersion)),
        new("verdict", JsonValue.Create(Verdict.ToWireName())),
        new("coverage", Coverage.ToJson()),
        new("requirementResults", JsonValue.CreateArray(RequirementResults.Select(result => result.ToJson()))),
        new("acquisitionPlan", AcquisitionPlan.ToJson()),
        new("verificationRecordDigest", JsonValue.Create(VerificationRecordDigest)),
    ]);
}
