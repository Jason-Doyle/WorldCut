namespace WorldCut.Model;

/// <summary>
/// A half-open validity interval <c>[From, Until)</c>. A null upper bound is
/// positive infinity.
/// </summary>
public sealed class ValidityInterval
{
    internal ValidityInterval(NormalizedTimestamp from, NormalizedTimestamp? until)
    {
        From = from;
        Until = until;
    }

    /// <summary>The inclusive lower bound.</summary>
    public NormalizedTimestamp From { get; }

    /// <summary>The exclusive upper bound, or <see langword="null"/> for positive infinity.</summary>
    public NormalizedTimestamp? Until { get; }
}

/// <summary>The provenance categories accepted in protocol 0.1.</summary>
public enum WitnessProvenance
{
    /// <summary>The provider asserted the metadata.</summary>
    ProviderAsserted = 0,

    /// <summary>The client observed the metadata directly.</summary>
    ClientObserved = 1,

    /// <summary>The metadata was derived from other evidence.</summary>
    Derived = 2,

    /// <summary>An operator supplied the metadata.</summary>
    OperatorSupplied = 3,
}

/// <summary>A declared dependency of one observation on another resource.</summary>
public sealed class DependencyWitness
{
    internal DependencyWitness(
        string name,
        ResourceIdentity resource,
        string? version,
        WitnessProvenance provenance)
    {
        Name = name;
        Resource = resource;
        Version = version;
        Provenance = provenance;
    }

    /// <summary>The dependency name, unique within one observation.</summary>
    public string Name { get; }

    /// <summary>The resource the dependency refers to.</summary>
    public ResourceIdentity Resource { get; }

    /// <summary>The only relation defined by protocol 0.1.</summary>
    public static string Relation => "exact";

    /// <summary>The declared dependency version, when the provider exposes one.</summary>
    public string? Version { get; }

    /// <summary>How the dependency metadata was obtained.</summary>
    public WitnessProvenance Provenance { get; }
}

/// <summary>The metadata a provider exposes alongside an observation.</summary>
public sealed class ObservationWitness
{
    internal ObservationWitness(
        WitnessProvenance provenance,
        string? version,
        ValidityInterval? validity,
        DependencyWitness[] dependencies)
    {
        Provenance = provenance;
        Version = version;
        Validity = validity;
        Dependencies = Array.AsReadOnly(dependencies);
    }

    /// <summary>How the observation was obtained.</summary>
    public WitnessProvenance Provenance { get; }

    /// <summary>The exact resource version, when the provider exposes one.</summary>
    public string? Version { get; }

    /// <summary>The declared validity interval, when the provider exposes one.</summary>
    public ValidityInterval? Validity { get; }

    /// <summary>The declared dependencies, in declaration order.</summary>
    public IReadOnlyList<DependencyWitness> Dependencies { get; }

    internal DependencyWitness? FindDependency(string name)
    {
        foreach (DependencyWitness dependency in Dependencies)
        {
            if (string.Equals(dependency.Name, name, StringComparison.Ordinal))
            {
                return dependency;
            }
        }

        return null;
    }
}
