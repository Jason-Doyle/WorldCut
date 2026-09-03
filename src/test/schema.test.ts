import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv/dist/2020.js";
import { WorldCutInputError } from "../errors.js";
import type { VerificationInput } from "../types.js";
import { verifyDecisionContract } from "../verifier.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const root = process.cwd();
const inputSchema = readJson(
  join(root, "schema", "0.1", "verification-input.schema.json"),
) as AnySchema;
const resultSchema = readJson(
  join(root, "schema", "0.1", "verification-result.schema.json"),
) as AnySchema;
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);
const validateInputSchema = ajv.compile(inputSchema);
const validateResultSchema = ajv.compile(resultSchema);

const fixtureNames = [
  "coherent-deployment.json",
  "git-ci-mismatch.json",
  "missing-evidence.json",
  "temporal-gap.json",
];

test("published schemas validate every checked fixture and result", () => {
  for (const fixtureName of fixtureNames) {
    const input = readJson(
      join(root, "examples", fixtureName),
    ) as VerificationInput;
    assert.equal(
      validateInputSchema(input),
      true,
      `${fixtureName}: ${JSON.stringify(validateInputSchema.errors)}`,
    );
    const result = verifyDecisionContract(input);
    assert.equal(
      validateResultSchema(result),
      true,
      `${fixtureName} result: ${JSON.stringify(validateResultSchema.errors)}`,
    );
  }
});

test("schema and runtime both reject unsupported transport fields", () => {
  const input = readJson(
    join(root, "examples", "coherent-deployment.json"),
  ) as VerificationInput;
  const invalid = structuredClone(input) as unknown as Record<string, unknown>;
  invalid.unsupported = true;

  assert.equal(validateInputSchema(invalid), false);
  assert.throws(
    () => verifyDecisionContract(invalid),
    (error: unknown) =>
      error instanceof WorldCutInputError &&
      error.code === "WORLDCUT_INVALID_INPUT",
  );
});

test("runtime enforces invariants JSON Schema cannot express", () => {
  const input = readJson(
    join(root, "examples", "coherent-deployment.json"),
  ) as VerificationInput;
  const duplicateRole = structuredClone(input);
  const secondObservation = duplicateRole.observations[1];
  assert.ok(secondObservation);
  secondObservation.role = duplicateRole.observations[0]?.role ?? "head";

  assert.equal(validateInputSchema(duplicateRole), true);
  assert.throws(
    () => verifyDecisionContract(duplicateRole),
    /Duplicate observation role/,
  );

  const invalidInterval = structuredClone(input);
  const temporalRequirement = invalidInterval.contract.requirements.find(
    (requirement) => requirement.type === "common_valid_time",
  );
  assert.ok(temporalRequirement?.type === "common_valid_time");
  temporalRequirement.within.until = temporalRequirement.within.from;

  assert.equal(validateInputSchema(invalidInterval), true);
  assert.throws(
    () => verifyDecisionContract(invalidInterval),
    /non-empty half-open interval/,
  );
});

test("schema rejects protocol, enum, timestamp, and cost violations", () => {
  const input = readJson(
    join(root, "examples", "coherent-deployment.json"),
  ) as VerificationInput;
  const cases: unknown[] = [];

  const protocol = structuredClone(input) as unknown as {
    protocolVersion: string;
  };
  protocol.protocolVersion = "1.0";
  cases.push(protocol);

  const provenance = structuredClone(input) as unknown as VerificationInput;
  (
    provenance.observations[0]?.witness as unknown as {
      provenance: string;
    }
  ).provenance = "untrusted";
  cases.push(provenance);

  const timestamp = structuredClone(input);
  timestamp.contract.decisionTime = "2026-09-02";
  cases.push(timestamp);

  const cost = structuredClone(input);
  const firstObservation = cost.observations[0];
  assert.ok(firstObservation);
  firstObservation.acquisitionCost = -1;
  cases.push(cost);

  const excessiveCost = structuredClone(input);
  const costlyObservation = excessiveCost.observations[0];
  assert.ok(costlyObservation);
  costlyObservation.acquisitionCost = 1_000_000_001;
  cases.push(excessiveCost);

  for (const invalid of cases) {
    assert.equal(validateInputSchema(invalid), false);
  }
});
