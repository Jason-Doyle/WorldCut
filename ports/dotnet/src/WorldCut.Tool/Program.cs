using System.Text;
using WorldCut.Json;

namespace WorldCut.Tool;

/// <summary>
/// The <c>worldcut-dotnet</c> command-line entry point.
/// </summary>
/// <remarks>
/// <para>
/// The CLI reads exactly one verification input file and prints the complete
/// verification result as JSON on standard output. Failures are reported as a
/// stable JSON envelope on standard error.
/// </para>
/// <para>
/// Exit codes match the other WorldCut ports:
/// <c>0</c> success or <c>--help</c>; <c>1</c> argument, file, input, or
/// runtime failure; <c>2</c> a non-satisfied verdict under
/// <c>--require-satisfied</c>.
/// </para>
/// </remarks>
internal static class Program
{
    private const int ExitSuccess = 0;
    private const int ExitFailure = 1;
    private const int ExitNotSatisfied = 2;

    internal static int Main(string[] args)
    {
        using var output = CreateWriter(Console.OpenStandardOutput());
        using var error = CreateWriter(Console.OpenStandardError());

        try
        {
            return Run(args, output, error);
        }
#pragma warning disable CA1031 // The CLI contract requires a stable envelope for every failure.
        catch (Exception failure)
#pragma warning restore CA1031
        {
            return WriteError(error, WorldCutErrorCode.RuntimeError, failure.Message);
        }
    }

    internal static int Run(IReadOnlyList<string> args, TextWriter output, TextWriter error)
    {
        bool requireSatisfied = false;
        string? inputPath = null;
        int positionalCount = 0;

        foreach (string argument in args)
        {
            if (string.Equals(argument, "--help", StringComparison.Ordinal))
            {
                output.WriteLine(Usage);
                return ExitSuccess;
            }

            if (string.Equals(argument, "--require-satisfied", StringComparison.Ordinal))
            {
                requireSatisfied = true;
                continue;
            }

            if (argument.StartsWith('-'))
            {
                return WriteError(error, WorldCutErrorCode.InvalidArgument, $"Unknown option: {argument}");
            }

            positionalCount++;
            inputPath ??= argument;
        }

        if (positionalCount != 1 || inputPath is null || inputPath.Length == 0)
        {
            return WriteError(
                error,
                WorldCutErrorCode.InvalidArgument,
                "Exactly one verification JSON file is required");
        }

        byte[] source;
        string resolvedPath;
        try
        {
            resolvedPath = Path.GetFullPath(inputPath);
            source = File.ReadAllBytes(resolvedPath);
        }
        catch (Exception failure) when (failure is IOException
            or UnauthorizedAccessException
            or NotSupportedException
            or ArgumentException
            or System.Security.SecurityException)
        {
            return WriteError(
                error,
                WorldCutErrorCode.FileReadFailed,
                $"Unable to read {inputPath}");
        }

        VerificationResult result;
        try
        {
            result = WorldCutVerifier.VerifyJsonUtf8(source);
        }
        catch (WorldCutException failure)
        {
            return WriteError(error, failure.Code, failure.Message);
        }

        output.WriteLine(JsonText.Indent(result.ToJson()));

        return requireSatisfied && result.Verdict != ContractVerdict.ContractSatisfied
            ? ExitNotSatisfied
            : ExitSuccess;
    }

    private static string Usage => string.Join(
        '\n',
        "Usage: worldcut-dotnet [--require-satisfied] <verification.json>",
        string.Empty,
        "Options:",
        "  --require-satisfied  Exit with code 2 unless the contract is satisfied",
        "  --help               Show this help");

    private static int WriteError(TextWriter error, WorldCutErrorCode code, string message)
    {
        error.WriteLine(JsonText.Compact(JsonValue.CreateObject(
        [
            new("error", JsonValue.CreateObject(
            [
                new("code", JsonValue.Create(code.ToWireCode())),
                new("message", JsonValue.Create(Sanitize(message))),
            ])),
        ])));
        return ExitFailure;
    }

    /// <summary>
    /// Replaces unpaired surrogates so that a hostile path or message can never
    /// stop the CLI from emitting its stable error envelope.
    /// </summary>
    private static string Sanitize(string message)
    {
        if (Utf16.IndexOfUnpairedSurrogate(message) < 0)
        {
            return message;
        }

        var builder = new StringBuilder(message.Length);
        for (int index = 0; index < message.Length; index++)
        {
            char current = message[index];
            if (char.IsHighSurrogate(current)
                && index + 1 < message.Length
                && char.IsLowSurrogate(message[index + 1]))
            {
                builder.Append(current).Append(message[index + 1]);
                index++;
                continue;
            }

            builder.Append(char.IsSurrogate(current) ? '\uFFFD' : current);
        }

        return builder.ToString();
    }

    private static StreamWriter CreateWriter(Stream stream) =>
        new(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)) { AutoFlush = true };
}
