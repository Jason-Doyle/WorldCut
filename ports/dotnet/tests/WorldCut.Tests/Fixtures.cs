using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>Shared fixture inputs drawn from the mirrored conformance corpus.</summary>
internal static class Fixtures
{
    internal static JsonValue Input(string caseName) =>
        ConformanceCorpus.Member(
            ConformanceCorpus.Case("verification-vectors.json", caseName),
            "input");

    internal static JsonValue Expected(string caseName) =>
        ConformanceCorpus.Member(
            ConformanceCorpus.Case("verification-vectors.json", caseName),
            "expected");

    internal static string CoherentInput() => JsonText.Compact(Input("coherent"));

    internal static string InputWithVerdict(string verdict)
    {
        foreach (JsonValue vector in ConformanceCorpus.Cases("verification-vectors.json"))
        {
            JsonValue expected = ConformanceCorpus.Member(vector, "expected");
            if (string.Equals(
                    ConformanceCorpus.Member(expected, "verdict").GetString(),
                    verdict,
                    StringComparison.Ordinal))
            {
                return JsonText.Compact(ConformanceCorpus.Member(vector, "input"));
            }
        }

        throw new InvalidOperationException($"no conformance case produces {verdict}");
    }
}
