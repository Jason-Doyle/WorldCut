import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSimulation } from "../benchmark/evaluate.js";
import {
  generateSimulationTrials,
  type SimulationConfig,
} from "../benchmark/simulator.js";

const completeConfig: SimulationConfig = {
  id: "test-complete",
  trials: 750,
  seed: 101,
  versionMismatchRate: 0.35,
  temporalConflictRate: 0.35,
  dependencyMetadataRate: 1,
  validityMetadataRate: 1,
  headVersionMetadataRate: 1,
  unsafeMetadataPenalty: 0,
};

function strategy(
  result: ReturnType<typeof evaluateSimulation>,
  name: string,
) {
  const metrics = result.overall.strategies.find(
    (candidate) => candidate.name === name,
  );
  assert.ok(metrics, `Missing strategy ${name}`);
  return metrics;
}

test("simulation is deterministic for a fixed seed", () => {
  const first = generateSimulationTrials(completeConfig).slice(0, 10);
  const second = generateSimulationTrials(completeConfig).slice(0, 10);

  assert.deepEqual(first, second);
});

test("complete metadata separates WorldCut from dependency-only validation", () => {
  const result = evaluateSimulation(completeConfig);
  const worldCut = strategy(result, "worldcut");
  const strictDependency = strategy(result, "strict-dependency-version");
  const explicit = strategy(result, "explicit-contract-checks");

  assert.equal(worldCut.falseAuthorizations, 0);
  assert.equal(worldCut.safeAuthorizationRate, 1);
  assert.ok(strictDependency.falseAuthorizations > 0);
  assert.equal(result.explicitContractDisagreements, 0);
  assert.deepEqual(
    {
      authorized: explicit.authorized,
      blocked: explicit.blocked,
      abstained: explicit.abstained,
    },
    {
      authorized: worldCut.authorized,
      blocked: worldCut.blocked,
      abstained: worldCut.abstained,
    },
  );
});

test("incomplete metadata produces abstention rather than false authorization", () => {
  const result = evaluateSimulation({
    ...completeConfig,
    id: "test-incomplete",
    dependencyMetadataRate: 0.55,
    validityMetadataRate: 0.55,
    headVersionMetadataRate: 0.8,
    unsafeMetadataPenalty: 0.1,
  });
  const worldCut = strategy(result, "worldcut");

  assert.equal(worldCut.falseAuthorizations, 0);
  assert.ok(worldCut.abstained > 0);
  assert.ok(result.acquisition.planToRereadAllRatio < 1);
});
