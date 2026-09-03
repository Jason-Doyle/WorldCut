import { evaluateBaselines } from "../baselines.js";
import {
  mismatchedDeploymentScenario,
  nonOverlappingValidityScenario,
} from "../scenarios.js";
import { verifyDecisionContract } from "../verifier.js";

for (const scenario of [
  mismatchedDeploymentScenario(),
  nonOverlappingValidityScenario(),
]) {
  const result = verifyDecisionContract(scenario.input);
  console.log(`\n${scenario.id}`);
  console.log("=".repeat(scenario.id.length));
  console.log(scenario.description);
  console.log(`WorldCut: ${result.verdict}`);
  for (const requirement of result.requirementResults) {
    console.log(`- ${requirement.status}: ${requirement.summary}`);
  }
  console.log(
    `Acquisition plan: ${result.acquisitionPlan.status}, cost ${result.acquisitionPlan.totalCost}`,
  );
  for (const action of result.acquisitionPlan.actions) {
    console.log(`- ${action.type} ${action.role}: ${action.description}`);
  }
  console.log("Baselines:");
  for (const baseline of evaluateBaselines(scenario.input)) {
    console.log(`- ${baseline.name}: ${baseline.verdict}`);
  }
}
