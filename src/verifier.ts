import { selectAcquisitionPlan } from "./acquisition-plan.js";
import {
  canonicalJson,
  compareCanonicalText,
  sha256Digest,
  snapshotJsonData,
} from "./canonical.js";
import { sameResourceIdentity } from "./resource.js";
import { WorldCutInputError } from "./errors.js";
import { MAX_ACQUISITION_COST } from "./limits.js";
import type {
  AcquisitionAction,
  AcquisitionOption,
  CoherenceContract,
  CommonValidTimeRequirement,
  ContractRequirement,
  DependencyRequirement,
  JsonValue,
  Observation,
  RequirementResult,
  ResourceIdentity,
  VerificationInput,
  VerificationResult,
  ValueEqualsRequirement,
  WitnessProvenance,
} from "./types.js";

const ENGINE_VERSION = "0.1.2";
const PROVENANCE_VALUES = new Set<WitnessProvenance>([
  "provider_asserted",
  "client_observed",
  "derived",
  "operator_supplied",
]);

function requireRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${field} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  field: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(
      `${field} contains unsupported field(s): ${unknown.join(", ")}`,
    );
  }
}

function assertRequiredKeys(
  value: Record<string, unknown>,
  requiredKeys: string[],
  field: string,
): void {
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) {
    throw new TypeError(
      `${field} is missing required field(s): ${missing.join(", ")}`,
    );
  }
}

function parseTimestamp(value: string, field: string): number {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a normalized ISO-8601 timestamp`);
  }
  const parsed = Date.parse(value);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new TypeError(
      `${field} must use normalized ISO-8601 UTC form with milliseconds`,
    );
  }
  return parsed;
}

function resourceJson(resource: ResourceIdentity): JsonValue {
  return {
    provider: resource.provider,
    account: resource.account,
    kind: resource.kind,
    key: resource.key,
  };
}

function intervalJson(
  interval: CommonValidTimeRequirement["within"],
): JsonValue {
  return {
    from: interval.from,
    until: interval.until,
  };
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
}

function validateResource(resource: ResourceIdentity, field: string): void {
  const record = requireRecord(resource, field);
  assertExactKeys(record, ["provider", "account", "kind", "key"], field);
  assertRequiredKeys(record, ["provider", "account", "kind", "key"], field);
  requireNonEmpty(resource.provider, `${field}.provider`);
  requireNonEmpty(resource.account, `${field}.account`);
  requireNonEmpty(resource.kind, `${field}.kind`);
  requireNonEmpty(resource.key, `${field}.key`);
}

function validateProvenance(
  provenance: WitnessProvenance,
  field: string,
): void {
  if (!PROVENANCE_VALUES.has(provenance)) {
    throw new TypeError(`${field} is not a supported provenance category`);
  }
}

function validateInterval(
  from: string,
  until: string | null,
  field: string,
): void {
  const start = parseTimestamp(from, `${field}.from`);
  if (until === null) {
    return;
  }
  const end = parseTimestamp(until, `${field}.until`);
  if (end <= start) {
    throw new RangeError(`${field} must be a non-empty half-open interval`);
  }
}

function validateInput(input: unknown): VerificationInput {
  const snapshot = snapshotJsonData(input, "input") as VerificationInput;
  const inputRecord = requireRecord(snapshot, "input");
  assertExactKeys(
    inputRecord,
    ["protocolVersion", "contract", "observations"],
    "input",
  );
  assertRequiredKeys(
    inputRecord,
    ["protocolVersion", "contract", "observations"],
    "input",
  );
  if (snapshot.protocolVersion !== "0.1") {
    throw new TypeError("input.protocolVersion must equal 0.1");
  }
  const contractRecord = requireRecord(snapshot.contract, "contract");
  assertExactKeys(
    contractRecord,
    ["id", "version", "decisionTime", "assumptions", "requirements"],
    "contract",
  );
  assertRequiredKeys(
    contractRecord,
    ["id", "version", "decisionTime", "assumptions", "requirements"],
    "contract",
  );
  if (!Array.isArray(snapshot.observations)) {
    throw new TypeError("observations must be an array");
  }
  if (!Array.isArray(snapshot.contract.requirements)) {
    throw new TypeError("contract.requirements must be an array");
  }

  requireNonEmpty(snapshot.contract.id, "contract.id");
  requireNonEmpty(snapshot.contract.version, "contract.version");
  const decisionTime = parseTimestamp(
    snapshot.contract.decisionTime,
    "contract.decisionTime",
  );
  const assumptionsRecord = requireRecord(
    snapshot.contract.assumptions,
    "contract.assumptions",
  );
  assertExactKeys(
    assumptionsRecord,
    ["clockModel", "intervalModel", "metadataModel"],
    "contract.assumptions",
  );
  assertRequiredKeys(
    assumptionsRecord,
    ["clockModel", "intervalModel", "metadataModel"],
    "contract.assumptions",
  );
  if (
    snapshot.contract.assumptions.clockModel !== "trusted_normalized" ||
    snapshot.contract.assumptions.intervalModel !== "half_open" ||
    snapshot.contract.assumptions.metadataModel !==
      "honest_but_possibly_incomplete"
  ) {
    throw new TypeError("contract assumptions are not supported by this engine");
  }

  const observationIds = new Set<string>();
  const roles = new Set<string>();
  for (const observation of snapshot.observations) {
    const observationRecord = requireRecord(observation, "observation");
    assertExactKeys(
      observationRecord,
      [
        "id",
        "role",
        "resource",
        "value",
        "observedAt",
        "acquisitionCost",
        "witness",
      ],
      "observation",
    );
    assertRequiredKeys(
      observationRecord,
      [
        "id",
        "role",
        "resource",
        "value",
        "observedAt",
        "acquisitionCost",
        "witness",
      ],
      "observation",
    );
    const witnessRecord = requireRecord(
      observation.witness,
      `${observation.role}.witness`,
    );
    assertExactKeys(
      witnessRecord,
      ["provenance", "version", "validity", "dependencies"],
      `${observation.role}.witness`,
    );
    assertRequiredKeys(
      witnessRecord,
      ["provenance"],
      `${observation.role}.witness`,
    );
    requireNonEmpty(observation.id, "observation.id");
    requireNonEmpty(observation.role, "observation.role");
    if (observationIds.has(observation.id)) {
      throw new TypeError(`Duplicate observation id: ${observation.id}`);
    }
    if (roles.has(observation.role)) {
      throw new TypeError(`Duplicate observation role: ${observation.role}`);
    }
    observationIds.add(observation.id);
    roles.add(observation.role);

    validateResource(observation.resource, `${observation.role}.resource`);
    const observedAt = parseTimestamp(
      observation.observedAt,
      `${observation.role}.observedAt`,
    );
    if (observedAt > decisionTime) {
      throw new RangeError(
        `${observation.role}.observedAt must not be after contract.decisionTime`,
      );
    }
    if (
      !Number.isFinite(observation.acquisitionCost) ||
      !Number.isSafeInteger(observation.acquisitionCost) ||
      observation.acquisitionCost < 0 ||
      observation.acquisitionCost > MAX_ACQUISITION_COST
    ) {
      throw new RangeError(
        `${observation.role}.acquisitionCost must be between 0 and ${MAX_ACQUISITION_COST}`,
      );
    }
    validateProvenance(
      observation.witness.provenance,
      `${observation.role}.witness.provenance`,
    );
    if (observation.witness.version !== undefined) {
      requireNonEmpty(
        observation.witness.version,
        `${observation.role}.witness.version`,
      );
    }
    if (Object.hasOwn(witnessRecord, "validity")) {
      const validity = observation.witness.validity;
      if (validity === undefined) {
        throw new TypeError(
          `${observation.role}.witness.validity must be a plain object`,
        );
      }
      const validityRecord = requireRecord(
        validity,
        `${observation.role}.witness.validity`,
      );
      assertExactKeys(
        validityRecord,
        ["from", "until"],
        `${observation.role}.witness.validity`,
      );
      assertRequiredKeys(
        validityRecord,
        ["from", "until"],
        `${observation.role}.witness.validity`,
      );
      validateInterval(
        validity.from,
        validity.until,
        `${observation.role}.witness.validity`,
      );
    }

    if (
      Object.hasOwn(witnessRecord, "dependencies") &&
      !Array.isArray(observation.witness.dependencies)
    ) {
      throw new TypeError(
        `${observation.role}.witness.dependencies must be an array`,
      );
    }
    const dependencyNames = new Set<string>();
    for (const dependency of observation.witness.dependencies ?? []) {
      const dependencyRecord = requireRecord(
        dependency,
        `${observation.role}.dependency`,
      );
      assertExactKeys(
        dependencyRecord,
        ["name", "resource", "relation", "version", "provenance"],
        `${observation.role}.dependency`,
      );
      assertRequiredKeys(
        dependencyRecord,
        ["name", "resource", "relation", "provenance"],
        `${observation.role}.dependency`,
      );
      requireNonEmpty(dependency.name, "dependency.name");
      if (dependencyNames.has(dependency.name)) {
        throw new TypeError(
          `Duplicate dependency ${dependency.name} on role ${observation.role}`,
        );
      }
      dependencyNames.add(dependency.name);
      validateResource(
        dependency.resource,
        `${observation.role}.dependency.${dependency.name}.resource`,
      );
      if (dependency.relation !== "exact") {
        throw new TypeError(
          `${observation.role}.dependency.${dependency.name}.relation is unsupported`,
        );
      }
      if (dependency.version !== undefined) {
        requireNonEmpty(
          dependency.version,
          `${observation.role}.dependency.${dependency.name}.version`,
        );
      }
      validateProvenance(
        dependency.provenance,
        `${observation.role}.dependency.${dependency.name}.provenance`,
      );
    }
  }

  const requirementIds = new Set<string>();
  let requiredCount = 0;
  for (const requirement of snapshot.contract.requirements) {
    const requirementRecord = requireRecord(requirement, "requirement");
    assertRequiredKeys(
      requirementRecord,
      ["id", "description", "type"],
      "requirement",
    );
    requireNonEmpty(requirement.id, "requirement.id");
    requireNonEmpty(requirement.description, `${requirement.id}.description`);
    if (
      requirement.required !== undefined &&
      typeof requirement.required !== "boolean"
    ) {
      throw new TypeError(`${requirement.id}.required must be boolean`);
    }
    if (requirementIds.has(requirement.id)) {
      throw new TypeError(`Duplicate requirement id: ${requirement.id}`);
    }
    requirementIds.add(requirement.id);
    if (requirement.required !== false) {
      requiredCount += 1;
    }

    const runtimeType = (requirement as { type?: unknown }).type;
    if (runtimeType === "dependency") {
      assertExactKeys(
        requirementRecord,
        [
          "id",
          "description",
          "required",
          "type",
          "dependentRole",
          "targetRole",
          "dependencyName",
        ],
        requirement.id,
      );
      assertRequiredKeys(
        requirementRecord,
        ["dependentRole", "targetRole", "dependencyName"],
        requirement.id,
      );
      const dependencyRequirement = requirement as DependencyRequirement;
      requireNonEmpty(
        dependencyRequirement.dependentRole,
        `${requirement.id}.dependentRole`,
      );
      requireNonEmpty(
        dependencyRequirement.targetRole,
        `${requirement.id}.targetRole`,
      );
      requireNonEmpty(
        dependencyRequirement.dependencyName,
        `${requirement.id}.dependencyName`,
      );
      continue;
    }
    if (runtimeType === "common_valid_time") {
      assertExactKeys(
        requirementRecord,
        [
          "id",
          "description",
          "required",
          "type",
          "roles",
          "within",
        ],
        requirement.id,
      );
      assertRequiredKeys(
        requirementRecord,
        ["roles", "within"],
        requirement.id,
      );
      const temporalRequirement = requirement as CommonValidTimeRequirement;
      if (!Array.isArray(temporalRequirement.roles)) {
        throw new TypeError(`${requirement.id}.roles must be an array`);
      }
      if (temporalRequirement.roles.length < 2) {
        throw new RangeError(
          `${requirement.id} must reference at least two roles`,
        );
      }
      const distinctRoles = new Set<string>();
      for (const role of temporalRequirement.roles) {
        requireNonEmpty(role, `${requirement.id}.role`);
        if (distinctRoles.has(role)) {
          throw new TypeError(
            `${requirement.id} contains duplicate role ${role}`,
          );
        }
        distinctRoles.add(role);
      }
      const withinRecord = requireRecord(
        temporalRequirement.within,
        `${requirement.id}.within`,
      );
      assertExactKeys(
        withinRecord,
        ["from", "until"],
        `${requirement.id}.within`,
      );
      assertRequiredKeys(
        withinRecord,
        ["from", "until"],
        `${requirement.id}.within`,
      );
      validateInterval(
        temporalRequirement.within.from,
        temporalRequirement.within.until,
        `${requirement.id}.within`,
      );
      continue;
    }
    if (runtimeType === "value_equals") {
      assertExactKeys(
        requirementRecord,
        ["id", "description", "required", "type", "role", "path", "expected"],
        requirement.id,
      );
      assertRequiredKeys(
        requirementRecord,
        ["role", "path", "expected"],
        requirement.id,
      );
      const valueRequirement = requirement as ValueEqualsRequirement;
      requireNonEmpty(valueRequirement.role, `${requirement.id}.role`);
      if (!Array.isArray(valueRequirement.path)) {
        throw new TypeError(`${requirement.id}.path must be an array`);
      }
      if (valueRequirement.path.length === 0) {
        throw new RangeError(
          `${requirement.id}.path must contain at least one segment`,
        );
      }
      for (const segment of valueRequirement.path) {
        requireNonEmpty(segment, `${requirement.id}.path segment`);
      }
      continue;
    }
    throw new TypeError(`Unsupported requirement type: ${String(runtimeType)}`);
  }

  if (requiredCount === 0) {
    throw new RangeError(
      "A decision contract must contain at least one required requirement",
    );
  }
  return snapshot;
}

function valueAtPath(
  value: JsonValue,
  path: string[],
): { found: boolean; value: JsonValue | null } {
  let current: JsonValue = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
        return { found: false, value: null };
      }
      const index = Number(segment);
      if (
        !Number.isSafeInteger(index) ||
        index >= current.length ||
        !Object.hasOwn(current, index)
      ) {
        return { found: false, value: null };
      }
      const next = current[index];
      if (next === undefined) {
        return { found: false, value: null };
      }
      current = next;
      continue;
    }
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return { found: false, value: null };
    }
    const next = (current as Record<string, JsonValue>)[segment];
    if (next === undefined) {
      return { found: false, value: null };
    }
    current = next;
  }
  return { found: true, value: current };
}

function acquisitionAction(
  type: AcquisitionAction["type"],
  observation: Observation | null,
  role: string,
  description: string,
  expected: JsonValue | null,
): AcquisitionAction {
  const cost =
    observation === null
      ? 1
      : type === "FETCH_REQUIRED_METADATA"
        ? Math.max(1, Math.ceil(observation.acquisitionCost / 4))
        : observation.acquisitionCost;
  const expectedDigest =
    expected === null ? "none" : sha256Digest(expected).slice(0, 12);
  return {
    id: `${type.toLowerCase()}:${role}:${expectedDigest}`,
    type,
    role,
    cost,
    description,
    expected,
  };
}

function acquisitionOption(
  requirementId: string,
  suffix: string,
  description: string,
  actions: AcquisitionAction[],
): AcquisitionOption {
  return {
    id: `${requirementId}:${suffix}`,
    description,
    actions,
  };
}

function missingRolesResult(
  requirement: ContractRequirement,
  roles: string[],
): RequirementResult {
  const actions = roles.map((role) =>
    acquisitionAction(
      "REFRESH_OBSERVATION",
      null,
      role,
      `Acquire an observation for role ${role}.`,
      null,
    ),
  );
  return {
    requirementId: requirement.id,
    requirementType: requirement.type,
    required: requirement.required !== false,
    status: "UNKNOWN",
    summary: `No observations are bound to required role(s): ${roles.join(", ")}.`,
    details: { missingRoles: roles },
    acquisitionOptions: [
      acquisitionOption(
        requirement.id,
        "acquire-missing-roles",
        "Acquire every missing role required to evaluate this requirement.",
        actions,
      ),
    ],
  };
}

function evaluateDependency(
  requirement: DependencyRequirement,
  observationsByRole: Map<string, Observation>,
): RequirementResult {
  const missingRoles = [
    requirement.dependentRole,
    requirement.targetRole,
  ].filter((role) => !observationsByRole.has(role));
  if (missingRoles.length > 0) {
    return missingRolesResult(requirement, missingRoles);
  }
  const dependent = observationsByRole.get(requirement.dependentRole);
  const target = observationsByRole.get(requirement.targetRole);
  if (!dependent || !target) {
    throw new Error("Validated dependency roles disappeared");
  }

  const dependency = (dependent.witness.dependencies ?? []).find(
    (candidate) => candidate.name === requirement.dependencyName,
  );
  if (!dependency) {
    const actions = [
      acquisitionAction(
        "FETCH_REQUIRED_METADATA",
        dependent,
        dependent.role,
        `Fetch dependency metadata for ${dependent.role}.`,
        {
          dependencyName: requirement.dependencyName,
          targetResource: resourceJson(target.resource),
        },
      ),
    ];
    if (!target.witness.version) {
      actions.push(
        acquisitionAction(
          "FETCH_REQUIRED_METADATA",
          target,
          target.role,
          `Fetch the resource version for ${target.role}.`,
          null,
        ),
      );
    }
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      required: requirement.required !== false,
      status: "UNKNOWN",
      summary: `${dependent.role} does not expose dependency ${requirement.dependencyName}.`,
      details: {
        dependentRole: dependent.role,
        targetRole: target.role,
        missingDependency: requirement.dependencyName,
      },
      acquisitionOptions: [
        acquisitionOption(
          requirement.id,
          "fetch-dependency-metadata",
          "Fetch all metadata required to compare the dependency.",
          actions,
        ),
      ],
    };
  }

  if (!sameResourceIdentity(dependency.resource, target.resource)) {
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      required: requirement.required !== false,
      status: "VIOLATED",
      summary: `${dependent.role} is bound to a different resource than ${target.role}.`,
      details: {
        dependentResource: resourceJson(dependency.resource),
        targetResource: resourceJson(target.resource),
      },
      acquisitionOptions: [
        acquisitionOption(
          requirement.id,
          "acquire-compatible-resource",
          "Acquire dependent evidence bound to the selected target resource.",
          [
            acquisitionAction(
              "ACQUIRE_COMPATIBLE_EVIDENCE",
              dependent,
              dependent.role,
              `Acquire ${dependent.role} evidence for the selected ${target.role} resource.`,
              { targetResource: resourceJson(target.resource) },
            ),
          ],
        ),
      ],
    };
  }

  if (!dependency.version || !target.witness.version) {
    const actions: AcquisitionAction[] = [];
    if (!dependency.version) {
      actions.push(
        acquisitionAction(
          "FETCH_REQUIRED_METADATA",
          dependent,
          dependent.role,
          `Fetch the dependency version for ${dependent.role}.`,
          { dependencyName: requirement.dependencyName },
        ),
      );
    }
    if (!target.witness.version) {
      actions.push(
        acquisitionAction(
          "FETCH_REQUIRED_METADATA",
          target,
          target.role,
          `Fetch the resource version for ${target.role}.`,
          null,
        ),
      );
    }
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      required: requirement.required !== false,
      status: "UNKNOWN",
      summary: `Version evidence is incomplete for ${requirement.description}.`,
      details: {
        dependencyVersion: dependency.version ?? null,
        targetVersion: target.witness.version ?? null,
      },
      acquisitionOptions: [
        acquisitionOption(
          requirement.id,
          "fetch-all-version-metadata",
          "Fetch every missing version needed for this comparison.",
          actions,
        ),
      ],
    };
  }

  if (dependency.version !== target.witness.version) {
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      required: requirement.required !== false,
      status: "VIOLATED",
      summary: `${requirement.description}: ${dependency.version} does not equal ${target.witness.version}.`,
      details: {
        dependentRole: dependent.role,
        dependencyVersion: dependency.version,
        targetRole: target.role,
        targetVersion: target.witness.version,
        relation: dependency.relation,
      },
      acquisitionOptions: [
        acquisitionOption(
          requirement.id,
          "acquire-compatible-dependent",
          "Acquire dependent evidence bound to the selected target version.",
          [
            acquisitionAction(
              "ACQUIRE_COMPATIBLE_EVIDENCE",
              dependent,
              dependent.role,
              `Acquire ${dependent.role} evidence bound to ${target.witness.version}.`,
              {
                targetRole: target.role,
                targetVersion: target.witness.version,
              },
            ),
          ],
        ),
        acquisitionOption(
          requirement.id,
          "refresh-target",
          "Refresh the target before selecting compatible evidence.",
          [
            acquisitionAction(
              "REFRESH_OBSERVATION",
              target,
              target.role,
              `Refresh ${target.role} before selecting compatible evidence.`,
              {
                dependentRole: dependent.role,
                dependentVersion: dependency.version,
              },
            ),
          ],
        ),
      ],
    };
  }

  return {
    requirementId: requirement.id,
    requirementType: requirement.type,
    required: requirement.required !== false,
    status: "SATISFIED",
    summary: `${requirement.description}: both roles are bound to ${dependency.version}.`,
    details: {
      dependentRole: dependent.role,
      targetRole: target.role,
      version: dependency.version,
    },
    acquisitionOptions: [],
  };
}

function evaluateCommonValidTime(
  requirement: CommonValidTimeRequirement,
  observationsByRole: Map<string, Observation>,
): RequirementResult {
  const missingRoles = requirement.roles.filter(
    (role) => !observationsByRole.has(role),
  );
  const observations = requirement.roles
    .map((role) => observationsByRole.get(role))
    .filter((observation): observation is Observation =>
      Boolean(observation),
    );
  const missingValidity = observations.filter(
    (observation) => !observation.witness.validity,
  );
  const prerequisiteActions = [
    ...missingRoles.map((role) =>
      acquisitionAction(
        "REFRESH_OBSERVATION",
        null,
        role,
        `Acquire an observation for role ${role}.`,
        null,
      ),
    ),
    ...missingValidity.map((observation) =>
      acquisitionAction(
        "FETCH_REQUIRED_METADATA",
        observation,
        observation.role,
        `Fetch validity metadata for ${observation.role}.`,
        { within: intervalJson(requirement.within) },
      ),
    ),
  ];

  const windowStart = parseTimestamp(
    requirement.within.from,
    `${requirement.id}.within.from`,
  );
  const windowEnd =
    requirement.within.until === null
      ? Number.POSITIVE_INFINITY
      : parseTimestamp(
          requirement.within.until,
          `${requirement.id}.within.until`,
        );
  let latestStart = windowStart;
  let earliestEnd = windowEnd;

  for (const observation of observations) {
    const validity = observation.witness.validity;
    if (!validity) {
      continue;
    }

    latestStart = Math.max(
      latestStart,
      parseTimestamp(validity.from, `${observation.role}.validity.from`),
    );
    earliestEnd = Math.min(
      earliestEnd,
      validity.until === null
        ? Number.POSITIVE_INFINITY
        : parseTimestamp(
            validity.until,
            `${observation.role}.validity.until`,
          ),
    );
  }

  if (latestStart >= earliestEnd) {
    const refreshOptions = observations.map((observation) =>
      acquisitionOption(
        requirement.id,
        `refresh-${observation.role}`,
        `Refresh ${observation.role} and acquire every other missing prerequisite.`,
        [
          acquisitionAction(
            "REFRESH_OBSERVATION",
            observation,
            observation.role,
            `Refresh ${observation.role} to seek a compatible validity window.`,
            { within: intervalJson(requirement.within) },
          ),
          ...prerequisiteActions,
        ],
      ),
    );
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      required: requirement.required !== false,
      status: "VIOLATED",
      summary: `${requirement.description}: the known validity intervals do not overlap.`,
      details: {
        roles: requirement.roles,
        latestStart: new Date(latestStart).toISOString(),
        earliestEnd: Number.isFinite(earliestEnd)
          ? new Date(earliestEnd).toISOString()
          : null,
        missingRoles,
        missingValidityRoles: missingValidity.map(
          (observation) => observation.role,
        ),
      },
      acquisitionOptions: refreshOptions,
    };
  }

  if (missingRoles.length > 0 || missingValidity.length > 0) {
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      required: requirement.required !== false,
      status: "UNKNOWN",
      summary: `${requirement.description}: validity evidence is incomplete.`,
      details: {
        roles: requirement.roles,
        missingRoles,
        missingValidityRoles: missingValidity.map(
          (observation) => observation.role,
        ),
        possibleKnownWindow: {
          from: new Date(latestStart).toISOString(),
          until: Number.isFinite(earliestEnd)
            ? new Date(earliestEnd).toISOString()
            : null,
        },
      },
      acquisitionOptions: [
        acquisitionOption(
          requirement.id,
          "acquire-all-validity-prerequisites",
          "Acquire every missing observation and validity witness.",
          prerequisiteActions,
        ),
      ],
    };
  }

  return {
    requirementId: requirement.id,
    requirementType: requirement.type,
    required: requirement.required !== false,
    status: "SATISFIED",
    summary: `${requirement.description}: a common valid time exists.`,
    details: {
      roles: requirement.roles,
      commonWindow: {
        from: new Date(latestStart).toISOString(),
        until: Number.isFinite(earliestEnd)
          ? new Date(earliestEnd).toISOString()
          : null,
      },
    },
    acquisitionOptions: [],
  };
}

function evaluateValueEquals(
  requirement: ValueEqualsRequirement,
  observationsByRole: Map<string, Observation>,
): RequirementResult {
  const observation = observationsByRole.get(requirement.role);
  if (!observation) {
    return missingRolesResult(requirement, [requirement.role]);
  }
  const actual = valueAtPath(observation.value, requirement.path);
  if (!actual.found) {
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      required: requirement.required !== false,
      status: "UNKNOWN",
      summary: `${requirement.description}: value path ${requirement.path.join(".")} is missing.`,
      details: {
        role: requirement.role,
        path: requirement.path,
        expected: requirement.expected,
      },
      acquisitionOptions: [
        acquisitionOption(
          requirement.id,
          "acquire-value",
          "Acquire evidence containing the required value path.",
          [
            acquisitionAction(
              "ACQUIRE_COMPATIBLE_EVIDENCE",
              observation,
              observation.role,
              `Acquire ${observation.role} evidence containing ${requirement.path.join(".")}.`,
              {
                path: requirement.path,
                expected: requirement.expected,
              },
            ),
          ],
        ),
      ],
    };
  }
  if (canonicalJson(actual.value) !== canonicalJson(requirement.expected)) {
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      required: requirement.required !== false,
      status: "VIOLATED",
      summary: `${requirement.description}: observed value does not equal the required value.`,
      details: {
        role: requirement.role,
        path: requirement.path,
        expected: requirement.expected,
        actual: actual.value,
      },
      acquisitionOptions: [
        acquisitionOption(
          requirement.id,
          "refresh-value",
          "Refresh the observation before evaluating the value again.",
          [
            acquisitionAction(
              "REFRESH_OBSERVATION",
              observation,
              observation.role,
              `Refresh ${observation.role} before evaluating ${requirement.path.join(".")}.`,
              {
                path: requirement.path,
                expected: requirement.expected,
              },
            ),
          ],
        ),
      ],
    };
  }
  return {
    requirementId: requirement.id,
    requirementType: requirement.type,
    required: requirement.required !== false,
    status: "SATISFIED",
    summary: `${requirement.description}: observed value matches the requirement.`,
    details: {
      role: requirement.role,
      path: requirement.path,
      expected: requirement.expected,
    },
    acquisitionOptions: [],
  };
}

function normalizedContract(contract: CoherenceContract): CoherenceContract {
  return {
    ...contract,
    requirements: [...contract.requirements].sort((left, right) =>
      compareCanonicalText(left.id, right.id),
    ),
  };
}

export function verifyDecisionContract(input: unknown): VerificationResult {
  let safeInput: VerificationInput;
  try {
    safeInput = validateInput(input);
  } catch (error) {
    if (error instanceof WorldCutInputError) {
      throw error;
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new WorldCutInputError(error.message, { cause: error });
    }
    throw error;
  }
  const observationsByRole = new Map(
    safeInput.observations.map((observation) => [
      observation.role,
      observation,
    ]),
  );
  const requirementResults = [...safeInput.contract.requirements]
    .sort((left, right) => compareCanonicalText(left.id, right.id))
    .map((requirement) => {
      if (requirement.type === "dependency") {
        return evaluateDependency(requirement, observationsByRole);
      }
      if (requirement.type === "common_valid_time") {
        return evaluateCommonValidTime(requirement, observationsByRole);
      }
      if (requirement.type === "value_equals") {
        return evaluateValueEquals(requirement, observationsByRole);
      }
      throw new TypeError(
        `Unsupported requirement type: ${String((requirement as { type?: unknown }).type)}`,
      );
    });
  const requiredResults = requirementResults.filter((result) => result.required);
  const violated = requiredResults.filter(
    (result) => result.status === "VIOLATED",
  ).length;
  const unknown = requiredResults.filter(
    (result) => result.status === "UNKNOWN",
  ).length;
  const satisfied = requiredResults.filter(
    (result) => result.status === "SATISFIED",
  ).length;
  const verdict =
    violated > 0
      ? "CONTRACT_VIOLATED"
      : unknown > 0
        ? "INSUFFICIENT_EVIDENCE"
        : "CONTRACT_SATISFIED";
  const acquisitionPlan = selectAcquisitionPlan(requirementResults);
  const record = {
    protocolVersion: safeInput.protocolVersion,
    engineVersion: ENGINE_VERSION,
    canonicalization: "worldcut-json-v1",
    contract: normalizedContract(safeInput.contract),
    observations: [...safeInput.observations].sort((left, right) =>
      compareCanonicalText(left.role, right.role),
    ),
    verdict,
    requirementResults,
    acquisitionPlan,
  };

  return {
    protocolVersion: safeInput.protocolVersion,
    engineVersion: ENGINE_VERSION,
    canonicalization: "worldcut-json-v1",
    contractId: safeInput.contract.id,
    contractVersion: safeInput.contract.version,
    verdict,
    coverage: {
      required: requiredResults.length,
      satisfied,
      violated,
      unknown,
      advisory: requirementResults.length - requiredResults.length,
    },
    requirementResults,
    acquisitionPlan,
    verificationRecordDigest: sha256Digest(record),
  };
}
