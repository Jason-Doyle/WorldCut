using System.Reflection;
using System.Text;
using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Loads the mirrored conformance corpus from the test output directory.
/// </summary>
/// <remarks>
/// The corpus is copied into this project by
/// <c>scripts/generate-conformance.mjs</c>, so the tests never read a file from
/// the parent repository and keep working from a source distribution.
/// </remarks>
internal static class ConformanceCorpus
{
    internal static string Directory { get; } = Path.Combine(
        Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!,
        "data",
        "conformance",
        "0.1");

    internal static byte[] ReadBytes(string relativePath) =>
        File.ReadAllBytes(Path.Combine(Directory, relativePath.Replace('/', Path.DirectorySeparatorChar)));

    internal static JsonValue ReadVectorFile(string name) => JsonValue.ParseUtf8(ReadBytes(name));

    internal static IReadOnlyList<JsonValue> Cases(string name)
    {
        JsonValue file = ReadVectorFile(name);
        Assert.True(file.TryGetProperty("cases", out JsonValue? cases));
        return cases.Items;
    }

    internal static IEnumerable<TheoryDataRow<string>> CaseNames(string name)
    {
        foreach (JsonValue vector in Cases(name))
        {
            yield return new TheoryDataRow<string>(Name(vector));
        }
    }

    internal static JsonValue Case(string file, string caseName)
    {
        foreach (JsonValue vector in Cases(file))
        {
            if (string.Equals(Name(vector), caseName, StringComparison.Ordinal))
            {
                return vector;
            }
        }

        throw new InvalidOperationException($"conformance case {caseName} is missing from {file}");
    }

    internal static JsonValue Member(JsonValue value, string name)
    {
        Assert.True(value.TryGetProperty(name, out JsonValue? member), $"missing member {name}");
        return member;
    }

    internal static string Name(JsonValue vector) => Member(vector, "name").GetString();

    internal static byte[] Utf8(JsonValue value) => Encoding.UTF8.GetBytes(JsonText.Compact(value));
}
