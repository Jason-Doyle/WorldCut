import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContractVerdict, VerificationInput } from "../types.js";
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

let failed = false;
console.log("Fixture                     Verdict");
console.log("--------------------------  ---------------------");

for (const fixture of fixtures) {
  const path = join(process.cwd(), "examples", fixture.file);
  const input = JSON.parse(await readFile(path, "utf8")) as VerificationInput;
  const result = verifyDecisionContract(input);
  console.log(`${fixture.file.padEnd(26)}  ${result.verdict}`);
  if (result.verdict !== fixture.expected) {
    failed = true;
    console.error(
      `Expected ${fixture.expected} for ${fixture.file}, received ${result.verdict}.`,
    );
  }
}

if (failed) {
  process.exitCode = 1;
}
