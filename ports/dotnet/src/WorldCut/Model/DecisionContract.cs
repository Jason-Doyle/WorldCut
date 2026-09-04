using WorldCut.Json;

namespace WorldCut.Model;

/// <summary>The decision contract carried by a verification input.</summary>
public sealed class DecisionContract
{
    internal DecisionContract(
        string id,
        string version,
        NormalizedTimestamp decisionTime,
        ContractRequirement[] requirements,
        JsonValue raw)
    {
        Id = id;
        Version = version;
        DecisionTime = decisionTime;
        Requirements = Array.AsReadOnly(requirements);
        Raw = raw;
    }

    /// <summary>The contract identifier.</summary>
    public string Id { get; }

    /// <summary>The contract version.</summary>
    public string Version { get; }

    /// <summary>The instant the decision is made.</summary>
    public NormalizedTimestamp DecisionTime { get; }

    /// <summary>The requirements, in declaration order.</summary>
    public IReadOnlyList<ContractRequirement> Requirements { get; }

    /// <summary>
    /// The complete accepted contract JSON, used verbatim in the digest
    /// preimage after its requirements are sorted by identifier.
    /// </summary>
    public JsonValue Raw { get; }
}
