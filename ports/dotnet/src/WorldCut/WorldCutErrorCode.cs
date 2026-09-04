namespace WorldCut;

/// <summary>
/// Stable failure categories reported by the WorldCut .NET port.
/// </summary>
/// <remarks>
/// The wire spelling of each member is defined by
/// <see cref="WorldCutErrorCodes"/> and is part of this port's public contract.
/// </remarks>
public enum WorldCutErrorCode
{
    /// <summary>
    /// Transport bytes, JSON syntax, or protocol invariants were rejected.
    /// </summary>
    /// <remarks>
    /// Like the Go and Python ports, JSON syntax failures are reported with
    /// this code rather than a separate parse code.
    /// </remarks>
    InvalidInput = 0,

    /// <summary>Command-line arguments were rejected.</summary>
    InvalidArgument = 1,

    /// <summary>A verification input file could not be read.</summary>
    FileReadFailed = 2,

    /// <summary>An unexpected internal failure occurred.</summary>
    RuntimeError = 3,
}

/// <summary>
/// The stable wire spellings of <see cref="WorldCutErrorCode"/>.
/// </summary>
public static class WorldCutErrorCodes
{
    /// <summary>Wire code for <see cref="WorldCutErrorCode.InvalidInput"/>.</summary>
    public const string InvalidInput = "WORLDCUT_INVALID_INPUT";

    /// <summary>Wire code for <see cref="WorldCutErrorCode.InvalidArgument"/>.</summary>
    public const string InvalidArgument = "WORLDCUT_INVALID_ARGUMENT";

    /// <summary>Wire code for <see cref="WorldCutErrorCode.FileReadFailed"/>.</summary>
    public const string FileReadFailed = "WORLDCUT_FILE_READ_FAILED";

    /// <summary>Wire code for <see cref="WorldCutErrorCode.RuntimeError"/>.</summary>
    public const string RuntimeError = "WORLDCUT_RUNTIME_ERROR";

    /// <summary>Returns the stable wire spelling of <paramref name="code"/>.</summary>
    /// <param name="code">The error category.</param>
    /// <returns>The wire code string.</returns>
    /// <exception cref="ArgumentOutOfRangeException">
    /// <paramref name="code"/> is not a defined member.
    /// </exception>
    public static string ToWireCode(this WorldCutErrorCode code) => code switch
    {
        WorldCutErrorCode.InvalidInput => InvalidInput,
        WorldCutErrorCode.InvalidArgument => InvalidArgument,
        WorldCutErrorCode.FileReadFailed => FileReadFailed,
        WorldCutErrorCode.RuntimeError => RuntimeError,
        _ => throw new ArgumentOutOfRangeException(nameof(code)),
    };
}
