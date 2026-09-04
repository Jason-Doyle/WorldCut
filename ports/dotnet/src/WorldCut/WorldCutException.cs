namespace WorldCut;

/// <summary>
/// The single exception type raised by the WorldCut public API.
/// </summary>
/// <remarks>
/// Every failure carries a stable <see cref="Code"/>. Callers that surface
/// failures to another process should emit <see cref="WireCode"/>.
/// </remarks>
public sealed class WorldCutException : Exception
{
    /// <summary>Creates a runtime-category exception with a default message.</summary>
    public WorldCutException()
        : this(WorldCutErrorCode.RuntimeError, "WorldCut failed.")
    {
    }

    /// <summary>Creates a runtime-category exception.</summary>
    /// <param name="message">The failure description.</param>
    public WorldCutException(string message)
        : this(WorldCutErrorCode.RuntimeError, message)
    {
    }

    /// <summary>Creates a runtime-category exception with an inner cause.</summary>
    /// <param name="message">The failure description.</param>
    /// <param name="innerException">The underlying failure.</param>
    public WorldCutException(string message, Exception? innerException)
        : this(WorldCutErrorCode.RuntimeError, message, innerException)
    {
    }

    /// <summary>Creates an exception in an explicit failure category.</summary>
    /// <param name="code">The stable failure category.</param>
    /// <param name="message">The failure description.</param>
    public WorldCutException(WorldCutErrorCode code, string message)
        : base(message)
    {
        Code = code;
    }

    /// <summary>Creates an exception in an explicit failure category.</summary>
    /// <param name="code">The stable failure category.</param>
    /// <param name="message">The failure description.</param>
    /// <param name="innerException">The underlying failure.</param>
    public WorldCutException(WorldCutErrorCode code, string message, Exception? innerException)
        : base(message, innerException)
    {
        Code = code;
    }

    /// <summary>The stable failure category.</summary>
    public WorldCutErrorCode Code { get; }

    /// <summary>The stable wire spelling of <see cref="Code"/>.</summary>
    public string WireCode => Code.ToWireCode();

    internal static WorldCutException InvalidInput(string message) =>
        new(WorldCutErrorCode.InvalidInput, message);

    internal static WorldCutException InvalidInput(string message, Exception? innerException) =>
        new(WorldCutErrorCode.InvalidInput, message, innerException);
}
