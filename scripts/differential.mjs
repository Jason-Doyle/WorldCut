#!/usr/bin/env node
/**
 * Cross-language differential verification.
 *
 * Runs the TypeScript, Go, Python, and .NET WorldCut CLIs over one identical
 * corpus of transport bytes and compares their complete parsed verification
 * results. TypeScript is the oracle: every other port must reproduce its result
 * exactly, or fail with the same stable error code, or - for malformed
 * transport bytes - fail with an outcome that `spec/0.1/CONFORMANCE.md`
 * explicitly permits.
 *
 * Usage:
 *   node scripts/differential.mjs [--seed <seed>] [--count <n>] [--only <substring>]
 *                                 [--category <name>] [--jobs <n>]
 *                                 [--max-failures <n>] [--timeout-ms <n>]
 *                                 [--list] [--self-check-only]
 *
 * Environment overrides:
 *   WORLDCUT_GO, WORLDCUT_PYTHON, WORLDCUT_DOTNET, WORLDCUT_NODE,
 *   WORLDCUT_DOTNET_FRAMEWORK, WORLDCUT_DIFFERENTIAL_SEED,
 *   WORLDCUT_DIFFERENTIAL_COUNT, WORLDCUT_DIFFERENTIAL_JOBS,
 *   WORLDCUT_DIFFERENTIAL_TIMEOUT_MS
 */

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deterministicCases,
  selectCases,
} from "./differential/corpus.mjs";
import { generateRandomCases } from "./differential/generate.mjs";
import {
  DIGEST_PATTERN,
  diffJson,
  preview,
  toRawOutcome,
} from "./differential/compare.mjs";
import { prepareRunners, runPort } from "./differential/ports.mjs";
import { runSelfChecks } from "./differential/self-check.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The seed used by CI and by every documented reproduction command. */
const DEFAULT_SEED = "worldcut-0.1";

/** The randomized case count used by CI. */
const DEFAULT_COUNT = 500;

/** Fraction of randomized cases that must verify successfully. */
const MIN_RANDOM_SUCCESS_RATIO = 0.75;

/**
 * @param {string} raw
 * @param {string} name
 * @param {number} minimum
 * @returns {number}
 */
function parseIntegerOption(raw, name, minimum) {
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${name} must be an integer, got ${raw}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${name} must be an integer of at least ${minimum}, got ${raw}`,
    );
  }
  return value;
}

/**
 * @param {string[]} argv
 * @returns {{
 *   seed: string,
 *   count: number,
 *   only: string | null,
 *   category: string | null,
 *   jobs: number,
 *   list: boolean,
 *   selfCheckOnly: boolean,
 *   maxFailures: number,
 *   timeoutMs: number,
 * }}
 */
function parseArguments(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  const booleans = new Set();
  const valueFlags = new Set([
    "seed",
    "count",
    "only",
    "category",
    "jobs",
    "max-failures",
    "timeout-ms",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined || !argument.startsWith("--")) {
      throw new Error(`unexpected argument: ${String(argument)}`);
    }
    const name = argument.slice(2);
    if (name === "list" || name === "self-check-only") {
      booleans.add(name);
      continue;
    }
    if (!valueFlags.has(name)) {
      throw new Error(`unknown option: --${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`--${name} requires a value`);
    }
    flags[name] = value;
    index += 1;
  }

  const seed =
    flags["seed"] ?? process.env["WORLDCUT_DIFFERENTIAL_SEED"] ?? DEFAULT_SEED;
  const rawCount =
    flags["count"] ??
    process.env["WORLDCUT_DIFFERENTIAL_COUNT"] ??
    String(DEFAULT_COUNT);
  const count = parseIntegerOption(rawCount, "--count", 0);
  const rawJobs =
    flags["jobs"] ??
    process.env["WORLDCUT_DIFFERENTIAL_JOBS"] ??
    String(Math.max(2, Math.min(6, availableParallelism())));
  const jobs = parseIntegerOption(rawJobs, "--jobs", 1);
  const rawMaxFailures = flags["max-failures"] ?? "10";
  const maxFailures = parseIntegerOption(
    rawMaxFailures,
    "--max-failures",
    1,
  );
  const rawTimeoutMs =
    flags["timeout-ms"] ??
    process.env["WORLDCUT_DIFFERENTIAL_TIMEOUT_MS"] ??
    "60000";
  const timeoutMs = parseIntegerOption(rawTimeoutMs, "--timeout-ms", 1000);

  return {
    seed,
    count,
    only: flags["only"] ?? null,
    category: flags["category"] ?? null,
    jobs,
    list: booleans.has("list"),
    selfCheckOnly: booleans.has("self-check-only"),
    maxFailures,
    timeoutMs,
  };
}

/**
 * Renders transport bytes for a failure report without leaking anything else.
 *
 * @param {Buffer} bytes
 * @returns {string}
 */
function describeInput(bytes) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const header = `      bytes: ${bytes.length}, sha256: ${digest}`;
  const text = bytes.toString("utf8");
  const roundTrips = Buffer.from(text, "utf8").equals(bytes);
  if (roundTrips && bytes.length <= 8192) {
    return `${header}\n      input: ${JSON.stringify(text)}`;
  }
  return `${header}\n      input(base64): ${bytes.toString("base64")}`;
}

/**
 * @param {import("./differential/ports.mjs").PortOutcome} outcome
 * @returns {string}
 */
function describeOutcome(outcome) {
  if (outcome.kind === "result") {
    const digest = /** @type {{ verificationRecordDigest?: unknown }} */ (
      outcome.result
    )?.verificationRecordDigest;
    return `exit 0, digest ${String(digest)}`;
  }
  if (outcome.kind === "error") {
    return `exit ${outcome.status}, ${outcome.code}: ${preview(outcome.message, 120)}`;
  }
  return `exit ${outcome.status}, ${outcome.failure ?? "unusable output"}`;
}

/**
 * Compares one case across every port.
 *
 * @param {import("./differential/corpus.mjs").DifferentialCase} testCase
 * @param {import("./differential/ports.mjs").PortRunner[]} runners
 * @param {Map<string, import("./differential/ports.mjs").PortOutcome>} outcomes
 * @returns {string[]} Problem descriptions; empty when the case agrees.
 */
function compareCase(testCase, runners, outcomes) {
  /** @type {string[]} */
  const problems = [];

  for (const runner of runners) {
    const outcome = outcomes.get(runner.id);
    if (outcome === undefined) {
      problems.push(`${runner.id}: produced no outcome`);
      continue;
    }
    if (outcome.kind === "unusable") {
      problems.push(`${runner.id}: ${outcome.failure}`);
    }
  }
  if (problems.length > 0) {
    return problems;
  }

  if (testCase.expect === "transport") {
    const allowed = testCase.allowed ?? [];
    for (const runner of runners) {
      const outcome = /** @type {import("./differential/ports.mjs").PortOutcome} */ (
        outcomes.get(runner.id)
      );
      if (outcome.kind !== "error") {
        problems.push(
          `${runner.id}: accepted malformed transport bytes (${describeOutcome(outcome)})`,
        );
        continue;
      }
      const observed = toRawOutcome(outcome.code ?? "");
      if (observed === null || !allowed.includes(observed)) {
        problems.push(
          `${runner.id}: error code ${outcome.code} is not an allowed transport rejection (${allowed.join(", ")})`,
        );
      }
    }
    return problems;
  }

  if (testCase.expect === "code") {
    for (const runner of runners) {
      const outcome = /** @type {import("./differential/ports.mjs").PortOutcome} */ (
        outcomes.get(runner.id)
      );
      if (outcome.kind !== "error") {
        problems.push(
          `${runner.id}: accepted an invalid input (${describeOutcome(outcome)})`,
        );
        continue;
      }
      if (outcome.code !== testCase.code) {
        problems.push(
          `${runner.id}: error code ${outcome.code}, expected ${testCase.code}`,
        );
      }
    }
    return problems;
  }

  const oracle = /** @type {import("./differential/ports.mjs").PortOutcome} */ (
    outcomes.get("typescript")
  );

  if (testCase.expect === "result" && oracle.kind !== "result") {
    problems.push(
      `typescript: expected a verification result but got ${describeOutcome(oracle)}`,
    );
    return problems;
  }

  if (oracle.kind === "error") {
    for (const runner of runners) {
      if (runner.id === "typescript") {
        continue;
      }
      const outcome = /** @type {import("./differential/ports.mjs").PortOutcome} */ (
        outcomes.get(runner.id)
      );
      if (outcome.kind !== "error") {
        problems.push(
          `${runner.id}: accepted an input TypeScript rejected with ${oracle.code}`,
        );
        continue;
      }
      if (outcome.code !== oracle.code) {
        problems.push(
          `${runner.id}: error code ${outcome.code}, TypeScript reported ${oracle.code}`,
        );
      }
    }
    return problems;
  }

  const oracleResult = /** @type {Record<string, unknown>} */ (oracle.result);
  const oracleDigest = oracleResult["verificationRecordDigest"];
  if (typeof oracleDigest !== "string" || !DIGEST_PATTERN.test(oracleDigest)) {
    problems.push(
      `typescript: verificationRecordDigest ${preview(oracleDigest)} is not 64 lowercase hex characters`,
    );
  }

  if (testCase.expectedResult !== undefined) {
    const golden = diffJson(testCase.expectedResult, oracleResult, {
      limit: 5,
    });
    for (const difference of golden) {
      problems.push(
        `typescript: committed vector mismatch at ${difference.path || "/"} (${difference.reason}): expected ${preview(difference.expected)}, got ${preview(difference.actual)}`,
      );
    }
  }

  for (const runner of runners) {
    if (runner.id === "typescript") {
      continue;
    }
    const outcome = /** @type {import("./differential/ports.mjs").PortOutcome} */ (
      outcomes.get(runner.id)
    );
    if (outcome.kind !== "result") {
      problems.push(
        `${runner.id}: TypeScript verified this input but the port reported ${describeOutcome(outcome)}`,
      );
      continue;
    }
    const portResult = /** @type {Record<string, unknown>} */ (outcome.result);
    const portDigest = portResult["verificationRecordDigest"];
    if (typeof portDigest !== "string" || !DIGEST_PATTERN.test(portDigest)) {
      problems.push(
        `${runner.id}: verificationRecordDigest ${preview(portDigest)} is not 64 lowercase hex characters`,
      );
    } else if (portDigest !== oracleDigest) {
      problems.push(
        `${runner.id}: verificationRecordDigest ${portDigest} != ${String(oracleDigest)}`,
      );
    }
    for (const difference of diffJson(oracleResult, portResult, { limit: 8 })) {
      problems.push(
        `${runner.id}: ${difference.path || "/"} (${difference.reason}): TypeScript ${preview(difference.expected)}, port ${preview(difference.actual)}`,
      );
    }
  }

  return problems;
}

/**
 * Renders a tally as a stable, human-readable summary.
 *
 * @param {Map<string, number>} counts
 * @returns {string}
 */
function describeCounts(counts) {
  if (counts.size === 0) {
    return "none";
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, total]) => `${name}=${total}`)
    .join(" ");
}

/**
 * Runs an async worker over a list with bounded concurrency, preserving order.
 *
 * @template T
 * @template R
 * @param {readonly T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapWithLimit(items, limit, worker) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      const item = items[index];
      if (item === undefined) {
        return;
      }
      results[index] = await worker(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const started = Date.now();
  const options = parseArguments(process.argv.slice(2));

  /** @type {import("./differential/corpus.mjs").DifferentialCase[]} */
  const allCases = [
    ...deterministicCases(REPO_ROOT),
    ...generateRandomCases(options.seed, options.count).map((entry) => ({
      id: entry.id,
      category: entry.category,
      bytes: Buffer.from(entry.text, "utf8"),
      expect: /** @type {"oracle"} */ ("oracle"),
      note: "seeded randomized input",
    })),
  ];

  const selfCheck = runSelfChecks(allCases, options.count);
  console.log(
    `self-checks passed (${selfCheck.assertions} assertion groups, seed ${options.seed})`,
  );
  if (options.selfCheckOnly) {
    return;
  }

  const selected = selectCases(allCases, options);

  /** @type {Map<string, number>} */
  const categoryCounts = new Map();
  for (const entry of selected) {
    categoryCounts.set(
      entry.category,
      (categoryCounts.get(entry.category) ?? 0) + 1,
    );
  }
  const summary = [...categoryCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, total]) => `${name}=${total}`)
    .join(" ");

  if (options.list) {
    for (const entry of selected) {
      console.log(`${entry.category}\t${entry.id}\t${entry.note ?? ""}`);
    }
    console.log(`\n${selected.length} cases (${summary})`);
    return;
  }

  if (selected.length === 0) {
    throw new Error("no cases matched the requested filters");
  }

  const workspace = mkdtempSync(join(tmpdir(), "worldcut-differential-"));
  let failures = 0;
  try {
    const runners = await prepareRunners({
      repoRoot: REPO_ROOT,
      workspace,
      timeoutMs: options.timeoutMs,
      log: (line) => console.log(`  ${line}`),
    });
    console.log(
      `ports: ${runners.map((runner) => `${runner.label} (${runner.description})`).join(", ")}`,
    );
    console.log(
      `running ${selected.length} cases (${summary}) with ${options.jobs} parallel workers`,
    );

    /** @type {Map<string, string>} */
    const digests = new Map();
    /** @type {Map<string, number>} */
    const verdicts = new Map();
    /** @type {Map<string, number>} */
    const planStatuses = new Map();
    /** @type {Map<string, number>} */
    const randomVerdicts = new Map();
    let randomSuccesses = 0;
    let randomTotal = 0;
    /** @type {string[]} */
    const report = [];

    const outcomes = await mapWithLimit(
      selected,
      options.jobs,
      async (testCase, index) => {
        const inputPath = join(workspace, `case-${index}.json`);
        writeFileSync(inputPath, testCase.bytes);
        try {
          /** @type {Map<string, import("./differential/ports.mjs").PortOutcome>} */
          const perPort = new Map();
          const results = await Promise.all(
            runners.map(async (runner) => ({
              id: runner.id,
              outcome: await runPort(runner, inputPath),
            })),
          );
          for (const entry of results) {
            perPort.set(entry.id, entry.outcome);
          }
          return { testCase, perPort };
        } finally {
          rmSync(inputPath, { force: true });
        }
      },
    );

    for (const { testCase, perPort } of outcomes) {
      const problems = compareCase(testCase, runners, perPort);
      const oracle = perPort.get("typescript");
      if (testCase.category === "random") {
        randomTotal += 1;
        if (oracle?.kind === "result") {
          randomSuccesses += 1;
        }
      }
      if (oracle?.kind === "result") {
        const oracleResult = /** @type {Record<string, unknown>} */ (
          oracle.result
        );
        const digest = oracleResult["verificationRecordDigest"];
        if (typeof digest === "string") {
          digests.set(testCase.id, digest);
        }
        const verdict = oracleResult["verdict"];
        if (typeof verdict === "string") {
          verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1);
          if (testCase.category === "random") {
            randomVerdicts.set(
              verdict,
              (randomVerdicts.get(verdict) ?? 0) + 1,
            );
          }
        }
        const planStatus = /** @type {{ status?: unknown } | undefined} */ (
          oracleResult["acquisitionPlan"]
        )?.status;
        if (typeof planStatus === "string") {
          planStatuses.set(
            planStatus,
            (planStatuses.get(planStatus) ?? 0) + 1,
          );
        }
      }
      if (problems.length === 0) {
        continue;
      }
      failures += 1;
      if (failures <= options.maxFailures) {
        report.push(
          [
            `\nFAIL ${testCase.id} [${testCase.category}]`,
            testCase.note === undefined ? null : `      note: ${testCase.note}`,
            `      seed: ${options.seed}, count: ${options.count}`,
            `      reproduce: npm run differential -- --seed ${options.seed} --count ${options.count} --only ${testCase.id}`,
            describeInput(testCase.bytes),
            ...problems.map((problem) => `      ${problem}`),
          ]
            .filter((line) => line !== null)
            .join("\n"),
        );
      }
    }

    for (const testCase of selected) {
      if (testCase.sameDigestAs === undefined) {
        continue;
      }
      const own = digests.get(testCase.id);
      const twin = digests.get(testCase.sameDigestAs);
      if (own === undefined || twin === undefined) {
        failures += 1;
        report.push(
          `\nFAIL ${testCase.id} [${testCase.category}]\n      digest-equivalence twin ${testCase.sameDigestAs} did not produce a comparable result`,
        );
        continue;
      }
      if (own !== twin) {
        failures += 1;
        report.push(
          `\nFAIL ${testCase.id} [${testCase.category}]\n      digest ${own} differs from ${testCase.sameDigestAs} digest ${twin}, but the two documents are canonically identical`,
        );
      }
    }

    if (
      randomTotal > 0 &&
      randomSuccesses < Math.ceil(randomTotal * MIN_RANDOM_SUCCESS_RATIO)
    ) {
      failures += 1;
      report.push(
        `\nFAIL generator quality\n      only ${randomSuccesses}/${randomTotal} randomized cases produced a verification result; the generator must exercise the success path`,
      );
    }

    if (randomTotal >= 50) {
      for (const verdict of [
        "CONTRACT_SATISFIED",
        "CONTRACT_VIOLATED",
        "INSUFFICIENT_EVIDENCE",
      ]) {
        if ((randomVerdicts.get(verdict) ?? 0) === 0) {
          failures += 1;
          report.push(
            `\nFAIL generator coverage\n      no randomized case reached ${verdict}; the generator no longer exercises every verdict`,
          );
        }
      }
    }

    for (const entry of report) {
      console.error(entry);
    }
    if (failures > options.maxFailures) {
      console.error(
        `\n… ${failures - options.maxFailures} further failing cases were not printed`,
      );
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (failures === 0) {
      console.log(
        `\nOK ${selected.length} cases agreed across ${runners.length} implementations in ${elapsed}s`,
      );
      console.log(`   verdicts: ${describeCounts(verdicts)}`);
      console.log(`   acquisition plans: ${describeCounts(planStatuses)}`);
      if (randomTotal > 0) {
        console.log(
          `   ${randomSuccesses}/${randomTotal} randomized cases produced a verification result (${describeCounts(randomVerdicts)})`,
        );
      }
      return;
    }
    console.error(
      `\nFAILED ${failures}/${selected.length} cases diverged (${elapsed}s)`,
    );
    process.exitCode = 1;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `differential harness error: ${error instanceof Error ? error.message : String(error)}`,
  );
  if (error instanceof Error && error.stack !== undefined) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
