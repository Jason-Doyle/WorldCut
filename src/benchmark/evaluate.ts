import { evaluateBaselines } from "../baselines.js";
import type { BaselineResult, ContractVerdict } from "../types.js";
import { verifyDecisionContract } from "../verifier.js";
import {
  generateSimulationTrials,
  type SimulationConfig,
  type SimulationTrial,
} from "./simulator.js";

export interface StrategyMetrics {
  name: string;
  trials: number;
  safeTrials: number;
  unsafeTrials: number;
  authorized: number;
  blocked: number;
  abstained: number;
  safeAuthorizations: number;
  falseAuthorizations: number;
  falseBlocks: number;
  unsafeBlocks: number;
  authorizationCoverage: number;
  safeAuthorizationRate: number;
  falseAuthorizationRate: number;
  abstentionRate: number;
}

export interface AcquisitionMetrics {
  samples: number;
  averagePlanCost: number;
  averageRereadAllCost: number;
  planToRereadAllRatio: number;
}

export interface BenchmarkSlice {
  label: string;
  trialCount: number;
  strategies: StrategyMetrics[];
}

export interface BenchmarkConfigResult {
  config: SimulationConfig;
  overall: BenchmarkSlice;
  completeMetadata: BenchmarkSlice;
  incompleteMetadata: BenchmarkSlice;
  acquisition: AcquisitionMetrics;
  explicitContractDisagreements: number;
}

interface MutableMetrics {
  name: string;
  trials: number;
  safeTrials: number;
  unsafeTrials: number;
  authorized: number;
  blocked: number;
  abstained: number;
  safeAuthorizations: number;
  falseAuthorizations: number;
  falseBlocks: number;
  unsafeBlocks: number;
}

function classify(verdict: ContractVerdict): "authorize" | "block" | "abstain" {
  if (verdict === "CONTRACT_SATISFIED") {
    return "authorize";
  }
  if (verdict === "CONTRACT_VIOLATED") {
    return "block";
  }
  return "abstain";
}

function createMetrics(name: string): MutableMetrics {
  return {
    name,
    trials: 0,
    safeTrials: 0,
    unsafeTrials: 0,
    authorized: 0,
    blocked: 0,
    abstained: 0,
    safeAuthorizations: 0,
    falseAuthorizations: 0,
    falseBlocks: 0,
    unsafeBlocks: 0,
  };
}

function record(
  metrics: MutableMetrics,
  verdict: ContractVerdict,
  safe: boolean,
): void {
  metrics.trials += 1;
  if (safe) {
    metrics.safeTrials += 1;
  } else {
    metrics.unsafeTrials += 1;
  }

  const outcome = classify(verdict);
  if (outcome === "authorize") {
    metrics.authorized += 1;
    if (safe) {
      metrics.safeAuthorizations += 1;
    } else {
      metrics.falseAuthorizations += 1;
    }
  } else if (outcome === "block") {
    metrics.blocked += 1;
    if (safe) {
      metrics.falseBlocks += 1;
    } else {
      metrics.unsafeBlocks += 1;
    }
  } else {
    metrics.abstained += 1;
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function finalize(metrics: MutableMetrics): StrategyMetrics {
  return {
    ...metrics,
    authorizationCoverage: ratio(metrics.authorized, metrics.trials),
    safeAuthorizationRate: ratio(
      metrics.safeAuthorizations,
      metrics.safeTrials,
    ),
    falseAuthorizationRate: ratio(
      metrics.falseAuthorizations,
      metrics.unsafeTrials,
    ),
    abstentionRate: ratio(metrics.abstained, metrics.trials),
  };
}

function evaluateSlice(
  label: string,
  trials: SimulationTrial[],
): BenchmarkSlice {
  const strategies = new Map<string, MutableMetrics>();

  for (const trial of trials) {
    const worldCut = verifyDecisionContract(trial.input);
    const results: BaselineResult[] = [
      {
        name: "worldcut",
        verdict: worldCut.verdict,
        reason: "WorldCut decision-contract verification.",
      },
      ...evaluateBaselines(trial.input, [250, 1_000, 5_000, 30_000]),
    ];
    for (const result of results) {
      const metrics =
        strategies.get(result.name) ?? createMetrics(result.name);
      record(metrics, result.verdict, trial.groundTruthSafe);
      strategies.set(result.name, metrics);
    }
  }

  return {
    label,
    trialCount: trials.length,
    strategies: [...strategies.values()]
      .map(finalize)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function evaluateSimulation(
  config: SimulationConfig,
): BenchmarkConfigResult {
  const trials = generateSimulationTrials(config);
  let planCost = 0;
  let rereadAllCost = 0;
  let planSamples = 0;
  let explicitContractDisagreements = 0;

  for (const trial of trials) {
    const worldCut = verifyDecisionContract(trial.input);
    const explicit = evaluateBaselines(trial.input).find(
      (result) => result.name === "explicit-contract-checks",
    );
    if (!explicit) {
      throw new Error("Explicit contract baseline was not evaluated");
    }
    if (explicit.verdict !== worldCut.verdict) {
      explicitContractDisagreements += 1;
    }
    if (
      worldCut.verdict !== "CONTRACT_SATISFIED" &&
      worldCut.acquisitionPlan.status === "AVAILABLE"
    ) {
      planCost += worldCut.acquisitionPlan.totalCost;
      rereadAllCost += trial.readAllCost;
      planSamples += 1;
    }
  }

  return {
    config,
    overall: evaluateSlice("all trials", trials),
    completeMetadata: evaluateSlice(
      "complete metadata",
      trials.filter((trial) => trial.metadataComplete),
    ),
    incompleteMetadata: evaluateSlice(
      "incomplete metadata",
      trials.filter((trial) => !trial.metadataComplete),
    ),
    acquisition: {
      samples: planSamples,
      averagePlanCost: ratio(planCost, planSamples),
      averageRereadAllCost: ratio(rereadAllCost, planSamples),
      planToRereadAllRatio: ratio(planCost, rereadAllCost),
    },
    explicitContractDisagreements,
  };
}
