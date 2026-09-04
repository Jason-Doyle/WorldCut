using WorldCut.Json;

namespace WorldCut.Model;

/// <summary>One observation bound to exactly one contract role.</summary>
public sealed class Observation
{
    internal Observation(
        string id,
        string role,
        ResourceIdentity resource,
        JsonValue value,
        NormalizedTimestamp observedAt,
        long acquisitionCost,
        ObservationWitness witness,
        JsonValue raw)
    {
        Id = id;
        Role = role;
        Resource = resource;
        Value = value;
        ObservedAt = observedAt;
        AcquisitionCost = acquisitionCost;
        Witness = witness;
        Raw = raw;
    }

    /// <summary>The observation identifier, unique within one input.</summary>
    public string Id { get; }

    /// <summary>The contract role this observation is bound to.</summary>
    public string Role { get; }

    /// <summary>The identity of the observed resource.</summary>
    public ResourceIdentity Resource { get; }

    /// <summary>The observed JSON value.</summary>
    public JsonValue Value { get; }

    /// <summary>When the observation was taken.</summary>
    public NormalizedTimestamp ObservedAt { get; }

    /// <summary>The declared cost of reacquiring this observation.</summary>
    public long AcquisitionCost { get; }

    /// <summary>The provider metadata accompanying this observation.</summary>
    public ObservationWitness Witness { get; }

    /// <summary>
    /// The complete accepted observation JSON, used verbatim in the digest
    /// preimage.
    /// </summary>
    public JsonValue Raw { get; }
}
