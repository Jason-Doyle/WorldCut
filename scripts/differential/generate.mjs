/**
 * Seeded generator for randomized but structurally valid WorldCut verification
 * inputs.
 *
 * Every case is produced from `${seed}:${index}` alone, so the same seed and
 * count always yield byte-identical transport text on every platform. Nesting
 * stays far below the 48-level transport cap documented by the .NET port.
 */

import { DeterministicRandom } from "./prng.mjs";
import { members, raw, toJsonText } from "./json-text.mjs";

/** Fixed decision-time anchor so generated timestamps never depend on the clock. */
const BASE_TIME_MS = Date.UTC(2026, 8, 2, 18, 0, 0);

const ROLE_POOL = [
  "head",
  "ci",
  "approval",
  "quote",
  "deploy",
  "déployé",
  "ロール",
  "role-Ω",
  "rôle_β",
  "Ａ",
  "z",
  "Z",
];

const PROVIDER_POOL = [
  "github",
  "ci.example",
  "change.example",
  "pricing.example",
  "registry.例",
];

const ACCOUNT_POOL = ["acme", "acme-ünïcode", "組織"];

const KIND_POOL = ["branch_head", "ci_run", "approval", "quote", "artifact"];

const VERSION_POOL = [
  "commit-A",
  "commit-B",
  "v1.0.0",
  "版-1",
  "sha-0f1e2d",
  "Z",
  "z",
];

const PROVENANCE_POOL = [
  "provider_asserted",
  "client_observed",
  "derived",
  "operator_supplied",
];

const DEPENDENCY_NAME_POOL = ["tested_head", "source", "input", "依存", "a b"];

/**
 * Member names chosen to exercise UTF-16 code-unit ordering during
 * canonicalization: ASCII, Latin-1, full-width, and an astral pair.
 */
const KEY_POOL = [
  "status",
  "commit",
  "count",
  "ok",
  "nested",
  "items",
  "a b",
  " ",
  "Z",
  "z",
  "ä",
  "Ｚ",
  "ß",
  "0",
  "１",
  "𝄞",
];

const STRING_POOL = [
  "",
  "passed",
  "failed",
  "commit-A",
  "commit-B",
  "line\nbreak",
  "tab\tstop",
  'quote"inside',
  "back\\slash",
  "Ω≈ç√∫",
  "日本語テキスト",
  "𝄞 clef",
  "Ｚ",
  "z",
];

/**
 * Number lexemes that `JSON.stringify` would erase before a CLI ever saw them,
 * including finite IEEE-754 underflow and negative zero.
 */
const RAW_NUMBER_POOL = [
  "-0",
  "0",
  "0.0",
  "1e-400",
  "-1e-400",
  "1E+2",
  "1.0",
  "0.1",
  "1e21",
  "-1.5e-7",
  "9007199254740991",
  "-9007199254740991",
  "5e-324",
  "1.7976931348623157e308",
  "2.2250738585072014e-308",
  "3.0e0",
];

const NUMBER_POOL = [
  0, 1, -1, 2, 42, 1000, 65535, 3.5, 0.25, 3.141592653589793, 1e-7, 1.5e10,
  9007199254740991, -9007199254740991,
];

/**
 * @param {number} milliseconds
 * @returns {string}
 */
function timestamp(milliseconds) {
  return new Date(milliseconds).toISOString();
}

/**
 * @param {DeterministicRandom} rng
 * @returns {string}
 */
function randomString(rng) {
  if (rng.chance(0.2)) {
    return `s-${rng.below(1000)}`;
  }
  return rng.pick(STRING_POOL);
}

/**
 * @param {DeterministicRandom} rng
 * @returns {unknown}
 */
function randomScalar(rng) {
  const roll = rng.below(6);
  if (roll === 0) {
    return null;
  }
  if (roll === 1) {
    return rng.chance(0.5);
  }
  if (roll === 2) {
    return rng.pick(NUMBER_POOL);
  }
  if (roll === 3) {
    return raw(rng.pick(RAW_NUMBER_POOL));
  }
  return randomString(rng);
}

/**
 * @param {DeterministicRandom} rng
 * @param {number} depth
 * @returns {unknown}
 */
function randomValue(rng, depth) {
  if (depth >= 3 || rng.chance(0.45)) {
    return randomScalar(rng);
  }
  if (rng.chance(0.5)) {
    const length = rng.below(4);
    const items = [];
    for (let index = 0; index < length; index += 1) {
      items.push(randomValue(rng, depth + 1));
    }
    return items;
  }
  const size = rng.below(4) + 1;
  const keys = rng.sample(KEY_POOL, size);
  return members(keys.map((key) => [key, randomValue(rng, depth + 1)]));
}

/**
 * Enumerates every `value_equals` path reachable inside a generated value.
 *
 * @param {unknown} node
 * @param {string[]} prefix
 * @param {Array<{ path: string[], node: unknown }>} sink
 * @returns {void}
 */
function collectPaths(node, prefix, sink) {
  if (prefix.length > 0) {
    sink.push({ path: [...prefix], node });
  }
  if (prefix.length >= 4) {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      collectPaths(item, [...prefix, String(index)], sink);
    });
    return;
  }
  if (node !== null && typeof node === "object" && "entries" in node) {
    for (const [key, value] of /** @type {{ entries: [string, unknown][] }} */ (
      node
    ).entries) {
      if (key.length === 0) {
        continue;
      }
      collectPaths(value, [...prefix, key], sink);
    }
  }
}

/**
 * @param {DeterministicRandom} rng
 * @param {number} index
 * @returns {Record<string, string>}
 */
function randomResource(rng, index) {
  return {
    provider: rng.pick(PROVIDER_POOL),
    account: rng.pick(ACCOUNT_POOL),
    kind: rng.pick(KIND_POOL),
    key: rng.chance(0.3) ? `キー/${index}` : `key-${index}-${rng.below(4)}`,
  };
}

/**
 * Builds one randomized verification input.
 *
 * About a third of the corpus is generated in "coherent" mode, where every
 * requirement is constructed to be satisfiable. Without it the random corpus
 * almost never reaches `CONTRACT_SATISFIED` or a `NOT_NEEDED` acquisition plan.
 *
 * @param {DeterministicRandom} rng
 * @returns {{ text: string }}
 */
function buildInput(rng) {
  const coherent = rng.chance(0.35);
  const decisionTimeMs = BASE_TIME_MS + rng.between(0, 5_000_000);
  const roles = rng.sample(ROLE_POOL, rng.between(2, 5));

  /**
   * @type {Array<{
   *   role: string,
   *   record: Record<string, unknown>,
   *   resource: Record<string, string>,
   *   version: string | null,
   *   value: unknown,
   *   links: Array<{ name: string, targetRole: string, coherent: boolean }>,
   * }>}
   */
  const observations = [];

  roles.forEach((role, index) => {
    const resource = randomResource(rng, index);
    const value = randomValue(rng, 0);
    const version = coherent || rng.chance(0.8) ? rng.pick(VERSION_POOL) : null;
    /** @type {Record<string, unknown>} */
    const witness = { provenance: rng.pick(PROVENANCE_POOL) };
    if (version !== null) {
      witness["version"] = version;
    }
    if (coherent) {
      witness["validity"] = {
        from: timestamp(decisionTimeMs - 7_200_000),
        until: rng.chance(0.25)
          ? null
          : timestamp(decisionTimeMs + 3_600_000),
      };
    } else if (rng.chance(0.75)) {
      const fromMs = decisionTimeMs - rng.between(0, 7_200_000);
      const openEnded = rng.chance(0.2);
      witness["validity"] = {
        from: timestamp(fromMs),
        until: openEnded
          ? null
          : timestamp(fromMs + rng.between(1, 5_400_000)),
      };
    }
    observations.push({
      role,
      resource,
      version,
      value,
      links: [],
      record: {
        id: `obs-${index}-${rng.below(1000)}`,
        role,
        resource,
        value,
        observedAt: timestamp(decisionTimeMs - rng.between(0, 3_600_000)),
        acquisitionCost: rng.chance(0.1)
          ? rng.pick([0, 1, 1_000_000_000])
          : rng.between(0, 5000),
        witness,
      },
    });
  });

  // Dependency witnesses reference sibling observations so the differential
  // corpus covers satisfied, violated, and unknown dependency evaluation.
  for (const observation of observations) {
    if (observations.length < 2 || !(coherent || rng.chance(0.7))) {
      continue;
    }
    const targets = observations.filter(
      (candidate) => candidate.role !== observation.role,
    );
    const dependencyCount = rng.between(1, Math.min(2, targets.length));
    const names = rng.sample(DEPENDENCY_NAME_POOL, dependencyCount);
    /** @type {Array<Record<string, unknown>>} */
    const dependencies = [];
    names.forEach((name, slot) => {
      const target = targets[slot % targets.length];
      if (target === undefined) {
        return;
      }
      const exactResource = coherent || rng.chance(0.8);
      /** @type {Record<string, unknown>} */
      const dependency = {
        name,
        resource: exactResource
          ? target.resource
          : randomResource(rng, 90 + slot),
        relation: "exact",
        provenance: rng.pick(PROVENANCE_POOL),
      };
      let versionMatches = false;
      if (coherent && target.version !== null) {
        dependency["version"] = target.version;
        versionMatches = true;
      } else {
        const versionRoll = rng.below(10);
        if (versionRoll < 5 && target.version !== null) {
          dependency["version"] = target.version;
          versionMatches = true;
        } else if (versionRoll < 8) {
          const chosen = rng.pick(VERSION_POOL);
          dependency["version"] = chosen;
          versionMatches = chosen === target.version;
        }
      }
      dependencies.push(dependency);
      observation.links.push({
        name,
        targetRole: target.role,
        coherent: exactResource && versionMatches,
      });
    });
    if (dependencies.length > 0) {
      /** @type {Record<string, unknown>} */
      const witness = /** @type {Record<string, unknown>} */ (
        observation.record["witness"]
      );
      witness["dependencies"] = dependencies;
    }
  }

  /** @type {Array<{ observation: typeof observations[number], link: { name: string, targetRole: string, coherent: boolean } }>} */
  const coherentLinks = [];
  for (const observation of observations) {
    for (const link of observation.links) {
      if (link.coherent) {
        coherentLinks.push({ observation, link });
      }
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const requirements = [];
  const requirementCount = rng.between(1, 5);
  for (let index = 0; index < requirementCount; index += 1) {
    const id = `req-${index}`;
    const description = rng.chance(0.3)
      ? `要件 ${index}`
      : `Requirement ${index}`;
    let roll = rng.below(3);
    if (coherent && roll === 0 && coherentLinks.length === 0) {
      roll = 2;
    }
    /** @type {Record<string, unknown>} */
    let requirement;
    if (roll === 0 && coherent) {
      const chosen = rng.pick(coherentLinks);
      requirement = {
        id,
        type: "dependency",
        description,
        dependentRole: chosen.observation.role,
        targetRole: chosen.link.targetRole,
        dependencyName: chosen.link.name,
      };
    } else if (roll === 0) {
      const dependent = rng.pick(observations);
      const target = rng.pick(observations);
      const knownName =
        dependent.links.length > 0 && rng.chance(0.75)
          ? rng.pick(dependent.links).name
          : rng.pick(DEPENDENCY_NAME_POOL);
      requirement = {
        id,
        type: "dependency",
        description,
        dependentRole: rng.chance(0.9) ? dependent.role : "missing-role",
        targetRole: rng.chance(0.9) ? target.role : "absent-role",
        dependencyName: knownName,
      };
    } else if (roll === 1 && observations.length >= 2) {
      const chosen = rng.sample(
        observations.map((observation) => observation.role),
        rng.between(2, Math.min(3, observations.length)),
      );
      const fromMs = coherent
        ? decisionTimeMs - 3_600_000
        : decisionTimeMs - rng.between(0, 7_200_000);
      requirement = {
        id,
        type: "common_valid_time",
        description,
        roles: chosen,
        within: {
          from: timestamp(fromMs),
          until: rng.chance(0.15)
            ? null
            : timestamp(
                fromMs + (coherent ? 1_800_000 : rng.between(1, 5_400_000)),
              ),
        },
      };
    } else {
      const observation = rng.pick(observations);
      /** @type {Array<{ path: string[], node: unknown }>} */
      const paths = [];
      collectPaths(observation.value, [], paths);
      if (paths.length > 0 && (coherent || rng.chance(0.7))) {
        const chosen = rng.pick(paths);
        requirement = {
          id,
          type: "value_equals",
          description,
          role: observation.role,
          path: chosen.path,
          expected:
            coherent || rng.chance(0.7) ? chosen.node : randomValue(rng, 2),
        };
      } else {
        requirement = {
          id,
          type: "value_equals",
          description,
          role: rng.chance(0.9) ? observation.role : "unbound-role",
          path: [rng.pick(KEY_POOL) || "status"],
          expected: randomValue(rng, 2),
        };
      }
    }
    if (index > 0 && rng.chance(0.25)) {
      requirement["required"] = false;
    }
    requirements.push(requirement);
  }

  const contract = {
    id: rng.chance(0.2) ? "契約-1" : "deploy-current-tested-release",
    version: String(rng.between(1, 9)),
    decisionTime: timestamp(decisionTimeMs),
    assumptions: {
      clockModel: "trusted_normalized",
      intervalModel: "half_open",
      metadataModel: "honest_but_possibly_incomplete",
    },
    requirements: rng.chance(0.5) ? rng.shuffled(requirements) : requirements,
  };

  const observationRecords = observations.map(
    (observation) => observation.record,
  );
  const input = {
    protocolVersion: "0.1",
    contract,
    observations: rng.chance(0.5)
      ? rng.shuffled(observationRecords)
      : observationRecords,
  };

  return {
    text: toJsonText(input, { indent: rng.pick([0, 2, 4]) }),
  };
}

/**
 * @param {string} seed
 * @param {number} index
 * @returns {{ id: string, category: "random", text: string, expect: "oracle" }}
 */
export function generateRandomCase(seed, index) {
  const rng = new DeterministicRandom(`${seed}:${index}`);
  const built = buildInput(rng);
  return {
    id: `random/${String(index).padStart(4, "0")}`,
    category: "random",
    text: built.text,
    expect: "oracle",
  };
}

/**
 * @param {string} seed
 * @param {number} count
 * @returns {Array<{ id: string, category: "random", text: string, expect: "oracle" }>}
 */
export function generateRandomCases(seed, count) {
  const cases = [];
  for (let index = 0; index < count; index += 1) {
    cases.push(generateRandomCase(seed, index));
  }
  return cases;
}
