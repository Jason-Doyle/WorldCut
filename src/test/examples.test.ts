import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ContractVerdict,
  VerificationInput,
} from "../types.js";
import { verifyDecisionContract } from "../verifier.js";

const fixtures: Array<{
  file: string;
  expected: ContractVerdict;
}> = [
  {
    file: "coherent-deployment.json",
    expected: "CONTRACT_SATISFIED",
  },
  {
    file: "git-ci-mismatch.json",
    expected: "CONTRACT_VIOLATED",
  },
  {
    file: "temporal-gap.json",
    expected: "CONTRACT_VIOLATED",
  },
  {
    file: "missing-evidence.json",
    expected: "INSUFFICIENT_EVIDENCE",
  },
];

test("checked example fixtures produce their documented verdicts", () => {
  for (const fixture of fixtures) {
    const path = join(process.cwd(), "examples", fixture.file);
    const input = JSON.parse(
      readFileSync(path, "utf8"),
    ) as VerificationInput;
    const result = verifyDecisionContract(input);
    assert.equal(result.verdict, fixture.expected, fixture.file);
  }
});

test("CLI verifies a fixture and prints structured JSON", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "dist", "cli.js"),
      join(process.cwd(), "examples", "git-ci-mismatch.json"),
    ],
    {
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as {
    verdict: ContractVerdict;
    requirements: Array<{ status: string }>;
  };
  assert.equal(output.verdict, "CONTRACT_VIOLATED");
  assert.equal(output.requirements[0]?.status, "VIOLATED");
});

test("CLI can enforce a satisfied contract for automation", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "dist", "cli.js"),
      join(process.cwd(), "examples", "git-ci-mismatch.json"),
      "--require-satisfied",
    ],
    {
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 2);
});

test("CLI emits a stable JSON error envelope", () => {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "dist", "cli.js"), "missing-file.json"],
    {
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr) as {
    error: { code: string; message: string };
  };
  assert.equal(error.error.code, "WORLDCUT_FILE_READ_FAILED");
  assert.match(error.error.message, /Unable to read/);
});

test("CLI rejects transport bytes that are not valid UTF-8", () => {
  const directory = mkdtempSync(join(tmpdir(), "worldcut-cli-"));
  try {
    const source = readFileSync(
      join(process.cwd(), "examples", "coherent-deployment.json"),
    );
    const marker = source.indexOf(Buffer.from("commit-B", "utf8"));
    assert.ok(marker > 0, "the fixture no longer contains the splice point");
    const path = join(directory, "invalid-utf8.json");
    writeFileSync(
      path,
      Buffer.concat([
        source.subarray(0, marker),
        Buffer.from([0xff, 0xfe]),
        source.subarray(marker),
      ]),
    );

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "dist", "cli.js"), path, "--full"],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1, result.stdout);
    const error = JSON.parse(result.stderr) as {
      error: { code: string; message: string };
    };
    assert.equal(error.error.code, "WORLDCUT_INVALID_JSON");
    assert.match(error.error.message, /not valid UTF-8/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
