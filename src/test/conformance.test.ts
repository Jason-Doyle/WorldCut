import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  canonicalJson,
  sha256Digest,
  verifyDecisionContract,
  WorldCutError,
} from "../index.js";

function readVectorFile(name: string): {
  cases: Array<Record<string, unknown>>;
} {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), "conformance", "0.1", name),
      "utf8",
    ),
  ) as { cases: Array<Record<string, unknown>> };
}

test("verification vectors match the TypeScript reference", () => {
  const vectors = readVectorFile("verification-vectors.json");
  for (const vector of vectors.cases) {
    assert.deepEqual(
      verifyDecisionContract(vector.input),
      vector.expected,
      String(vector.name),
    );
  }
});

test("invalid vectors return their stable error codes", () => {
  const vectors = readVectorFile("invalid-vectors.json");
  for (const vector of vectors.cases) {
    assert.throws(
      () => verifyDecisionContract(vector.input),
      (error: unknown) =>
        error instanceof WorldCutError &&
        error.code === vector.expectedErrorCode,
      String(vector.name),
    );
  }
});

test("canonicalization vectors match byte and digest output", () => {
  const vectors = readVectorFile("canonicalization-vectors.json");
  for (const vector of vectors.cases) {
    assert.equal(
      canonicalJson(vector.value),
      vector.expectedCanonicalJson,
      String(vector.name),
    );
    assert.equal(
      sha256Digest(vector.value),
      vector.expectedSha256,
      String(vector.name),
    );
  }
});

test("raw vectors fail during parsing or structured validation", () => {
  const vectors = readVectorFile("raw-vectors.json");
  for (const vector of vectors.cases) {
    const path = join(
      process.cwd(),
      "conformance",
      "0.1",
      String(vector.file),
    );
    const source = readFileSync(path, "utf8");
    let outcome = "PARSE_ERROR";
    try {
      const input = JSON.parse(source) as unknown;
      try {
        verifyDecisionContract(input);
        assert.fail(`${String(vector.name)} unexpectedly verified`);
      } catch (error) {
        outcome =
          error instanceof WorldCutError
            ? error.code
            : "UNSTRUCTURED_ERROR";
      }
    } catch {
      outcome = "PARSE_ERROR";
    }
    assert.ok(
      (vector.acceptedOutcomes as string[]).includes(outcome),
      `${String(vector.name)} produced ${outcome}`,
    );
  }
});
