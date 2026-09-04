using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Produces an input that is semantically identical but ordered differently.
/// </summary>
/// <remarks>
/// Object member order is never significant, and the verifier normalises
/// contract requirements by identifier and observations by role before
/// evaluating or hashing. Everything else — role lists, value paths, and
/// observed arrays — keeps its original order because the protocol gives that
/// order meaning.
/// </remarks>
internal static class JsonReorder
{
    internal static JsonValue Reverse(JsonValue input)
    {
        JsonValue reordered = ReverseMembers(input);
        var members = new List<KeyValuePair<string, JsonValue>>();

        foreach (KeyValuePair<string, JsonValue> member in reordered.Members)
        {
            JsonValue value = member.Key switch
            {
                "observations" => ReverseArray(member.Value),
                "contract" => ReverseRequirements(member.Value),
                _ => member.Value,
            };

            members.Add(new KeyValuePair<string, JsonValue>(member.Key, value));
        }

        return JsonValue.CreateObject(members);
    }

    private static JsonValue ReverseRequirements(JsonValue contract)
    {
        var members = new List<KeyValuePair<string, JsonValue>>();
        foreach (KeyValuePair<string, JsonValue> member in contract.Members)
        {
            members.Add(string.Equals(member.Key, "requirements", StringComparison.Ordinal)
                ? new KeyValuePair<string, JsonValue>(member.Key, ReverseArray(member.Value))
                : member);
        }

        return JsonValue.CreateObject(members);
    }

    private static JsonValue ReverseArray(JsonValue value) =>
        JsonValue.CreateArray(value.Items.Reverse().ToArray());

    private static JsonValue ReverseMembers(JsonValue value) => value.Kind switch
    {
        JsonKind.Object => JsonValue.CreateObject(
            value.Members
                .Select(member => new KeyValuePair<string, JsonValue>(member.Key, ReverseMembers(member.Value)))
                .Reverse()
                .ToArray()),
        JsonKind.Array => JsonValue.CreateArray(value.Items.Select(ReverseMembers).ToArray()),
        _ => value,
    };
}
