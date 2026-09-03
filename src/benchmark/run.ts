import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  evaluateSimulation,
  type BenchmarkConfigResult,
  type BenchmarkSlice,
  type StrategyMetrics,
} from "./evaluate.js";
import type { SimulationConfig } from "./simulator.js";

interface HypothesisResult {
  id: string;
  claim: string;
  status: "PASS" | "FAIL" | "UNTESTED";
  evidence: string;
}

interface EvaluationSummary {
  generatedAt: string;
  verdict:
    | "CORE_ASSUMPTION_SUPPORTED_WITH_LIMITS"
    | "CORE_ASSUMPTION_NOT_SUPPORTED";
  hypotheses: HypothesisResult[];
  results: BenchmarkConfigResult[];
  limitations: string[];
}

const configs: SimulationConfig[] = [
  {
    id: "complete-low-change",
    trials: 4_000,
    seed: 41,
    versionMismatchRate: 0.2,
    temporalConflictRate: 0.2,
    dependencyMetadataRate: 1,
    validityMetadataRate: 1,
    headVersionMetadataRate: 1,
    unsafeMetadataPenalty: 0,
  },
  {
    id: "complete-high-change",
    trials: 4_000,
    seed: 42,
    versionMismatchRate: 0.5,
    temporalConflictRate: 0.5,
    dependencyMetadataRate: 1,
    validityMetadataRate: 1,
    headVersionMetadataRate: 1,
    unsafeMetadataPenalty: 0,
  },
  {
    id: "mixed-metadata",
    trials: 4_000,
    seed: 43,
    versionMismatchRate: 0.35,
    temporalConflictRate: 0.35,
    dependencyMetadataRate: 0.75,
    validityMetadataRate: 0.75,
    headVersionMetadataRate: 0.95,
    unsafeMetadataPenalty: 0.1,
  },
  {
    id: "weak-metadata",
    trials: 4_000,
    seed: 44,
    versionMismatchRate: 0.35,
    temporalConflictRate: 0.35,
    dependencyMetadataRate: 0.45,
    validityMetadataRate: 0.45,
    headVersionMetadataRate: 0.8,
    unsafeMetadataPenalty: 0.15,
  },
];

function strategy(
  slice: BenchmarkSlice,
  name: string,
): StrategyMetrics {
  const result = slice.strategies.find((candidate) => candidate.name === name);
  if (!result) {
    throw new Error(`Strategy not found: ${name}`);
  }
  return result;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function evaluateHypotheses(
  results: BenchmarkConfigResult[],
): HypothesisResult[] {
  const completeResults = results.filter((result) =>
    result.config.id.startsWith("complete-"),
  );
  const mixedResults = results.filter((result) =>
    result.config.id.includes("metadata"),
  );
  const worldCutComplete = completeResults.map((result) =>
    strategy(result.completeMetadata, "worldcut"),
  );
  const strictComplete = completeResults.map((result) =>
    strategy(result.completeMetadata, "strict-dependency-version"),
  );
  const ttlComplete = completeResults.map((result) =>
    strategy(result.completeMetadata, "ttl-30000ms"),
  );
  const worldCutMixed = mixedResults.map((result) =>
    strategy(result.overall, "worldcut"),
  );
  const planRatios = results
    .map((result) => result.acquisition.planToRereadAllRatio)
    .filter((value) => value > 0);
  const explicitDisagreements = results.reduce(
    (sum, result) => sum + result.explicitContractDisagreements,
    0,
  );

  return [
    {
      id: "H1",
      claim:
        "Fresh observations can still authorize an unsafe cross-service decision.",
      status: ttlComplete.some((metrics) => metrics.falseAuthorizations > 0)
        ? "PASS"
        : "FAIL",
      evidence: ttlComplete
        .map(
          (metrics, index) =>
            `${completeResults[index]?.config.id}: ${metrics.falseAuthorizations} false authorizations`,
        )
        .join("; "),
    },
    {
      id: "H2",
      claim:
        "Strict exact dependency checking is insufficient when scoped temporal compatibility matters.",
      status: strictComplete.some(
        (metrics) => metrics.falseAuthorizations > 0,
      )
        ? "PASS"
        : "FAIL",
      evidence: strictComplete
        .map(
          (metrics, index) =>
            `${completeResults[index]?.config.id}: ${metrics.falseAuthorizations} false authorizations`,
        )
        .join("; "),
    },
    {
      id: "H3",
      claim:
        "With complete truthful metadata, WorldCut is sound and non-vacuous under the declared simulation model.",
      status: worldCutComplete.every(
        (metrics) =>
          metrics.falseAuthorizations === 0 &&
          metrics.safeAuthorizationRate >= 0.99,
      )
        ? "PASS"
        : "FAIL",
      evidence: worldCutComplete
        .map(
          (metrics, index) =>
            `${completeResults[index]?.config.id}: false authorization ${percent(metrics.falseAuthorizationRate)}, safe authorization ${percent(metrics.safeAuthorizationRate)}`,
        )
        .join("; "),
    },
    {
      id: "H4",
      claim:
        "Missing required metadata produces abstention instead of optimistic authorization.",
      status: worldCutMixed.every(
        (metrics) =>
          metrics.falseAuthorizations === 0 && metrics.abstained > 0,
      )
        ? "PASS"
        : "FAIL",
      evidence: worldCutMixed
        .map(
          (metrics, index) =>
            `${mixedResults[index]?.config.id}: ${metrics.abstained} abstentions, ${metrics.falseAuthorizations} false authorizations`,
        )
        .join("; "),
    },
    {
      id: "H5",
      claim:
        "The acquisition plan lowers expected cost to a resolved verdict versus reacquiring every observation.",
      status: "UNTESTED",
      evidence: results
        .map(
          (result) =>
            `${result.config.id}: nominal declared-action ratio ${percent(result.acquisition.planToRereadAllRatio)}`,
        )
        .join("; ")
        .concat(
          planRatios.length > 0
            ? "; actions were not executed, so resolution probability and actual cost are unknown"
            : "; no acquisition plans were measured",
        ),
    },
    {
      id: "H6",
      claim:
        "WorldCut does not claim a correctness advantage over hand-coding the identical explicit predicates.",
      status: explicitDisagreements === 0 ? "PASS" : "FAIL",
      evidence: `${explicitDisagreements} verdict disagreements across ${results.reduce((sum, result) => sum + result.config.trials, 0)} trials`,
    },
  ];
}

function strategyTable(slice: BenchmarkSlice): string {
  const rows = slice.strategies.map(
    (metrics) =>
      `| ${metrics.name} | ${metrics.authorized} | ${metrics.blocked} | ${metrics.abstained} | ${metrics.falseAuthorizations} | ${percent(metrics.safeAuthorizationRate)} | ${percent(metrics.falseAuthorizationRate)} |`,
  );
  return [
    "| Strategy | Authorized | Blocked | Abstained | False authorizations | Safe authorization rate | False authorization rate |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
}

function renderReport(summary: EvaluationSummary): string {
  const hypothesisRows = summary.hypotheses.map(
    (hypothesis) =>
      `| ${hypothesis.id} | ${hypothesis.status} | ${hypothesis.claim} | ${hypothesis.evidence} |`,
  );
  const resultSections = summary.results.flatMap((result) => [
    `## ${result.config.id}`,
    "",
    `Trials: ${result.config.trials}. Complete metadata trials: ${result.completeMetadata.trialCount}. Incomplete metadata trials: ${result.incompleteMetadata.trialCount}.`,
    "",
    "### Overall",
    "",
    strategyTable(result.overall),
    "",
    "### Complete metadata",
    "",
    strategyTable(result.completeMetadata),
    "",
    `Acquisition-plan samples: ${result.acquisition.samples}. Average nominal declared-action cost: ${result.acquisition.averagePlanCost.toFixed(2)}. Average nominal reread-all cost: ${result.acquisition.averageRereadAllCost.toFixed(2)}. Ratio: ${percent(result.acquisition.planToRereadAllRatio)}. These actions were not executed, so this is not evidence of operational savings.`,
    "",
    `WorldCut versus explicit-contract verdict disagreements: ${result.explicitContractDisagreements}.`,
    "",
  ]);

  return [
    "# WorldCut Core-Assumption Evaluation",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `**Evaluation verdict: ${summary.verdict}**`,
    "",
    "This benchmark evaluates a declared, non-adversarial fault model with honest but sometimes incomplete metadata. It is evidence about the prototype's core assumptions, not proof of production effectiveness or research novelty.",
    "",
    "## Hypotheses",
    "",
    "| ID | Result | Claim | Evidence |",
    "| --- | --- | --- | --- |",
    ...hypothesisRows,
    "",
    "## Interpretation",
    "",
    "- Freshness alone does not establish that observations satisfy the relationships required by a decision.",
    "- Exact dependency checking catches the Git/CI mismatch. WorldCut should not claim that example as an advantage over correct provenance checks.",
    "- Scoped temporal compatibility creates unsafe cases that dependency-only validation authorizes.",
    "- The explicit-contract baseline is expected to tie WorldCut. The current value is a reusable contract, three-valued evidence semantics, deterministic records, explanations, and bounded acquisition planning—not a superior constraint-solving algorithm.",
    "- Acquisition-plan costs are descriptive only. Expected cost to a resolved verdict remains untested.",
    "- Real provider metadata availability and a broader prior-art review remain mandatory before making a stronger systems-research claim.",
    "",
    ...resultSections,
    "## Limitations",
    "",
    ...summary.limitations.map((limitation) => `- ${limitation}`),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const results = configs.map(evaluateSimulation);
  const hypotheses = evaluateHypotheses(results);
  const requiredHypotheses = hypotheses.filter((hypothesis) =>
    ["H1", "H2", "H3", "H4"].includes(hypothesis.id),
  );
  const verdict = requiredHypotheses.every(
    (hypothesis) => hypothesis.status === "PASS",
  )
    ? "CORE_ASSUMPTION_SUPPORTED_WITH_LIMITS"
    : "CORE_ASSUMPTION_NOT_SUPPORTED";
  const summary: EvaluationSummary = {
    generatedAt: new Date().toISOString(),
    verdict,
    hypotheses,
    results,
    limitations: [
      "The simulator uses a trusted normalized clock and truthful metadata; Byzantine providers are out of scope.",
      "Ground truth is generated from an independent event history, but the decision contract still reflects the same intended business invariants.",
      "The explicit-contract baseline implements equivalent predicates and therefore measures whether WorldCut adds semantics beyond bespoke checks, not whether equivalent logic can be outperformed.",
      "Validity intervals are assumed to be available at decision time. Real APIs often expose weaker metadata.",
      "The acquisition plan covers unresolved requirements at minimum declared cost; it does not guarantee that reacquisition will make the contract satisfiable.",
      "Nominal acquisition costs are synthetic inputs. No plan action is executed, so H5 remains untested and does not contribute to the evaluation verdict.",
      "No production SaaS integration, cryptographic provider attestation, ancestry relation, or adversarial metadata evaluation is included.",
    ],
  };
  const outputDirectory = join(process.cwd(), "benchmark");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "results.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "report.md"),
    renderReport(summary),
    "utf8",
  );

  console.log(`Evaluation: ${verdict}`);
  for (const hypothesis of hypotheses) {
    console.log(
      `${hypothesis.id}: ${hypothesis.status} - ${hypothesis.claim}`,
    );
  }
  console.log(`Report: ${join(outputDirectory, "report.md")}`);
  if (verdict !== "CORE_ASSUMPTION_SUPPORTED_WITH_LIMITS") {
    process.exitCode = 1;
  }
}

await main();
