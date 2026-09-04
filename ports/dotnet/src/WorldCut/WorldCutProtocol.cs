namespace WorldCut;

/// <summary>
/// Stable protocol identifiers and bounded limits implemented by this port.
/// </summary>
/// <remarks>
/// Package versions and protocol versions are independent. A package patch may
/// keep protocol <c>0.1</c> and engine <c>0.1.2</c> when verification semantics
/// are unchanged.
/// </remarks>
public static class WorldCutProtocol
{
    /// <summary>The only wire protocol version this port accepts.</summary>
    public const string ProtocolVersion = "0.1";

    /// <summary>The engine ruleset that produces verification results.</summary>
    public const string EngineVersion = "0.1.2";

    /// <summary>The canonicalization scheme used for every digest.</summary>
    public const string Canonicalization = "worldcut-json-v1";

    /// <summary>The highest acquisition cost a single observation may declare.</summary>
    public const long MaxAcquisitionCost = 1_000_000_000L;

    /// <summary>The highest total cost an acquisition plan may reach.</summary>
    public const long MaxPlanTotalCost = 64_000_000_000L;

    /// <summary>The highest number of unresolved requirements the planner will optimise.</summary>
    public const int MaxUnresolvedRequirements = 64;

    /// <summary>The highest number of option combinations the planner will enumerate.</summary>
    public const int MaxOptionCombinations = 65_536;

    /// <summary>The defensive search-state limit for acquisition planning.</summary>
    public const int MaxSearchStates = (MaxUnresolvedRequirements + 1) * MaxOptionCombinations;

    /// <summary>
    /// The deepest JSON nesting this port will parse from transport input.
    /// </summary>
    /// <remarks>
    /// This is an explicit, stable port policy rather than a protocol rule. A
    /// verification record wraps input values in up to eight further levels, so
    /// keeping the parse limit below <see cref="MaxCanonicalizationDepth"/>
    /// guarantees that every accepted input can also be canonicalized. Deeper
    /// input is rejected with <see cref="WorldCutErrorCode.InvalidInput"/>
    /// instead of exhausting the stack.
    /// </remarks>
    public const int MaxJsonDepth = 48;

    /// <summary>
    /// The deepest JSON nesting <see cref="Json.CanonicalJson"/> will serialize.
    /// </summary>
    /// <remarks>
    /// This matches the nesting cap of the vendored RFC 8785 canonicalizer. See
    /// <c>ports/dotnet/THIRD-PARTY-NOTICES.md</c>.
    /// </remarks>
    public const int MaxCanonicalizationDepth = 64;
}
