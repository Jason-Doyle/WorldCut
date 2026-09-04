import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

/**
 * The differential suite itself needs Go, Python, and .NET toolchains, but its
 * deterministic self-checks do not. Running them here keeps a regression in the
 * seeded generator, the raw-lexeme writer, or the structural comparison from
 * silently weakening the cross-language gate.
 */
test("differential harness self-checks pass", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "scripts", "differential.mjs"),
      "--self-check-only",
      "--count",
      "200",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /self-checks passed/);
});

test("differential corpus lists every case category", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "scripts", "differential.mjs"),
      "--list",
      "--count",
      "3",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  for (const category of [
    "golden",
    "invalid",
    "raw",
    "example",
    "edge",
    "transport",
    "random",
  ]) {
    assert.match(result.stdout, new RegExp(`${category}=\\d+`), category);
  }
  assert.match(result.stdout, /edge\/number-underflow-positive/);
});

test("differential harness rejects unknown options", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "scripts", "differential.mjs"),
      "--self-check-only",
      "--seeed",
      "typo",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option: --seeed/);
});

test("differential harness rejects partially numeric options", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "scripts", "differential.mjs"),
      "--self-check-only",
      "--count",
      "500cases",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--count must be an integer/);
});

test("focused differential runs retain digest-equivalence twins", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "scripts", "differential.mjs"),
      "--list",
      "--count",
      "0",
      "--only",
      "edge/unicode-escaped-input",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /edge\/unicode-escaped-input/);
  assert.match(result.stdout, /edge\/unicode-escaped-literal/);
  assert.match(result.stdout, /2 cases/);
});
