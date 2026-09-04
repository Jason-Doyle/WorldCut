using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Builds minimal, valid verification inputs so that individual protocol rules
/// can be exercised without editing a fixture by hand.
/// </summary>
internal static class ValueEqualsInput
{
    internal const string DecisionTime = "2026-09-02T18:00:00.000Z";
    internal const string ObservedAt = "2026-09-02T17:00:00.000Z";

    internal static string Build(JsonValue observed, IReadOnlyList<string> path, JsonValue expected) =>
        JsonText.Compact(BuildValue(observed, path, expected));

    internal static JsonValue BuildValue(
        JsonValue observed,
        IReadOnlyList<string> path,
        JsonValue expected) =>
        JsonValue.CreateObject(
        [
            new("protocolVersion", JsonValue.Create("0.1")),
            new("contract", JsonValue.CreateObject(
            [
                new("id", JsonValue.Create("value-path")),
                new("version", JsonValue.Create("1")),
                new("decisionTime", JsonValue.Create(DecisionTime)),
                new("assumptions", Assumptions),
                new("requirements", JsonValue.CreateArray(
                    JsonValue.CreateObject(
                    [
                        new("id", JsonValue.Create("value")),
                        new("type", JsonValue.Create("value_equals")),
                        new("description", JsonValue.Create("The observed value matches")),
                        new("role", JsonValue.Create("observed")),
                        new("path", JsonValue.CreateArray(path.Select(JsonValue.Create).ToArray())),
                        new("expected", expected),
                    ]))),
            ])),
            new("observations", JsonValue.CreateArray(Observation("observed", observed))),
        ]);

    internal static JsonValue Assumptions => JsonValue.CreateObject(
    [
        new("clockModel", JsonValue.Create("trusted_normalized")),
        new("intervalModel", JsonValue.Create("half_open")),
        new("metadataModel", JsonValue.Create("honest_but_possibly_incomplete")),
    ]);

    internal static JsonValue Observation(string role, JsonValue value) => JsonValue.CreateObject(
    [
        new("id", JsonValue.Create($"obs-{role}")),
        new("role", JsonValue.Create(role)),
        new("resource", JsonValue.CreateObject(
        [
            new("provider", JsonValue.Create("example")),
            new("account", JsonValue.Create("acme")),
            new("kind", JsonValue.Create("record")),
            new("key", JsonValue.Create(role)),
        ])),
        new("value", value),
        new("observedAt", JsonValue.Create(ObservedAt)),
        new("acquisitionCost", JsonValue.Create(1)),
        new("witness", JsonValue.CreateObject(
        [
            new("provenance", JsonValue.Create("provider_asserted")),
        ])),
    ]);
}
