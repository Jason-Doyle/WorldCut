using WorldCut.Json;
using WorldCut.Model;

namespace WorldCut.Engine;

/// <summary>
/// Builds the exact requirement results defined by <c>spec/0.1/RESULTS.md</c>.
/// </summary>
/// <remarks>
/// Summaries, detail members, acquisition action identifiers, and option
/// ordering are all part of the protocol 0.1 record contract. They are locked
/// down by the committed verification vectors and cannot be reworded.
/// </remarks>
internal static class RequirementEvaluator
{
    internal static RequirementResult Evaluate(
        ContractRequirement requirement,
        IReadOnlyDictionary<string, Observation> observationsByRole) => requirement switch
        {
            DependencyRequirement dependency => EvaluateDependency(dependency, observationsByRole),
            CommonValidTimeRequirement temporal => EvaluateCommonValidTime(temporal, observationsByRole),
            ValueEqualsRequirement value => EvaluateValueEquals(value, observationsByRole),
            _ => throw new WorldCutException(
                WorldCutErrorCode.RuntimeError,
                $"Unsupported requirement type: {requirement.TypeName}"),
        };

    private static RequirementResult EvaluateDependency(
        DependencyRequirement requirement,
        IReadOnlyDictionary<string, Observation> observationsByRole)
    {
        var missingRoles = new List<string>(2);
        foreach (string role in new[] { requirement.DependentRole, requirement.TargetRole })
        {
            if (!observationsByRole.ContainsKey(role))
            {
                missingRoles.Add(role);
            }
        }

        if (missingRoles.Count > 0)
        {
            return MissingRolesResult(requirement, missingRoles);
        }

        Observation dependent = observationsByRole[requirement.DependentRole];
        Observation target = observationsByRole[requirement.TargetRole];
        DependencyWitness? dependency = dependent.Witness.FindDependency(requirement.DependencyName);

        if (dependency is null)
        {
            var actions = new List<AcquisitionAction>(2)
            {
                Action(
                    AcquisitionActionType.FetchRequiredMetadata,
                    dependent,
                    dependent.Role,
                    $"Fetch dependency metadata for {dependent.Role}.",
                    JsonValue.CreateObject(
                    [
                        new("dependencyName", JsonValue.Create(requirement.DependencyName)),
                        new("targetResource", ResourceJson(target.Resource)),
                    ])),
            };

            if (target.Witness.Version is null)
            {
                actions.Add(Action(
                    AcquisitionActionType.FetchRequiredMetadata,
                    target,
                    target.Role,
                    $"Fetch the resource version for {target.Role}.",
                    null));
            }

            return new RequirementResult(
                requirement.Id,
                requirement.TypeName,
                requirement.Required,
                RequirementStatus.Unknown,
                $"{dependent.Role} does not expose dependency {requirement.DependencyName}.",
                JsonValue.CreateObject(
                [
                    new("dependentRole", JsonValue.Create(dependent.Role)),
                    new("targetRole", JsonValue.Create(target.Role)),
                    new("missingDependency", JsonValue.Create(requirement.DependencyName)),
                ]),
                [
                    Option(
                        requirement.Id,
                        "fetch-dependency-metadata",
                        "Fetch all metadata required to compare the dependency.",
                        actions),
                ]);
        }

        if (dependency.Resource != target.Resource)
        {
            return new RequirementResult(
                requirement.Id,
                requirement.TypeName,
                requirement.Required,
                RequirementStatus.Violated,
                $"{dependent.Role} is bound to a different resource than {target.Role}.",
                JsonValue.CreateObject(
                [
                    new("dependentResource", ResourceJson(dependency.Resource)),
                    new("targetResource", ResourceJson(target.Resource)),
                ]),
                [
                    Option(
                        requirement.Id,
                        "acquire-compatible-resource",
                        "Acquire dependent evidence bound to the selected target resource.",
                        [
                            Action(
                                AcquisitionActionType.AcquireCompatibleEvidence,
                                dependent,
                                dependent.Role,
                                $"Acquire {dependent.Role} evidence for the selected {target.Role} resource.",
                                JsonValue.CreateObject(
                                [
                                    new("targetResource", ResourceJson(target.Resource)),
                                ])),
                        ]),
                ]);
        }

        if (dependency.Version is null || target.Witness.Version is null)
        {
            var actions = new List<AcquisitionAction>(2);
            if (dependency.Version is null)
            {
                actions.Add(Action(
                    AcquisitionActionType.FetchRequiredMetadata,
                    dependent,
                    dependent.Role,
                    $"Fetch the dependency version for {dependent.Role}.",
                    JsonValue.CreateObject(
                    [
                        new("dependencyName", JsonValue.Create(requirement.DependencyName)),
                    ])));
            }

            if (target.Witness.Version is null)
            {
                actions.Add(Action(
                    AcquisitionActionType.FetchRequiredMetadata,
                    target,
                    target.Role,
                    $"Fetch the resource version for {target.Role}.",
                    null));
            }

            return new RequirementResult(
                requirement.Id,
                requirement.TypeName,
                requirement.Required,
                RequirementStatus.Unknown,
                $"Version evidence is incomplete for {requirement.Description}.",
                JsonValue.CreateObject(
                [
                    new("dependencyVersion", OptionalString(dependency.Version)),
                    new("targetVersion", OptionalString(target.Witness.Version)),
                ]),
                [
                    Option(
                        requirement.Id,
                        "fetch-all-version-metadata",
                        "Fetch every missing version needed for this comparison.",
                        actions),
                ]);
        }

        if (!string.Equals(dependency.Version, target.Witness.Version, StringComparison.Ordinal))
        {
            return new RequirementResult(
                requirement.Id,
                requirement.TypeName,
                requirement.Required,
                RequirementStatus.Violated,
                $"{requirement.Description}: {dependency.Version} does not equal {target.Witness.Version}.",
                JsonValue.CreateObject(
                [
                    new("dependentRole", JsonValue.Create(dependent.Role)),
                    new("dependencyVersion", JsonValue.Create(dependency.Version)),
                    new("targetRole", JsonValue.Create(target.Role)),
                    new("targetVersion", JsonValue.Create(target.Witness.Version)),
                    new("relation", JsonValue.Create(DependencyWitness.Relation)),
                ]),
                [
                    Option(
                        requirement.Id,
                        "acquire-compatible-dependent",
                        "Acquire dependent evidence bound to the selected target version.",
                        [
                            Action(
                                AcquisitionActionType.AcquireCompatibleEvidence,
                                dependent,
                                dependent.Role,
                                $"Acquire {dependent.Role} evidence bound to {target.Witness.Version}.",
                                JsonValue.CreateObject(
                                [
                                    new("targetRole", JsonValue.Create(target.Role)),
                                    new("targetVersion", JsonValue.Create(target.Witness.Version)),
                                ])),
                        ]),
                    Option(
                        requirement.Id,
                        "refresh-target",
                        "Refresh the target before selecting compatible evidence.",
                        [
                            Action(
                                AcquisitionActionType.RefreshObservation,
                                target,
                                target.Role,
                                $"Refresh {target.Role} before selecting compatible evidence.",
                                JsonValue.CreateObject(
                                [
                                    new("dependentRole", JsonValue.Create(dependent.Role)),
                                    new("dependentVersion", JsonValue.Create(dependency.Version)),
                                ])),
                        ]),
                ]);
        }

        return new RequirementResult(
            requirement.Id,
            requirement.TypeName,
            requirement.Required,
            RequirementStatus.Satisfied,
            $"{requirement.Description}: both roles are bound to {dependency.Version}.",
            JsonValue.CreateObject(
            [
                new("dependentRole", JsonValue.Create(dependent.Role)),
                new("targetRole", JsonValue.Create(target.Role)),
                new("version", JsonValue.Create(dependency.Version)),
            ]),
            Array.Empty<AcquisitionOption>());
    }

    private static RequirementResult EvaluateCommonValidTime(
        CommonValidTimeRequirement requirement,
        IReadOnlyDictionary<string, Observation> observationsByRole)
    {
        var missingRoles = new List<string>();
        var present = new List<Observation>();
        var missingValidity = new List<Observation>();

        foreach (string role in requirement.Roles)
        {
            if (!observationsByRole.TryGetValue(role, out Observation? observation))
            {
                missingRoles.Add(role);
                continue;
            }

            present.Add(observation);
            if (observation.Witness.Validity is null)
            {
                missingValidity.Add(observation);
            }
        }

        JsonValue withinJson = IntervalJson(requirement.Within);
        var prerequisites = new List<AcquisitionAction>(missingRoles.Count + missingValidity.Count);
        foreach (string role in missingRoles)
        {
            prerequisites.Add(Action(
                AcquisitionActionType.RefreshObservation,
                null,
                role,
                $"Acquire an observation for role {role}.",
                null));
        }

        foreach (Observation observation in missingValidity)
        {
            prerequisites.Add(Action(
                AcquisitionActionType.FetchRequiredMetadata,
                observation,
                observation.Role,
                $"Fetch validity metadata for {observation.Role}.",
                JsonValue.CreateObject([new("within", withinJson)])));
        }

        NormalizedTimestamp latestStart = requirement.Within.From;
        NormalizedTimestamp? earliestEnd = requirement.Within.Until;
        foreach (Observation observation in present)
        {
            ValidityInterval? validity = observation.Witness.Validity;
            if (validity is null)
            {
                continue;
            }

            latestStart = NormalizedTimestamp.Max(latestStart, validity.From);
            if (validity.Until is NormalizedTimestamp end)
            {
                earliestEnd = earliestEnd is NormalizedTimestamp current
                    ? NormalizedTimestamp.Min(current, end)
                    : end;
            }
        }

        JsonValue rolesJson = StringArray(requirement.Roles);
        JsonValue missingRolesJson = StringArray(missingRoles);
        JsonValue missingValidityRolesJson = StringArray(missingValidity.Select(item => item.Role).ToArray());

        if (earliestEnd is NormalizedTimestamp bound && latestStart >= bound)
        {
            var options = new List<AcquisitionOption>(present.Count);
            foreach (Observation observation in present)
            {
                var actions = new List<AcquisitionAction>(1 + prerequisites.Count)
                {
                    Action(
                        AcquisitionActionType.RefreshObservation,
                        observation,
                        observation.Role,
                        $"Refresh {observation.Role} to seek a compatible validity window.",
                        JsonValue.CreateObject([new("within", withinJson)])),
                };
                actions.AddRange(prerequisites);

                options.Add(Option(
                    requirement.Id,
                    $"refresh-{observation.Role}",
                    $"Refresh {observation.Role} and acquire every other missing prerequisite.",
                    actions));
            }

            return new RequirementResult(
                requirement.Id,
                requirement.TypeName,
                requirement.Required,
                RequirementStatus.Violated,
                $"{requirement.Description}: the known validity intervals do not overlap.",
                JsonValue.CreateObject(
                [
                    new("roles", rolesJson),
                    new("latestStart", JsonValue.Create(latestStart.Text)),
                    new("earliestEnd", JsonValue.Create(bound.Text)),
                    new("missingRoles", missingRolesJson),
                    new("missingValidityRoles", missingValidityRolesJson),
                ]),
                options.ToArray());
        }

        JsonValue untilJson = earliestEnd is NormalizedTimestamp finish
            ? JsonValue.Create(finish.Text)
            : JsonValue.Null;

        if (missingRoles.Count > 0 || missingValidity.Count > 0)
        {
            return new RequirementResult(
                requirement.Id,
                requirement.TypeName,
                requirement.Required,
                RequirementStatus.Unknown,
                $"{requirement.Description}: validity evidence is incomplete.",
                JsonValue.CreateObject(
                [
                    new("roles", rolesJson),
                    new("missingRoles", missingRolesJson),
                    new("missingValidityRoles", missingValidityRolesJson),
                    new("possibleKnownWindow", JsonValue.CreateObject(
                    [
                        new("from", JsonValue.Create(latestStart.Text)),
                        new("until", untilJson),
                    ])),
                ]),
                [
                    Option(
                        requirement.Id,
                        "acquire-all-validity-prerequisites",
                        "Acquire every missing observation and validity witness.",
                        prerequisites),
                ]);
        }

        return new RequirementResult(
            requirement.Id,
            requirement.TypeName,
            requirement.Required,
            RequirementStatus.Satisfied,
            $"{requirement.Description}: a common valid time exists.",
            JsonValue.CreateObject(
            [
                new("roles", rolesJson),
                new("commonWindow", JsonValue.CreateObject(
                [
                    new("from", JsonValue.Create(latestStart.Text)),
                    new("until", untilJson),
                ])),
            ]),
            Array.Empty<AcquisitionOption>());
    }

    private static RequirementResult EvaluateValueEquals(
        ValueEqualsRequirement requirement,
        IReadOnlyDictionary<string, Observation> observationsByRole)
    {
        if (!observationsByRole.TryGetValue(requirement.Role, out Observation? observation))
        {
            return MissingRolesResult(requirement, [requirement.Role]);
        }

        string displayPath = string.Join(".", requirement.Path);
        JsonValue pathJson = StringArray(requirement.Path);

        if (!JsonPath.TryResolve(observation.Value, requirement.Path, out JsonValue? actual))
        {
            return new RequirementResult(
                requirement.Id,
                requirement.TypeName,
                requirement.Required,
                RequirementStatus.Unknown,
                $"{requirement.Description}: value path {displayPath} is missing.",
                JsonValue.CreateObject(
                [
                    new("role", JsonValue.Create(requirement.Role)),
                    new("path", pathJson),
                    new("expected", requirement.Expected),
                ]),
                [
                    Option(
                        requirement.Id,
                        "acquire-value",
                        "Acquire evidence containing the required value path.",
                        [
                            Action(
                                AcquisitionActionType.AcquireCompatibleEvidence,
                                observation,
                                observation.Role,
                                $"Acquire {observation.Role} evidence containing {displayPath}.",
                                JsonValue.CreateObject(
                                [
                                    new("path", pathJson),
                                    new("expected", requirement.Expected),
                                ])),
                        ]),
                ]);
        }

        if (!string.Equals(
                CanonicalJson.Serialize(actual),
                CanonicalJson.Serialize(requirement.Expected),
                StringComparison.Ordinal))
        {
            return new RequirementResult(
                requirement.Id,
                requirement.TypeName,
                requirement.Required,
                RequirementStatus.Violated,
                $"{requirement.Description}: observed value does not equal the required value.",
                JsonValue.CreateObject(
                [
                    new("role", JsonValue.Create(requirement.Role)),
                    new("path", pathJson),
                    new("expected", requirement.Expected),
                    new("actual", actual),
                ]),
                [
                    Option(
                        requirement.Id,
                        "refresh-value",
                        "Refresh the observation before evaluating the value again.",
                        [
                            Action(
                                AcquisitionActionType.RefreshObservation,
                                observation,
                                observation.Role,
                                $"Refresh {observation.Role} before evaluating {displayPath}.",
                                JsonValue.CreateObject(
                                [
                                    new("path", pathJson),
                                    new("expected", requirement.Expected),
                                ])),
                        ]),
                ]);
        }

        return new RequirementResult(
            requirement.Id,
            requirement.TypeName,
            requirement.Required,
            RequirementStatus.Satisfied,
            $"{requirement.Description}: observed value matches the requirement.",
            JsonValue.CreateObject(
            [
                new("role", JsonValue.Create(requirement.Role)),
                new("path", pathJson),
                new("expected", requirement.Expected),
            ]),
            Array.Empty<AcquisitionOption>());
    }

    private static RequirementResult MissingRolesResult(
        ContractRequirement requirement,
        List<string> roles)
    {
        var actions = new List<AcquisitionAction>(roles.Count);
        foreach (string role in roles)
        {
            actions.Add(Action(
                AcquisitionActionType.RefreshObservation,
                null,
                role,
                $"Acquire an observation for role {role}.",
                null));
        }

        return new RequirementResult(
            requirement.Id,
            requirement.TypeName,
            requirement.Required,
            RequirementStatus.Unknown,
            $"No observations are bound to required role(s): {string.Join(", ", roles)}.",
            JsonValue.CreateObject([new("missingRoles", StringArray(roles))]),
            [
                Option(
                    requirement.Id,
                    "acquire-missing-roles",
                    "Acquire every missing role required to evaluate this requirement.",
                    actions),
            ]);
    }

    private static AcquisitionAction Action(
        AcquisitionActionType type,
        Observation? observation,
        string role,
        string description,
        JsonValue? expected)
    {
        long cost;
        if (observation is null)
        {
            cost = 1;
        }
        else if (type == AcquisitionActionType.FetchRequiredMetadata)
        {
            cost = Math.Max(1, (observation.AcquisitionCost + 3) / 4);
        }
        else
        {
            cost = observation.AcquisitionCost;
        }

        string expectedDigest = expected is null
            ? "none"
            : CanonicalJson.ComputeSha256Hex(expected)[..12];

        return new AcquisitionAction(
            $"{LowercaseTypeName(type)}:{role}:{expectedDigest}",
            type,
            role,
            cost,
            description,
            expected);
    }

    private static AcquisitionOption Option(
        string requirementId,
        string suffix,
        string description,
        IReadOnlyList<AcquisitionAction> actions) =>
        new($"{requirementId}:{suffix}", description, actions.ToArray());

    private static string LowercaseTypeName(AcquisitionActionType type) => type switch
    {
        AcquisitionActionType.RefreshObservation => "refresh_observation",
        AcquisitionActionType.FetchRequiredMetadata => "fetch_required_metadata",
        AcquisitionActionType.AcquireCompatibleEvidence => "acquire_compatible_evidence",
        _ => throw new ArgumentOutOfRangeException(nameof(type)),
    };

    private static JsonValue ResourceJson(ResourceIdentity resource) => JsonValue.CreateObject(
    [
        new("provider", JsonValue.Create(resource.Provider)),
        new("account", JsonValue.Create(resource.Account)),
        new("kind", JsonValue.Create(resource.Kind)),
        new("key", JsonValue.Create(resource.Key)),
    ]);

    private static JsonValue IntervalJson(ValidityInterval interval) => JsonValue.CreateObject(
    [
        new("from", JsonValue.Create(interval.From.Text)),
        new("until", interval.Until is NormalizedTimestamp until
            ? JsonValue.Create(until.Text)
            : JsonValue.Null),
    ]);

    private static JsonValue OptionalString(string? value) =>
        value is null ? JsonValue.Null : JsonValue.Create(value);

    private static JsonValue StringArray(IReadOnlyList<string> values)
    {
        if (values.Count == 0)
        {
            return JsonValue.EmptyArray;
        }

        var items = new JsonValue[values.Count];
        for (int index = 0; index < values.Count; index++)
        {
            items[index] = JsonValue.Create(values[index]);
        }

        return JsonValue.CreateArrayOwned(items);
    }
}
