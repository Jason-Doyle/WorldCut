using WorldCut.Json;
using WorldCut.Model;

namespace WorldCut;

/// <summary>
/// An immutable, fully validated WorldCut verification input.
/// </summary>
/// <remarks>
/// <para>
/// A <see cref="ParsedVerificationInput"/> can only be produced by
/// <see cref="Parse(string)"/> or <see cref="ParseUtf8(ReadOnlySpan{byte})"/>,
/// so it cannot be constructed into an invalid state. Every value it exposes is
/// immutable, which means a caller can verify the same parsed input repeatedly
/// and cannot alter it between verifications.
/// </para>
/// </remarks>
public sealed class ParsedVerificationInput
{
    internal ParsedVerificationInput(
        string protocolVersion,
        DecisionContract contract,
        Observation[] observations)
    {
        ProtocolVersion = protocolVersion;
        Contract = contract;
        Observations = Array.AsReadOnly(observations);
    }

    /// <summary>The accepted protocol version, always <c>0.1</c>.</summary>
    public string ProtocolVersion { get; }

    /// <summary>The decision contract.</summary>
    public DecisionContract Contract { get; }

    /// <summary>The observations, in input order.</summary>
    public IReadOnlyList<Observation> Observations { get; }

    /// <summary>Parses and validates one verification input from UTF-16 text.</summary>
    /// <param name="json">The verification input JSON.</param>
    /// <returns>The validated immutable input.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="json"/> is <see langword="null"/>.</exception>
    /// <exception cref="WorldCutException">
    /// The document is not a valid WorldCut 0.1 verification input. The error
    /// code is always <see cref="WorldCutErrorCode.InvalidInput"/>.
    /// </exception>
    public static ParsedVerificationInput Parse(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        return VerificationInputValidator.Validate(JsonValue.Parse(json));
    }

    /// <summary>Parses and validates one verification input from UTF-8 bytes.</summary>
    /// <param name="utf8Json">The UTF-8 encoded verification input JSON.</param>
    /// <returns>The validated immutable input.</returns>
    /// <exception cref="WorldCutException">
    /// The document is not a valid WorldCut 0.1 verification input. The error
    /// code is always <see cref="WorldCutErrorCode.InvalidInput"/>.
    /// </exception>
    public static ParsedVerificationInput ParseUtf8(ReadOnlySpan<byte> utf8Json) =>
        VerificationInputValidator.Validate(JsonValue.ParseUtf8(utf8Json));

    internal IReadOnlyList<ContractRequirement> RequirementsById()
    {
        var sorted = Contract.Requirements.ToArray();
        Array.Sort(sorted, static (left, right) => Utf16.Compare(left.Id, right.Id));
        return sorted;
    }

    internal IReadOnlyList<Observation> ObservationsByRole()
    {
        var sorted = Observations.ToArray();
        Array.Sort(sorted, static (left, right) => Utf16.Compare(left.Role, right.Role));
        return sorted;
    }
}
