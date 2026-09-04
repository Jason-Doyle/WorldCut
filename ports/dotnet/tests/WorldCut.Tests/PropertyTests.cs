using System.Globalization;
using System.Text;
using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Deterministic randomized invariant checks.
/// </summary>
/// <remarks>
/// Every case uses a fixed seed so a failure is reproducible from the test name
/// alone. These tests assert invariants, not golden values; the shared
/// conformance corpus owns the golden values.
/// </remarks>
public sealed class PropertyTests
{
    private const int Seed = 20260903;

    [Fact]
    public void Canonicalization_is_deterministic_and_stable_under_member_reordering()
    {
        var random = new Random(Seed);

        for (int iteration = 0; iteration < 2_000; iteration++)
        {
            JsonValue value = RandomJson(random, depth: 0);

            string first = CanonicalJson.Serialize(value);
            string second = CanonicalJson.Serialize(value);
            string reordered = CanonicalJson.Serialize(Shuffle(value, random));

            Assert.Equal(first, second);
            Assert.Equal(first, reordered);
            Assert.Equal(64, CanonicalJson.ComputeSha256Hex(value).Length);
        }
    }

    [Fact]
    public void Canonical_text_always_re_parses_to_the_same_canonical_text()
    {
        var random = new Random(Seed + 1);

        for (int iteration = 0; iteration < 2_000; iteration++)
        {
            JsonValue value = RandomJson(random, depth: 0);
            string canonical = CanonicalJson.Serialize(value);

            Assert.Equal(canonical, CanonicalJson.Serialize(JsonValue.Parse(canonical)));
            Assert.Equal(canonical, CanonicalJson.Serialize(JsonValue.Parse(JsonText.Indent(value))));
            Assert.Equal(canonical, CanonicalJson.Serialize(JsonValue.Parse(JsonText.Compact(value))));
        }
    }

    [Fact]
    public void Canonical_member_order_matches_ordinal_string_ordering()
    {
        var random = new Random(Seed + 2);

        for (int iteration = 0; iteration < 1_000; iteration++)
        {
            var names = new List<string>();
            for (int index = 0; index < random.Next(2, 8); index++)
            {
                names.Add(RandomString(random));
            }

            var members = new List<KeyValuePair<string, JsonValue>>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (string name in names)
            {
                if (seen.Add(name))
                {
                    members.Add(new KeyValuePair<string, JsonValue>(name, JsonValue.Create(0)));
                }
            }

            string canonical = CanonicalJson.Serialize(JsonValue.CreateObject(members));

            var expected = seen.ToList();
            expected.Sort(Utf16.Compare);

            var actual = ExtractMemberNames(canonical);
            Assert.Equal(expected, actual);
        }
    }

    [Fact]
    public void Every_double_round_trips_through_the_canonical_form()
    {
        var random = new Random(Seed + 3);
        var buffer = new byte[8];

        for (int iteration = 0; iteration < 20_000; iteration++)
        {
            random.NextBytes(buffer);
            double value = BitConverter.ToDouble(buffer);
            if (!double.IsFinite(value))
            {
                continue;
            }

            string canonical = CanonicalJson.Serialize(JsonValue.Create(value));
            double parsed = double.Parse(canonical, NumberStyles.Float, CultureInfo.InvariantCulture);

            Assert.Equal(value == 0d ? 0d : value, parsed);
        }
    }

    [Fact]
    public void Arbitrary_transport_bytes_never_escape_as_unstructured_errors()
    {
        var random = new Random(Seed + 4);

        for (int iteration = 0; iteration < 5_000; iteration++)
        {
            var source = new byte[random.Next(0, 96)];
            random.NextBytes(source);

            try
            {
                WorldCutVerifier.VerifyJsonUtf8(source);
            }
            catch (WorldCutException error)
            {
                Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
            }
        }
    }

    [Fact]
    public void Arbitrary_text_that_is_not_a_protocol_input_is_rejected()
    {
        var random = new Random(Seed + 5);

        for (int iteration = 0; iteration < 2_000; iteration++)
        {
            string source = RandomString(random);

            try
            {
                WorldCutVerifier.VerifyJson(source);
            }
            catch (WorldCutException error)
            {
                Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
                continue;
            }

            Assert.Fail($"random text unexpectedly verified: {source}");
        }
    }

    [Fact]
    public void Verification_is_independent_of_observation_and_requirement_order()
    {
        var random = new Random(Seed + 6);
        JsonValue input = Fixtures.Input("coherent");
        string expected = WorldCutVerifier.VerifyJsonUtf8(ConformanceCorpus.Utf8(input))
            .VerificationRecordDigest;

        for (int iteration = 0; iteration < 200; iteration++)
        {
            JsonValue permuted = PermuteInput(input, random);

            Assert.Equal(
                expected,
                WorldCutVerifier
                    .VerifyJsonUtf8(ConformanceCorpus.Utf8(permuted))
                    .VerificationRecordDigest);
        }
    }

    [Fact]
    public void Value_equals_agrees_with_canonical_equality()
    {
        var random = new Random(Seed + 7);

        for (int iteration = 0; iteration < 500; iteration++)
        {
            JsonValue observed = RandomJson(random, depth: 0);
            JsonValue expected = random.Next(2) == 0 ? observed : RandomJson(random, depth: 0);

            VerificationResult result = WorldCutVerifier.VerifyJson(
                ValueEqualsInput.Build(
                    JsonValue.CreateObject([new("field", observed)]),
                    ["field"],
                    expected));

            RequirementStatus status = Assert.Single(result.RequirementResults).Status;
            bool equal = string.Equals(
                CanonicalJson.Serialize(observed),
                CanonicalJson.Serialize(expected),
                StringComparison.Ordinal);

            Assert.Equal(equal ? RequirementStatus.Satisfied : RequirementStatus.Violated, status);
        }
    }

    private static JsonValue PermuteInput(JsonValue input, Random random)
    {
        var members = new List<KeyValuePair<string, JsonValue>>();
        foreach (KeyValuePair<string, JsonValue> member in input.Members)
        {
            JsonValue value = member.Key switch
            {
                "observations" => ShuffleArray(member.Value, random),
                "contract" => PermuteContract(member.Value, random),
                _ => member.Value,
            };
            members.Add(new KeyValuePair<string, JsonValue>(member.Key, value));
        }

        Shuffle(members, random);
        return JsonValue.CreateObject(members);
    }

    private static JsonValue PermuteContract(JsonValue contract, Random random)
    {
        var members = new List<KeyValuePair<string, JsonValue>>();
        foreach (KeyValuePair<string, JsonValue> member in contract.Members)
        {
            members.Add(string.Equals(member.Key, "requirements", StringComparison.Ordinal)
                ? new KeyValuePair<string, JsonValue>(member.Key, ShuffleArray(member.Value, random))
                : member);
        }

        Shuffle(members, random);
        return JsonValue.CreateObject(members);
    }

    private static JsonValue ShuffleArray(JsonValue value, Random random)
    {
        var items = value.Items.ToList();
        Shuffle(items, random);
        return JsonValue.CreateArray(items.ToArray());
    }

    private static void Shuffle<T>(List<T> items, Random random)
    {
        for (int index = items.Count - 1; index > 0; index--)
        {
            int swap = random.Next(index + 1);
            (items[index], items[swap]) = (items[swap], items[index]);
        }
    }

    private static JsonValue Shuffle(JsonValue value, Random random)
    {
        switch (value.Kind)
        {
            case JsonKind.Object:
                var members = value.Members
                    .Select(member => new KeyValuePair<string, JsonValue>(
                        member.Key,
                        Shuffle(member.Value, random)))
                    .ToList();
                Shuffle(members, random);
                return JsonValue.CreateObject(members);
            case JsonKind.Array:
                return JsonValue.CreateArray(value.Items.Select(item => Shuffle(item, random)).ToArray());
            default:
                return value;
        }
    }

    private static JsonValue RandomJson(Random random, int depth)
    {
        int choice = depth >= 4 ? random.Next(5) : random.Next(7);
        switch (choice)
        {
            case 0:
                return JsonValue.Null;
            case 1:
                return JsonValue.Create(random.Next(2) == 0);
            case 2:
                return JsonValue.Create(RandomString(random));
            case 3:
                return JsonValue.Create(random.NextInt64(-1_000_000, 1_000_000));
            case 4:
                return JsonValue.Create((random.NextDouble() - 0.5) * Math.Pow(10, random.Next(-30, 30)));
            case 5:
                int length = random.Next(0, 5);
                var items = new JsonValue[length];
                for (int index = 0; index < length; index++)
                {
                    items[index] = RandomJson(random, depth + 1);
                }

                return JsonValue.CreateArray(items);
            default:
                var members = new List<KeyValuePair<string, JsonValue>>();
                var names = new HashSet<string>(StringComparer.Ordinal);
                int count = random.Next(0, 5);
                for (int index = 0; index < count; index++)
                {
                    string name = RandomString(random);
                    if (names.Add(name))
                    {
                        members.Add(new KeyValuePair<string, JsonValue>(
                            name,
                            RandomJson(random, depth + 1)));
                    }
                }

                return JsonValue.CreateObject(members);
        }
    }

    private static string RandomString(Random random)
    {
        int length = random.Next(0, 12);
        var builder = new StringBuilder(length);
        for (int index = 0; index < length; index++)
        {
            switch (random.Next(6))
            {
                case 0:
                    builder.Append((char)random.Next(0x20, 0x7F));
                    break;
                case 1:
                    builder.Append((char)random.Next(0x00, 0x20));
                    break;
                case 2:
                    builder.Append((char)random.Next(0x00A0, 0x0800));
                    break;
                case 3:
                    builder.Append((char)random.Next(0x0800, 0xD800));
                    break;
                case 4:
                    builder.Append((char)random.Next(0xE000, 0xFFFE));
                    break;
                default:
                    builder.Append(char.ConvertFromUtf32(random.Next(0x10000, 0x110000)));
                    break;
            }
        }

        return builder.ToString();
    }

    private static List<string> ExtractMemberNames(string canonical)
    {
        var names = new List<string>();
        JsonValue value = JsonValue.Parse(canonical);
        foreach (KeyValuePair<string, JsonValue> member in value.Members)
        {
            names.Add(member.Key);
        }

        return names;
    }
}
