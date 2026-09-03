# WorldCut result construction 0.1

This document normatively defines verification-result construction for engine
ruleset `0.1.2`.

Text in backticks is literal. Template values are inserted without additional
escaping before normal JSON serialization.

## Common requirement fields

Every requirement result contains:

```text
requirementId   = requirement.id
requirementType = requirement.type
required        = requirement.required != false
status          = SATISFIED | VIOLATED | UNKNOWN
summary         = template defined below
details         = object defined below
acquisitionOptions = options defined below
```

Requirements are evaluated and returned in ascending UTF-16 code-unit order by
`requirement.id`.

## Acquisition actions

An acquisition action is constructed from:

```text
type
observation or null
role
description
expected JSON or null
```

All costs are non-negative integer units. An observation acquisition cost must
be a safe integer from 0 through 1,000,000,000.

An action cost is:

```text
observation is null                  -> 1
type == FETCH_REQUIRED_METADATA      -> max(1, ceil(observation.acquisitionCost / 4))
otherwise                            -> observation.acquisitionCost
```

Its expected digest component is:

```text
expected is null -> "none"
otherwise        -> first 12 lowercase hexadecimal characters of
                    SHA-256(canonical(expected))
```

Its ID is:

```text
lowercase(type) + ":" + role + ":" + expectedDigest
```

An acquisition option ID is:

```text
requirement.id + ":" + optionSuffix
```

## Missing roles

Missing roles are listed in the order in which the requirement references
them.

The common missing-role result is:

```text
status  = UNKNOWN
summary = "No observations are bound to required role(s): " +
          join(missingRoles, ", ") + "."
details = { "missingRoles": missingRoles }
```

It has one option:

```text
suffix      = "acquire-missing-roles"
description = "Acquire every missing role required to evaluate this requirement."
```

For each missing role, the option contains:

```text
type        = REFRESH_OBSERVATION
role        = missing role
description = "Acquire an observation for role " + role + "."
expected    = null
```

## Dependency results

The missing-role order is `dependentRole`, then `targetRole`.

### Missing dependency witness

```text
status  = UNKNOWN
summary = dependentRole + " does not expose dependency " +
          dependencyName + "."
details = {
  "dependentRole": dependentRole,
  "targetRole": targetRole,
  "missingDependency": dependencyName
}
```

Option:

```text
suffix      = "fetch-dependency-metadata"
description = "Fetch all metadata required to compare the dependency."
```

First action:

```text
type        = FETCH_REQUIRED_METADATA
role        = dependentRole
description = "Fetch dependency metadata for " + dependentRole + "."
expected    = {
  "dependencyName": dependencyName,
  "targetResource": target.resource
}
```

If the target observation lacks a version, append:

```text
type        = FETCH_REQUIRED_METADATA
role        = targetRole
description = "Fetch the resource version for " + targetRole + "."
expected    = null
```

### Different resource identity

```text
status  = VIOLATED
summary = dependentRole + " is bound to a different resource than " +
          targetRole + "."
details = {
  "dependentResource": dependency.resource,
  "targetResource": target.resource
}
```

Option:

```text
suffix      = "acquire-compatible-resource"
description = "Acquire dependent evidence bound to the selected target resource."
```

Action:

```text
type        = ACQUIRE_COMPATIBLE_EVIDENCE
role        = dependentRole
description = "Acquire " + dependentRole + " evidence for the selected " +
              targetRole + " resource."
expected    = { "targetResource": target.resource }
```

### Missing version

```text
status  = UNKNOWN
summary = "Version evidence is incomplete for " +
          requirement.description + "."
details = {
  "dependencyVersion": dependency.version or null,
  "targetVersion": target.version or null
}
```

Option:

```text
suffix      = "fetch-all-version-metadata"
description = "Fetch every missing version needed for this comparison."
```

For each missing version, append the corresponding
`FETCH_REQUIRED_METADATA` action in dependent-then-target order.

Dependent action:

```text
description = "Fetch the dependency version for " + dependentRole + "."
expected    = { "dependencyName": dependencyName }
```

Target action:

```text
description = "Fetch the resource version for " + targetRole + "."
expected    = null
```

### Version mismatch

```text
status  = VIOLATED
summary = requirement.description + ": " + dependency.version +
          " does not equal " + target.version + "."
details = {
  "dependentRole": dependentRole,
  "dependencyVersion": dependency.version,
  "targetRole": targetRole,
  "targetVersion": target.version,
  "relation": "exact"
}
```

Option 1:

```text
suffix      = "acquire-compatible-dependent"
description = "Acquire dependent evidence bound to the selected target version."
action.type = ACQUIRE_COMPATIBLE_EVIDENCE
action.role = dependentRole
action.description =
  "Acquire " + dependentRole + " evidence bound to " + target.version + "."
action.expected = {
  "targetRole": targetRole,
  "targetVersion": target.version
}
```

Option 2:

```text
suffix      = "refresh-target"
description = "Refresh the target before selecting compatible evidence."
action.type = REFRESH_OBSERVATION
action.role = targetRole
action.description =
  "Refresh " + targetRole + " before selecting compatible evidence."
action.expected = {
  "dependentRole": dependentRole,
  "dependentVersion": dependency.version
}
```

### Satisfied dependency

```text
status  = SATISFIED
summary = requirement.description + ": both roles are bound to " +
          dependency.version + "."
details = {
  "dependentRole": dependentRole,
  "targetRole": targetRole,
  "version": dependency.version
}
acquisitionOptions = []
```

## Common-valid-time results

`missingRoles` follows `requirement.roles` order. `observations` and
`missingValidityRoles` also follow that order.

Prerequisite actions are ordered as:

1. one `REFRESH_OBSERVATION` action per missing role;
2. one `FETCH_REQUIRED_METADATA` action per present role missing validity.

The validity metadata action is:

```text
description = "Fetch validity metadata for " + role + "."
expected    = { "within": requirement.within }
```

### Known empty intersection

```text
status  = VIOLATED
summary = requirement.description +
          ": the known validity intervals do not overlap."
details = {
  "roles": requirement.roles,
  "latestStart": normalized timestamp,
  "earliestEnd": normalized timestamp or null,
  "missingRoles": missingRoles,
  "missingValidityRoles": missingValidityRoles
}
```

There is one option per present observation:

```text
suffix      = "refresh-" + role
description = "Refresh " + role +
              " and acquire every other missing prerequisite."
```

The option begins with:

```text
type        = REFRESH_OBSERVATION
role        = role
description = "Refresh " + role +
              " to seek a compatible validity window."
expected    = { "within": requirement.within }
```

Append all prerequisite actions after that action.

### Incomplete validity evidence

```text
status  = UNKNOWN
summary = requirement.description + ": validity evidence is incomplete."
details = {
  "roles": requirement.roles,
  "missingRoles": missingRoles,
  "missingValidityRoles": missingValidityRoles,
  "possibleKnownWindow": {
    "from": normalized timestamp,
    "until": normalized timestamp or null
  }
}
```

One option:

```text
suffix      = "acquire-all-validity-prerequisites"
description = "Acquire every missing observation and validity witness."
actions     = all prerequisite actions
```

### Satisfied common time

```text
status  = SATISFIED
summary = requirement.description + ": a common valid time exists."
details = {
  "roles": requirement.roles,
  "commonWindow": {
    "from": normalized timestamp,
    "until": normalized timestamp or null
  }
}
acquisitionOptions = []
```

## Value-equals results

The display path is `join(path, ".")`.

### Missing role

Use the common missing-role result.

### Missing path

```text
status  = UNKNOWN
summary = requirement.description + ": value path " + displayPath +
          " is missing."
details = {
  "role": role,
  "path": path,
  "expected": expected
}
```

Option:

```text
suffix      = "acquire-value"
description = "Acquire evidence containing the required value path."
action.type = ACQUIRE_COMPATIBLE_EVIDENCE
action.role = role
action.description =
  "Acquire " + role + " evidence containing " + displayPath + "."
action.expected = {
  "path": path,
  "expected": expected
}
```

### Unequal value

```text
status  = VIOLATED
summary = requirement.description +
          ": observed value does not equal the required value."
details = {
  "role": role,
  "path": path,
  "expected": expected,
  "actual": actual
}
```

Option:

```text
suffix      = "refresh-value"
description = "Refresh the observation before evaluating the value again."
action.type = REFRESH_OBSERVATION
action.role = role
action.description =
  "Refresh " + role + " before evaluating " + displayPath + "."
action.expected = {
  "path": path,
  "expected": expected
}
```

### Equal value

```text
status  = SATISFIED
summary = requirement.description +
          ": observed value matches the requirement."
details = {
  "role": role,
  "path": path,
  "expected": expected
}
acquisitionOptions = []
```

## Acquisition plan

Only required results whose status is not `SATISFIED` participate.

If none participate:

```json
{
  "status": "NOT_NEEDED",
  "reason": null,
  "actions": [],
  "selectedOptionIds": [],
  "totalCost": 0,
  "coveredRequirementIds": [],
  "unresolvedRequirementIds": []
}
```

Requirements are sorted by requirement ID before planning. Options are sorted
by option ID. Distinct actions are keyed by action ID. Reusing an action ID
with a different cost is an internal error.

The exact bounded search and tie-breaking rules are defined in
[PROTOCOL.md](PROTOCOL.md).

For a complete exact solution:

```text
status               = AVAILABLE
reason               = null
actions              = distinct selected actions sorted by action ID
selectedOptionIds    = selected option IDs sorted by UTF-16 code units
totalCost            = sum of distinct action costs
coveredRequirementIds = requirements having at least one option
unresolvedRequirementIds = []
```

If one or more requirements have no option, retain the exact solution for
coverable requirements and return:

```text
status = INCOMPLETE
reason = "No acquisition option is available for: " +
         join(unresolvedRequirementIds, ", ") + "."
```

If a search limit prevents exact optimization, return an empty `INCOMPLETE`
plan with all participating requirement IDs unresolved.

The exact requirement-limit reason is:

```text
Acquisition planning supports at most 64 unresolved requirements.
```

The exact combination-limit reason is:

```text
Acquisition search exceeds the 65536 combination limit.
```

The defensive search-state limit is 4,259,840:

```text
Acquisition search exceeds the 4259840 state limit.
```

No valid search satisfying the preceding requirement and combination caps
should reach the defensive state limit. Reaching it indicates that exact
optimality was not established and still requires an empty `INCOMPLETE` plan.

The requirement and combination paths are locked by
`planner-requirement-limit` and `planner-combination-limit` conformance vectors.

## Coverage and aggregate result

Coverage counts are:

```text
required  = number of required results
satisfied = required results with SATISFIED
violated  = required results with VIOLATED
unknown   = required results with UNKNOWN
advisory  = total results - required
```

The top-level result contains:

```text
protocolVersion = input.protocolVersion
engineVersion   = "0.1.2"
canonicalization = "worldcut-json-v1"
contractId      = input.contract.id
contractVersion = input.contract.version
verdict
coverage
requirementResults
acquisitionPlan
verificationRecordDigest
```

## Digest preimage

The SHA-256 preimage is the UTF-8 `worldcut-json-v1` canonicalization of exactly:

```json
{
  "protocolVersion": "<input protocolVersion>",
  "engineVersion": "0.1.2",
  "canonicalization": "worldcut-json-v1",
  "contract": "<complete input contract with requirements sorted by id>",
  "observations": "<complete observations sorted by role>",
  "verdict": "<aggregate verdict>",
  "requirementResults": "<sorted complete requirement results>",
  "acquisitionPlan": "<complete acquisition plan>"
}
```

The preimage does not separately include top-level `coverage`, `contractId`, or
`contractVersion`; the complete contract already includes its ID and version.
