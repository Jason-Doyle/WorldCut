import type {
  BaselineResult,
  ContractRequirement,
  ContractVerdict,
  Observation,
  VerificationInput,
} from "./types.js";
import { canonicalJson } from "./canonical.js";
import { sameResourceIdentity } from "./resource.js";

function requiredRequirements(
  input: VerificationInput,
): ContractRequirement[] {
  return input.contract.requirements.filter(
    (requirement) => requirement.required !== false,
  );
}

function aggregate(
  name: string,
  violated: number,
  unknown: number,
  reason: string,
): BaselineResult {
  const verdict: ContractVerdict =
    violated > 0
      ? "CONTRACT_VIOLATED"
      : unknown > 0
        ? "INSUFFICIENT_EVIDENCE"
        : "CONTRACT_SATISFIED";
  return { name, verdict, reason };
}

function rolesForContract(input: VerificationInput): Set<string> {
  const roles = new Set<string>();
  for (const requirement of requiredRequirements(input)) {
    if (requirement.type === "dependency") {
      roles.add(requirement.dependentRole);
      roles.add(requirement.targetRole);
    } else if (requirement.type === "common_valid_time") {
      for (const role of requirement.roles) {
        roles.add(role);
      }
    } else {
      roles.add(requirement.role);
    }
  }
  return roles;
}

function observationsByRole(
  observations: Observation[],
): Map<string, Observation> {
  return new Map(
    observations.map((observation) => [observation.role, observation]),
  );
}

export function latestValueBaseline(
  input: VerificationInput,
): BaselineResult {
  const availableRoles = new Set(
    input.observations.map((observation) => observation.role),
  );
  const missing = [...rolesForContract(input)].filter(
    (role) => !availableRoles.has(role),
  );
  return aggregate(
    "latest-value",
    0,
    missing.length,
    missing.length === 0
      ? "All selected roles have a latest observation; relationships are not checked."
      : `Missing roles: ${missing.join(", ")}.`,
  );
}

export function ttlBaseline(
  input: VerificationInput,
  maximumAgeMilliseconds: number,
): BaselineResult {
  const decisionTime = Date.parse(input.contract.decisionTime);
  const roles = rolesForContract(input);
  const byRole = observationsByRole(input.observations);
  let unknown = 0;
  const stale: string[] = [];

  for (const role of roles) {
    const observation = byRole.get(role);
    if (!observation) {
      unknown += 1;
      continue;
    }
    const age = decisionTime - Date.parse(observation.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > maximumAgeMilliseconds) {
      stale.push(role);
    }
  }

  return aggregate(
    `ttl-${maximumAgeMilliseconds}ms`,
    0,
    unknown + stale.length,
    stale.length === 0
      ? "Every selected observation is within the freshness threshold; relationships are not checked."
      : `Stale or future observations: ${stale.join(", ")}.`,
  );
}

export function dependencyVersionBaseline(
  input: VerificationInput,
  strictMissingMetadata: boolean,
): BaselineResult {
  const byRole = observationsByRole(input.observations);
  let violated = 0;
  let unknown = 0;
  let checked = 0;

  for (const requirement of requiredRequirements(input)) {
    if (requirement.type !== "dependency") {
      continue;
    }
    const dependent = byRole.get(requirement.dependentRole);
    const target = byRole.get(requirement.targetRole);
    if (!dependent || !target) {
      if (strictMissingMetadata) {
        unknown += 1;
      }
      continue;
    }
    const dependency = (dependent.witness.dependencies ?? []).find(
      (candidate) => candidate.name === requirement.dependencyName,
    );
    if (
      !dependency ||
      !dependency.version ||
      !target.witness.version
    ) {
      if (strictMissingMetadata) {
        unknown += 1;
      }
      continue;
    }
    checked += 1;
    if (
      !sameResourceIdentity(dependency.resource, target.resource) ||
      dependency.version !== target.witness.version
    ) {
      violated += 1;
    }
  }

  return aggregate(
    strictMissingMetadata
      ? "strict-dependency-version"
      : "permissive-dependency-version",
    violated,
    unknown,
    `Checked ${checked} exact dependency relationship(s); temporal composition was ignored.`,
  );
}

export function explicitContractBaseline(
  input: VerificationInput,
): BaselineResult {
  const byRole = observationsByRole(input.observations);
  let violated = 0;
  let unknown = 0;
  let checked = 0;

  for (const requirement of requiredRequirements(input)) {
    if (requirement.type === "dependency") {
      const dependent = byRole.get(requirement.dependentRole);
      const target = byRole.get(requirement.targetRole);
      if (!dependent || !target) {
        unknown += 1;
        continue;
      }
      const dependency = (dependent.witness.dependencies ?? []).find(
        (candidate) => candidate.name === requirement.dependencyName,
      );
      if (
        !dependency ||
        !dependency.version ||
        !target.witness.version
      ) {
        unknown += 1;
        continue;
      }
      checked += 1;
      if (
        !sameResourceIdentity(dependency.resource, target.resource) ||
        dependency.version !== target.witness.version
      ) {
        violated += 1;
      }
      continue;
    }

    if (requirement.type === "value_equals") {
      const observation = byRole.get(requirement.role);
      if (!observation) {
        unknown += 1;
        continue;
      }
      let current = observation.value;
      let found = true;
      for (const segment of requirement.path) {
        if (
          current === null ||
          typeof current !== "object" ||
          !Object.hasOwn(current, segment)
        ) {
          found = false;
          break;
        }
        const next = (current as Record<string, typeof current>)[segment];
        if (next === undefined) {
          found = false;
          break;
        }
        current = next;
      }
      checked += 1;
      if (!found) {
        unknown += 1;
      } else if (
        canonicalJson(current) !== canonicalJson(requirement.expected)
      ) {
        violated += 1;
      }
      continue;
    }

    let start = Date.parse(requirement.within.from);
    let end =
      requirement.within.until === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(requirement.within.until);
    let missing = false;
    for (const role of requirement.roles) {
      const validity = byRole.get(role)?.witness.validity;
      if (!validity) {
        missing = true;
        continue;
      }
      start = Math.max(start, Date.parse(validity.from));
      end = Math.min(
        end,
        validity.until === null
          ? Number.POSITIVE_INFINITY
          : Date.parse(validity.until),
      );
    }
    checked += 1;
    if (start >= end) {
      violated += 1;
    } else if (missing) {
      unknown += 1;
    }
  }

  return aggregate(
    "explicit-contract-checks",
    violated,
    unknown,
    `Hand-coded the same ${checked} required predicate(s) without WorldCut records, explanations, or acquisition planning.`,
  );
}

export function evaluateBaselines(
  input: VerificationInput,
  ttlSweepMilliseconds: number[] = [1_000, 5_000, 30_000],
): BaselineResult[] {
  return [
    latestValueBaseline(input),
    ...ttlSweepMilliseconds.map((ttl) => ttlBaseline(input, ttl)),
    dependencyVersionBaseline(input, false),
    dependencyVersionBaseline(input, true),
    explicitContractBaseline(input),
  ];
}
