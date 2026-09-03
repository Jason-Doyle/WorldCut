import type {
  CoherenceContract,
  Observation,
  ResourceIdentity,
  VerificationInput,
} from "../types.js";

export interface SimulationConfig {
  id: string;
  trials: number;
  seed: number;
  versionMismatchRate: number;
  temporalConflictRate: number;
  dependencyMetadataRate: number;
  validityMetadataRate: number;
  headVersionMetadataRate: number;
  unsafeMetadataPenalty: number;
}

interface HiddenInterval {
  from: number;
  until: number;
}

export interface HiddenEventHistory {
  currentHead: string;
  testedHead: string;
  approvalValidity: HiddenInterval;
  quoteValidity: HiddenInterval;
  decisionWindow: HiddenInterval;
}

export interface SimulationTrial {
  id: string;
  caseKind:
    | "safe"
    | "version_mismatch"
    | "temporal_conflict"
    | "combined_conflict";
  input: VerificationInput;
  groundTruthSafe: boolean;
  metadataComplete: boolean;
  readAllCost: number;
  history: HiddenEventHistory;
}

function assertRate(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be between 0 and 1`);
  }
}

function validateConfig(config: SimulationConfig): void {
  if (!Number.isInteger(config.trials) || config.trials < 1) {
    throw new RangeError("trials must be a positive integer");
  }
  assertRate(config.versionMismatchRate, "versionMismatchRate");
  assertRate(config.temporalConflictRate, "temporalConflictRate");
  assertRate(config.dependencyMetadataRate, "dependencyMetadataRate");
  assertRate(config.validityMetadataRate, "validityMetadataRate");
  assertRate(config.headVersionMetadataRate, "headVersionMetadataRate");
  assertRate(config.unsafeMetadataPenalty, "unsafeMetadataPenalty");
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function chance(random: () => number, probability: number): boolean {
  return random() < probability;
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function resource(
  provider: string,
  account: string,
  kind: string,
  key: string,
): ResourceIdentity {
  return { provider, account, kind, key };
}

function intervalsOverlap(
  left: HiddenInterval,
  right: HiddenInterval,
  window: HiddenInterval,
): boolean {
  const start = Math.max(left.from, right.from, window.from);
  const end = Math.min(left.until, right.until, window.until);
  return start < end;
}

function decisionIsSafe(history: HiddenEventHistory): boolean {
  return (
    history.currentHead === history.testedHead &&
    intervalsOverlap(
      history.approvalValidity,
      history.quoteValidity,
      history.decisionWindow,
    )
  );
}

function adjustedMetadataRate(
  baseRate: number,
  unsafe: boolean,
  penalty: number,
): number {
  return Math.max(0, baseRate - (unsafe ? penalty : 0));
}

export function generateSimulationTrials(
  config: SimulationConfig,
): SimulationTrial[] {
  validateConfig(config);
  const random = createRandom(config.seed);
  const trials: SimulationTrial[] = [];
  const epoch = Date.parse("2026-09-02T12:00:00.000Z");

  for (let index = 0; index < config.trials; index += 1) {
    const decisionTime = epoch + index * 120_000 + 90_000;
    const decisionWindow = {
      from: decisionTime - 60_000,
      until: decisionTime + 1,
    };
    const currentHead = `B-${index}`;
    const versionMismatch = chance(random, config.versionMismatchRate);
    const temporalConflict = chance(random, config.temporalConflictRate);
    const testedHead = versionMismatch ? `A-${index}` : currentHead;
    const split = decisionTime - 30_000 + Math.floor(random() * 5_000);
    const gap = 1 + Math.floor(random() * 2_000);
    const approvalValidity: HiddenInterval = temporalConflict
      ? {
          from: decisionWindow.from,
          until: split,
        }
      : {
          from: decisionWindow.from,
          until: decisionTime + 30_000,
        };
    const quoteValidity: HiddenInterval = temporalConflict
      ? {
          from: split + gap,
          until: decisionTime + 30_000,
        }
      : {
          from: decisionTime - 40_000,
          until: decisionTime + 30_000,
        };
    const history: HiddenEventHistory = {
      currentHead,
      testedHead,
      approvalValidity,
      quoteValidity,
      decisionWindow,
    };
    const groundTruthSafe = decisionIsSafe(history);
    const metadataPenalty = config.unsafeMetadataPenalty;
    const dependencyVisible = chance(
      random,
      adjustedMetadataRate(
        config.dependencyMetadataRate,
        !groundTruthSafe,
        metadataPenalty,
      ),
    );
    const approvalValidityVisible = chance(
      random,
      adjustedMetadataRate(
        config.validityMetadataRate,
        !groundTruthSafe,
        metadataPenalty,
      ),
    );
    const quoteValidityVisible = chance(
      random,
      adjustedMetadataRate(
        config.validityMetadataRate,
        !groundTruthSafe,
        metadataPenalty,
      ),
    );
    const headVersionVisible = chance(
      random,
      adjustedMetadataRate(
        config.headVersionMetadataRate,
        !groundTruthSafe,
        metadataPenalty,
      ),
    );
    const account = `tenant-${index % 17}`;
    const headResource = resource(
      "github",
      account,
      "branch_head",
      "payments/main",
    );
    const observedAge = () => Math.floor(random() * 900);
    const cost = () => 1 + Math.floor(random() * 5);
    const head: Observation = {
      id: `head-${index}`,
      role: "head",
      resource: headResource,
      value: { head: currentHead },
      observedAt: iso(decisionTime - observedAge()),
      acquisitionCost: cost(),
      witness: {
        provenance: "provider_asserted",
        ...(headVersionVisible ? { version: currentHead } : {}),
      },
    };
    const ci: Observation = {
      id: `ci-${index}`,
      role: "ci",
      resource: resource("ci.example", account, "ci_run", `run-${index}`),
      value: { status: "passed" },
      observedAt: iso(decisionTime - observedAge()),
      acquisitionCost: cost(),
      witness: {
        provenance: "provider_asserted",
        version: `run-${index}`,
        ...(dependencyVisible
          ? {
              dependencies: [
                {
                  name: "tested_head",
                  resource: headResource,
                  relation: "exact" as const,
                  version: testedHead,
                  provenance: "provider_asserted" as const,
                },
              ],
            }
          : {}),
      },
    };
    const approval: Observation = {
      id: `approval-${index}`,
      role: "approval",
      resource: resource(
        "crm.example",
        account,
        "approval",
        `change-${index}`,
      ),
      value: { approved: true },
      observedAt: iso(decisionTime - observedAge()),
      acquisitionCost: cost(),
      witness: {
        provenance: "provider_asserted",
        version: `approval-v${index}`,
        ...(approvalValidityVisible
          ? {
              validity: {
                from: iso(approvalValidity.from),
                until: iso(approvalValidity.until),
              },
            }
          : {}),
      },
    };
    const quote: Observation = {
      id: `quote-${index}`,
      role: "quote",
      resource: resource(
        "pricing.example",
        account,
        "quote",
        `change-${index}`,
      ),
      value: { amount: 1_250 + (index % 100), currency: "USD" },
      observedAt: iso(decisionTime - observedAge()),
      acquisitionCost: cost(),
      witness: {
        provenance: "provider_asserted",
        version: `quote-v${index}`,
        ...(quoteValidityVisible
          ? {
              validity: {
                from: iso(quoteValidity.from),
                until: iso(quoteValidity.until),
              },
            }
          : {}),
      },
    };
    const contract: CoherenceContract = {
      id: `deployment-contract-${index}`,
      version: "1",
      decisionTime: iso(decisionTime),
      assumptions: {
        clockModel: "trusted_normalized",
        intervalModel: "half_open",
        metadataModel: "honest_but_possibly_incomplete",
      },
      requirements: [
        {
          id: "ci-tested-current-head",
          type: "dependency",
          description: "The passing CI run tested the selected branch head",
          dependentRole: "ci",
          targetRole: "head",
          dependencyName: "tested_head",
        },
        {
          id: "approval-and-quote-coexisted",
          type: "common_valid_time",
          description:
            "The approval and quoted terms shared a valid time in the decision window",
          roles: ["approval", "quote"],
          within: {
            from: iso(decisionWindow.from),
            until: iso(decisionWindow.until),
          },
        },
      ],
    };
    const caseKind =
      versionMismatch && temporalConflict
        ? "combined_conflict"
        : versionMismatch
          ? "version_mismatch"
          : temporalConflict
            ? "temporal_conflict"
            : "safe";
    const observations = [head, ci, approval, quote];

    trials.push({
      id: `${config.id}-${index}`,
      caseKind,
      input: { contract, observations },
      groundTruthSafe,
      metadataComplete:
        dependencyVisible &&
        approvalValidityVisible &&
        quoteValidityVisible &&
        headVersionVisible,
      readAllCost: observations.reduce(
        (sum, observation) => sum + observation.acquisitionCost,
        0,
      ),
      history,
    });
  }

  return trials;
}
