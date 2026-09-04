using WorldCut.Json;
using WorldCut.Model;

namespace WorldCut;

/// <summary>
/// Enforces every WorldCut 0.1 runtime invariant on a parsed JSON document.
/// </summary>
/// <remarks>
/// Transport shape is also described by the published JSON Schemas, but the
/// invariants enforced here — unique roles, interval ordering, observation
/// timing, cost bounds, and the closed field sets — are what the invalid
/// conformance vectors lock down.
/// </remarks>
internal static class VerificationInputValidator
{
    private static readonly string[] InputKeys = ["protocolVersion", "contract", "observations"];

    private static readonly string[] ContractKeys =
        ["id", "version", "decisionTime", "assumptions", "requirements"];

    private static readonly string[] AssumptionKeys = ["clockModel", "intervalModel", "metadataModel"];

    private static readonly string[] ObservationKeys =
        ["id", "role", "resource", "value", "observedAt", "acquisitionCost", "witness"];

    private static readonly string[] WitnessKeys = ["provenance", "version", "validity", "dependencies"];

    private static readonly string[] DependencyKeys =
        ["name", "resource", "relation", "version", "provenance"];

    private static readonly string[] DependencyRequiredKeys = ["name", "resource", "relation", "provenance"];

    private static readonly string[] ResourceKeys = ["provider", "account", "kind", "key"];

    private static readonly string[] IntervalKeys = ["from", "until"];

    private static readonly string[] RequirementBaseKeys = ["id", "description", "type"];

    private static readonly string[] DependencyRequirementKeys =
        ["id", "description", "required", "type", "dependentRole", "targetRole", "dependencyName"];

    private static readonly string[] CommonValidTimeRequirementKeys =
        ["id", "description", "required", "type", "roles", "within"];

    private static readonly string[] ValueEqualsRequirementKeys =
        ["id", "description", "required", "type", "role", "path", "expected"];

    internal static ParsedVerificationInput Validate(JsonValue root)
    {
        JsonValue input = RequireObject(root, "input");
        RequireExactKeys(input, InputKeys, "input");
        RequireKeys(input, InputKeys, "input");

        JsonValue protocolVersion = Property(input, "protocolVersion");
        if (protocolVersion.Kind != JsonKind.String
            || !string.Equals(protocolVersion.GetString(), WorldCutProtocol.ProtocolVersion, StringComparison.Ordinal))
        {
            throw WorldCutException.InvalidInput("input.protocolVersion must equal 0.1");
        }

        DecisionContract contract = ReadContract(Property(input, "contract"));
        JsonValue observationValues = RequireArray(Property(input, "observations"), "observations");

        var observations = new List<Observation>(observationValues.Items.Count);
        var identifiers = new HashSet<string>(StringComparer.Ordinal);
        var roles = new HashSet<string>(StringComparer.Ordinal);

        foreach (JsonValue observationValue in observationValues.Items)
        {
            Observation observation = ReadObservation(observationValue);
            if (!identifiers.Add(observation.Id))
            {
                throw WorldCutException.InvalidInput($"Duplicate observation id: {observation.Id}");
            }

            if (!roles.Add(observation.Role))
            {
                throw WorldCutException.InvalidInput($"Duplicate observation role: {observation.Role}");
            }

            if (observation.ObservedAt > contract.DecisionTime)
            {
                throw WorldCutException.InvalidInput(
                    $"{observation.Role}.observedAt must not be after contract.decisionTime");
            }

            observations.Add(observation);
        }

        return new ParsedVerificationInput(
            WorldCutProtocol.ProtocolVersion,
            contract,
            observations.ToArray());
    }

    private static DecisionContract ReadContract(JsonValue value)
    {
        JsonValue contract = RequireObject(value, "contract");
        RequireExactKeys(contract, ContractKeys, "contract");
        RequireKeys(contract, ContractKeys, "contract");

        string id = NonEmptyString(Property(contract, "id"), "contract.id");
        string version = NonEmptyString(Property(contract, "version"), "contract.version");
        NormalizedTimestamp decisionTime = Timestamp(Property(contract, "decisionTime"), "contract.decisionTime");

        JsonValue assumptions = RequireObject(Property(contract, "assumptions"), "contract.assumptions");
        RequireExactKeys(assumptions, AssumptionKeys, "contract.assumptions");
        RequireKeys(assumptions, AssumptionKeys, "contract.assumptions");
        if (!IsStringEqual(Property(assumptions, "clockModel"), "trusted_normalized")
            || !IsStringEqual(Property(assumptions, "intervalModel"), "half_open")
            || !IsStringEqual(Property(assumptions, "metadataModel"), "honest_but_possibly_incomplete"))
        {
            throw WorldCutException.InvalidInput("contract assumptions are not supported by this engine");
        }

        JsonValue requirementValues = RequireArray(Property(contract, "requirements"), "contract.requirements");
        var requirements = new List<ContractRequirement>(requirementValues.Items.Count);
        var identifiers = new HashSet<string>(StringComparer.Ordinal);
        int requiredCount = 0;

        foreach (JsonValue requirementValue in requirementValues.Items)
        {
            ContractRequirement requirement = ReadRequirement(requirementValue);
            if (!identifiers.Add(requirement.Id))
            {
                throw WorldCutException.InvalidInput($"Duplicate requirement id: {requirement.Id}");
            }

            if (requirement.Required)
            {
                requiredCount++;
            }

            requirements.Add(requirement);
        }

        if (requiredCount == 0)
        {
            throw WorldCutException.InvalidInput(
                "A decision contract must contain at least one required requirement");
        }

        return new DecisionContract(id, version, decisionTime, requirements.ToArray(), contract);
    }

    private static ContractRequirement ReadRequirement(JsonValue value)
    {
        JsonValue requirement = RequireObject(value, "requirement");
        RequireKeys(requirement, RequirementBaseKeys, "requirement");

        string id = NonEmptyString(Property(requirement, "id"), "requirement.id");
        string description = NonEmptyString(Property(requirement, "description"), $"{id}.description");
        bool required = ReadRequiredFlag(requirement, id);

        JsonValue typeValue = Property(requirement, "type");
        string type = typeValue.Kind == JsonKind.String ? typeValue.GetString() : string.Empty;

        switch (type)
        {
            case "dependency":
                RequireExactKeys(requirement, DependencyRequirementKeys, id);
                RequireKeys(requirement, ["dependentRole", "targetRole", "dependencyName"], id);
                return new DependencyRequirement(
                    id,
                    description,
                    required,
                    requirement,
                    NonEmptyString(Property(requirement, "dependentRole"), $"{id}.dependentRole"),
                    NonEmptyString(Property(requirement, "targetRole"), $"{id}.targetRole"),
                    NonEmptyString(Property(requirement, "dependencyName"), $"{id}.dependencyName"));

            case "common_valid_time":
                RequireExactKeys(requirement, CommonValidTimeRequirementKeys, id);
                RequireKeys(requirement, ["roles", "within"], id);
                return new CommonValidTimeRequirement(
                    id,
                    description,
                    required,
                    requirement,
                    ReadRoles(Property(requirement, "roles"), id),
                    Interval(Property(requirement, "within"), $"{id}.within"));

            case "value_equals":
                RequireExactKeys(requirement, ValueEqualsRequirementKeys, id);
                RequireKeys(requirement, ["role", "path", "expected"], id);
                return new ValueEqualsRequirement(
                    id,
                    description,
                    required,
                    requirement,
                    NonEmptyString(Property(requirement, "role"), $"{id}.role"),
                    ReadPath(Property(requirement, "path"), id),
                    Property(requirement, "expected"));

            default:
                throw WorldCutException.InvalidInput($"Unsupported requirement type: {Describe(typeValue)}");
        }
    }

    private static string[] ReadRoles(JsonValue value, string requirementId)
    {
        JsonValue roleValues = RequireArray(value, $"{requirementId}.roles");
        if (roleValues.Items.Count < 2)
        {
            throw WorldCutException.InvalidInput($"{requirementId} must reference at least two roles");
        }

        var roles = new List<string>(roleValues.Items.Count);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonValue roleValue in roleValues.Items)
        {
            string role = NonEmptyString(roleValue, $"{requirementId}.role");
            if (!seen.Add(role))
            {
                throw WorldCutException.InvalidInput($"{requirementId} contains duplicate role {role}");
            }

            roles.Add(role);
        }

        return roles.ToArray();
    }

    private static string[] ReadPath(JsonValue value, string requirementId)
    {
        JsonValue pathValues = RequireArray(value, $"{requirementId}.path");
        if (pathValues.Items.Count == 0)
        {
            throw WorldCutException.InvalidInput($"{requirementId}.path must contain at least one segment");
        }

        var path = new List<string>(pathValues.Items.Count);
        foreach (JsonValue segment in pathValues.Items)
        {
            path.Add(NonEmptyString(segment, $"{requirementId}.path segment"));
        }

        return path.ToArray();
    }

    private static Observation ReadObservation(JsonValue value)
    {
        JsonValue observation = RequireObject(value, "observation");
        RequireExactKeys(observation, ObservationKeys, "observation");
        RequireKeys(observation, ObservationKeys, "observation");

        string id = NonEmptyString(Property(observation, "id"), "observation.id");
        string role = NonEmptyString(Property(observation, "role"), "observation.role");
        ResourceIdentity resource = Resource(Property(observation, "resource"), $"{role}.resource");
        NormalizedTimestamp observedAt = Timestamp(Property(observation, "observedAt"), $"{role}.observedAt");
        long acquisitionCost = AcquisitionCost(Property(observation, "acquisitionCost"), role);
        ObservationWitness witness = ReadWitness(Property(observation, "witness"), role);

        return new Observation(
            id,
            role,
            resource,
            Property(observation, "value"),
            observedAt,
            acquisitionCost,
            witness,
            observation);
    }

    private static ObservationWitness ReadWitness(JsonValue value, string role)
    {
        string field = $"{role}.witness";
        JsonValue witness = RequireObject(value, field);
        RequireExactKeys(witness, WitnessKeys, field);
        RequireKeys(witness, ["provenance"], field);

        WitnessProvenance provenance = Provenance(Property(witness, "provenance"), $"{field}.provenance");

        string? version = witness.TryGetProperty("version", out JsonValue? versionValue)
            ? NonEmptyString(versionValue, $"{field}.version")
            : null;

        ValidityInterval? validity = witness.TryGetProperty("validity", out JsonValue? validityValue)
            ? Interval(validityValue, $"{field}.validity")
            : null;

        DependencyWitness[] dependencies = Array.Empty<DependencyWitness>();
        if (witness.TryGetProperty("dependencies", out JsonValue? dependencyValues))
        {
            JsonValue array = RequireArray(dependencyValues, $"{field}.dependencies");
            var declared = new List<DependencyWitness>(array.Items.Count);
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonValue dependencyValue in array.Items)
            {
                DependencyWitness dependency = ReadDependency(dependencyValue, role);
                if (!names.Add(dependency.Name))
                {
                    throw WorldCutException.InvalidInput(
                        $"Duplicate dependency {dependency.Name} on role {role}");
                }

                declared.Add(dependency);
            }

            dependencies = declared.ToArray();
        }

        return new ObservationWitness(provenance, version, validity, dependencies);
    }

    private static DependencyWitness ReadDependency(JsonValue value, string role)
    {
        string field = $"{role}.dependency";
        JsonValue dependency = RequireObject(value, field);
        RequireExactKeys(dependency, DependencyKeys, field);
        RequireKeys(dependency, DependencyRequiredKeys, field);

        string name = NonEmptyString(Property(dependency, "name"), "dependency.name");
        ResourceIdentity resource = Resource(
            Property(dependency, "resource"),
            $"{role}.dependency.{name}.resource");

        if (!IsStringEqual(Property(dependency, "relation"), "exact"))
        {
            throw WorldCutException.InvalidInput($"{role}.dependency.{name}.relation is unsupported");
        }

        string? version = dependency.TryGetProperty("version", out JsonValue? versionValue)
            ? NonEmptyString(versionValue, $"{role}.dependency.{name}.version")
            : null;

        WitnessProvenance provenance = Provenance(
            Property(dependency, "provenance"),
            $"{role}.dependency.{name}.provenance");

        return new DependencyWitness(name, resource, version, provenance);
    }

    private static bool ReadRequiredFlag(JsonValue requirement, string id)
    {
        if (!requirement.TryGetProperty("required", out JsonValue? value))
        {
            return true;
        }

        if (value.Kind != JsonKind.Boolean)
        {
            throw WorldCutException.InvalidInput($"{id}.required must be boolean");
        }

        return value.GetBoolean();
    }

    private static ResourceIdentity Resource(JsonValue value, string field)
    {
        JsonValue resource = RequireObject(value, field);
        RequireExactKeys(resource, ResourceKeys, field);
        RequireKeys(resource, ResourceKeys, field);
        return new ResourceIdentity(
            NonEmptyString(Property(resource, "provider"), $"{field}.provider"),
            NonEmptyString(Property(resource, "account"), $"{field}.account"),
            NonEmptyString(Property(resource, "kind"), $"{field}.kind"),
            NonEmptyString(Property(resource, "key"), $"{field}.key"));
    }

    private static ValidityInterval Interval(JsonValue value, string field)
    {
        JsonValue interval = RequireObject(value, field);
        RequireExactKeys(interval, IntervalKeys, field);
        RequireKeys(interval, IntervalKeys, field);

        NormalizedTimestamp from = Timestamp(Property(interval, "from"), $"{field}.from");
        JsonValue untilValue = Property(interval, "until");
        if (untilValue.IsNull)
        {
            return new ValidityInterval(from, null);
        }

        NormalizedTimestamp until = Timestamp(untilValue, $"{field}.until");
        if (until <= from)
        {
            throw WorldCutException.InvalidInput($"{field} must be a non-empty half-open interval");
        }

        return new ValidityInterval(from, until);
    }

    private static WitnessProvenance Provenance(JsonValue value, string field) =>
        NonEmptyString(value, field) switch
        {
            "provider_asserted" => WitnessProvenance.ProviderAsserted,
            "client_observed" => WitnessProvenance.ClientObserved,
            "derived" => WitnessProvenance.Derived,
            "operator_supplied" => WitnessProvenance.OperatorSupplied,
            _ => throw WorldCutException.InvalidInput($"{field} is not a supported provenance category"),
        };

    private static long AcquisitionCost(JsonValue value, string role)
    {
        string message =
            $"{role}.acquisitionCost must be an integer between 0 and {WorldCutProtocol.MaxAcquisitionCost}";

        if (value.Kind != JsonKind.Number)
        {
            throw WorldCutException.InvalidInput(message);
        }

        double cost = value.GetNumber();
        if (cost != Math.Floor(cost)
            || cost < 0
            || cost > WorldCutProtocol.MaxAcquisitionCost
            || Math.Abs(cost) > JsonValue.MaxSafeInteger)
        {
            throw WorldCutException.InvalidInput(message);
        }

        return (long)cost;
    }

    private static NormalizedTimestamp Timestamp(JsonValue value, string field)
    {
        string text = NonEmptyString(value, field);
        if (!NormalizedTimestamp.TryParse(text, out NormalizedTimestamp timestamp))
        {
            throw WorldCutException.InvalidInput(
                $"{field} must use normalized ISO-8601 UTC form with milliseconds");
        }

        return timestamp;
    }

    private static string NonEmptyString(JsonValue value, string field)
    {
        if (value.Kind != JsonKind.String || value.GetString().Length == 0)
        {
            throw WorldCutException.InvalidInput($"{field} must be a non-empty string");
        }

        return value.GetString();
    }

    private static bool IsStringEqual(JsonValue value, string expected) =>
        value.Kind == JsonKind.String && string.Equals(value.GetString(), expected, StringComparison.Ordinal);

    private static JsonValue RequireObject(JsonValue value, string field) =>
        value.Kind == JsonKind.Object
            ? value
            : throw WorldCutException.InvalidInput($"{field} must be a plain object");

    private static JsonValue RequireArray(JsonValue value, string field) =>
        value.Kind == JsonKind.Array
            ? value
            : throw WorldCutException.InvalidInput($"{field} must be an array");

    private static JsonValue Property(JsonValue container, string name) =>
        container.TryGetProperty(name, out JsonValue? value) ? value : JsonValue.Null;

    private static void RequireExactKeys(JsonValue container, IReadOnlyList<string> allowed, string field)
    {
        List<string>? unsupported = null;
        foreach (KeyValuePair<string, JsonValue> member in container.Members)
        {
            if (!Contains(allowed, member.Key))
            {
                (unsupported ??= []).Add(member.Key);
            }
        }

        if (unsupported is not null)
        {
            throw WorldCutException.InvalidInput(
                $"{field} contains unsupported field(s): {string.Join(", ", unsupported)}");
        }
    }

    private static void RequireKeys(JsonValue container, IReadOnlyList<string> required, string field)
    {
        List<string>? missing = null;
        foreach (string key in required)
        {
            if (!container.TryGetProperty(key, out _))
            {
                (missing ??= []).Add(key);
            }
        }

        if (missing is not null)
        {
            throw WorldCutException.InvalidInput(
                $"{field} is missing required field(s): {string.Join(", ", missing)}");
        }
    }

    private static bool Contains(IReadOnlyList<string> values, string candidate)
    {
        foreach (string value in values)
        {
            if (string.Equals(value, candidate, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static string Describe(JsonValue value) => value.Kind switch
    {
        JsonKind.String => value.GetString(),
        JsonKind.Null => "null",
        _ => value.Kind.ToString(),
    };
}
