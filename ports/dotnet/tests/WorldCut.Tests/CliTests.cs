using System.Diagnostics;
using System.Globalization;
using System.Text;
using WorldCut.Json;
using WorldCut.Tool;

namespace WorldCut.Tests;

/// <summary>
/// Command-line behaviour: output shape, exit codes, and the stable error
/// envelope written to standard error.
/// </summary>
public sealed class CliTests : IDisposable
{
    private readonly string _directory = System.IO.Directory.CreateTempSubdirectory("worldcut-cli").FullName;

    public void Dispose() => System.IO.Directory.Delete(_directory, recursive: true);

    [Fact]
    public void Prints_the_complete_verification_result()
    {
        string path = Write("satisfied.json", Fixtures.InputWithVerdict("CONTRACT_SATISFIED"));
        var output = new StringWriter(CultureInfo.InvariantCulture);
        var error = new StringWriter(CultureInfo.InvariantCulture);

        Assert.Equal(0, Program.Run([path], output, error));
        Assert.Equal(string.Empty, error.ToString());

        JsonValue printed = JsonValue.Parse(output.ToString());
        Assert.Equal(
            CanonicalJson.Serialize(Fixtures.Expected("coherent")),
            CanonicalJson.Serialize(printed));
    }

    [Fact]
    public void Require_satisfied_exits_with_two_for_a_violated_contract()
    {
        string path = Write("violated.json", Fixtures.InputWithVerdict("CONTRACT_VIOLATED"));
        var output = new StringWriter(CultureInfo.InvariantCulture);
        var error = new StringWriter(CultureInfo.InvariantCulture);

        Assert.Equal(2, Program.Run(["--require-satisfied", path], output, error));

        JsonValue printed = JsonValue.Parse(output.ToString());
        Assert.Equal("CONTRACT_VIOLATED", printed.GetProperty("verdict").GetString());
        Assert.Equal(string.Empty, error.ToString());
    }

    [Fact]
    public void Require_satisfied_exits_with_two_for_insufficient_evidence()
    {
        string path = Write("unknown.json", Fixtures.InputWithVerdict("INSUFFICIENT_EVIDENCE"));

        Assert.Equal(2, Run(["--require-satisfied", path], out _, out _));
    }

    [Fact]
    public void Require_satisfied_exits_with_zero_for_a_satisfied_contract()
    {
        string path = Write("satisfied.json", Fixtures.InputWithVerdict("CONTRACT_SATISFIED"));

        Assert.Equal(0, Run([path, "--require-satisfied"], out _, out _));
    }

    [Theory]
    [InlineData("--help")]
    public void Help_exits_with_zero(string flag)
    {
        Assert.Equal(0, Run([flag], out string output, out string error));

        Assert.Contains("worldcut-dotnet", output, StringComparison.Ordinal);
        Assert.Contains("--require-satisfied", output, StringComparison.Ordinal);
        Assert.Equal(string.Empty, error);
    }

    [Fact]
    public void An_unsupported_short_help_flag_is_an_argument_error()
    {
        Assert.Equal(1, Run(["-h"], out _, out string error));

        AssertErrorCode("WORLDCUT_INVALID_ARGUMENT", error);
    }

    [Fact]
    public void An_argument_containing_an_unpaired_surrogate_still_produces_the_envelope()
    {
        Assert.Equal(1, Run(["--bad\ud800"], out _, out string error));

        AssertErrorCode("WORLDCUT_INVALID_ARGUMENT", error);
        Assert.Contains("\ufffd", error, StringComparison.Ordinal);
    }

    [Fact]
    public void Help_wins_over_other_arguments()
    {
        string path = Write("satisfied.json", Fixtures.InputWithVerdict("CONTRACT_SATISFIED"));

        Assert.Equal(0, Run(["--require-satisfied", path, "--help"], out string output, out _));
        Assert.Contains("Usage:", output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("--unknown")]
    [InlineData("-x")]
    public void Invalid_arguments_produce_a_stable_error_envelope(string argument)
    {
        string[] arguments = argument.Length == 0 ? [] : [argument];

        Assert.Equal(1, Run(arguments, out string output, out string error));

        Assert.Equal(string.Empty, output);
        AssertErrorCode("WORLDCUT_INVALID_ARGUMENT", error);
    }

    [Fact]
    public void More_than_one_positional_argument_is_rejected()
    {
        string path = Write("satisfied.json", Fixtures.InputWithVerdict("CONTRACT_SATISFIED"));

        Assert.Equal(1, Run([path, path], out _, out string error));
        AssertErrorCode("WORLDCUT_INVALID_ARGUMENT", error);
    }

    [Fact]
    public void A_missing_file_produces_a_read_failure()
    {
        Assert.Equal(1, Run([Path.Combine(_directory, "missing.json")], out _, out string error));

        AssertErrorCode("WORLDCUT_FILE_READ_FAILED", error);
    }

    [Fact]
    public void A_directory_argument_produces_a_read_failure()
    {
        Assert.Equal(1, Run([_directory], out _, out string error));

        AssertErrorCode("WORLDCUT_FILE_READ_FAILED", error);
    }

    [Fact]
    public void Invalid_json_produces_an_input_error()
    {
        string path = Write("invalid.json", "not json");

        Assert.Equal(1, Run([path], out _, out string error));
        AssertErrorCode("WORLDCUT_INVALID_INPUT", error);
    }

    [Fact]
    public void Invalid_protocol_input_produces_an_input_error()
    {
        string path = Write("wrong-protocol.json", "{\"protocolVersion\":\"9.9\"}");

        Assert.Equal(1, Run([path], out _, out string error));
        AssertErrorCode("WORLDCUT_INVALID_INPUT", error);
    }

    [Fact]
    public void Raw_unpaired_surrogate_input_produces_an_input_error()
    {
        string path = Path.Combine(_directory, "surrogate.json");
        File.WriteAllBytes(path, ConformanceCorpus.ReadBytes("raw/unpaired-high-surrogate.json"));

        Assert.Equal(1, Run([path], out _, out string error));
        AssertErrorCode("WORLDCUT_INVALID_INPUT", error);
    }

    [Fact]
    public void Non_ascii_output_is_written_as_utf8()
    {
        string json = Fixtures.CoherentInput()
            .Replace("ci-status-passed", "ci-status-\u20ac\ud83d\udc0d", StringComparison.Ordinal);
        string path = Write("unicode.json", json);

        Assert.Equal(0, Run([path], out string output, out _));

        Assert.Contains("\u20ac\ud83d\udc0d", output, StringComparison.Ordinal);
    }

    [Fact]
    public void The_published_executable_matches_the_in_process_exit_codes()
    {
        string toolPath = ToolAssemblyPath();
        string path = Write("violated.json", Fixtures.InputWithVerdict("CONTRACT_VIOLATED"));

        (int exitCode, string output, string error) = RunProcess(toolPath, ["--require-satisfied", path]);

        Assert.Equal(2, exitCode);
        Assert.Equal(string.Empty, error.Trim());
        Assert.Equal("CONTRACT_VIOLATED", JsonValue.Parse(output).GetProperty("verdict").GetString());
    }

    [Fact]
    public void The_published_executable_writes_errors_to_standard_error()
    {
        (int exitCode, string output, string error) = RunProcess(ToolAssemblyPath(), ["--nope"]);

        Assert.Equal(1, exitCode);
        Assert.Equal(string.Empty, output.Trim());
        AssertErrorCode("WORLDCUT_INVALID_ARGUMENT", error);
    }

    [Fact]
    public void The_published_executable_writes_non_ascii_output_as_utf8()
    {
        string json = Fixtures.CoherentInput()
            .Replace("ci-status-passed", "ci-status-\u20ac\ud83d\udc0d", StringComparison.Ordinal);
        string path = Write("unicode-process.json", json);

        (int exitCode, string output, _) = RunProcess(ToolAssemblyPath(), [path]);

        Assert.Equal(0, exitCode);
        Assert.Contains("\u20ac\ud83d\udc0d", output, StringComparison.Ordinal);
    }

    private static void AssertErrorCode(string expected, string error)
    {
        JsonValue envelope = JsonValue.Parse(error.Trim());
        Assert.True(envelope.TryGetProperty("error", out JsonValue? detail));
        Assert.Equal(expected, detail.GetProperty("code").GetString());
        Assert.NotEmpty(detail.GetProperty("message").GetString());
    }

    private static string ToolAssemblyPath()
    {
        string testDirectory = AppContext.BaseDirectory;
        string candidate = Path.Combine(testDirectory, "WorldCut.Tool.dll");
        Assert.True(File.Exists(candidate), $"the CLI assembly is missing from {testDirectory}");
        return candidate;
    }

    private static string DotnetMuxerPath()
    {
        string runtimeDirectory = System.Runtime.InteropServices.RuntimeEnvironment.GetRuntimeDirectory();
        string? root = new DirectoryInfo(runtimeDirectory).Parent?.Parent?.Parent?.FullName;
        string fileName = OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet";
        string candidate = root is null ? fileName : Path.Combine(root, fileName);
        return File.Exists(candidate) ? candidate : fileName;
    }

    private static (int ExitCode, string Output, string Error) RunProcess(
        string assemblyPath,
        string[] arguments)
    {
        var startInfo = new ProcessStartInfo(DotnetMuxerPath())
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            UseShellExecute = false,
        };

        startInfo.ArgumentList.Add(assemblyPath);
        foreach (string argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using Process process = Process.Start(startInfo)!;
        string output = process.StandardOutput.ReadToEnd();
        string error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        return (process.ExitCode, output, error);
    }

    private static int Run(string[] arguments, out string output, out string error)
    {
        var outputWriter = new StringWriter(CultureInfo.InvariantCulture);
        var errorWriter = new StringWriter(CultureInfo.InvariantCulture);
        int exitCode = Program.Run(arguments, outputWriter, errorWriter);
        output = outputWriter.ToString();
        error = errorWriter.ToString();
        return exitCode;
    }

    private string Write(string name, string contents)
    {
        string path = Path.Combine(_directory, name);
        File.WriteAllText(path, contents, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        return path;
    }
}
