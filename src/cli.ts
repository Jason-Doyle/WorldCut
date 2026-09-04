#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WorldCutError } from "./errors.js";
import type { VerificationInput, VerificationResult } from "./types.js";
import { verifyDecisionContract } from "./verifier.js";

interface CliOptions {
  inputPath: string;
  full: boolean;
  requireSatisfied: boolean;
}

function usage(): string {
  return [
    "Usage: worldcut <verification.json> [options]",
    "",
    "Options:",
    "  --full               Print the complete verification result",
    "  --require-satisfied  Exit with code 2 unless the contract is satisfied",
    "  --help               Show this help",
  ].join("\n");
}

function parseArguments(arguments_: string[]): CliOptions | null {
  if (arguments_.includes("--help")) {
    return null;
  }

  const supportedFlags = new Set(["--full", "--require-satisfied"]);
  const unknownFlags = arguments_.filter(
    (argument) => argument.startsWith("-") && !supportedFlags.has(argument),
  );
  if (unknownFlags.length > 0) {
    throw new WorldCutError(
      "WORLDCUT_INVALID_ARGUMENT",
      `Unknown option: ${unknownFlags.join(", ")}`,
    );
  }

  const positional = arguments_.filter(
    (argument) => !argument.startsWith("-"),
  );
  if (positional.length !== 1) {
    throw new WorldCutError(
      "WORLDCUT_INVALID_ARGUMENT",
      "Exactly one verification JSON file is required",
    );
  }

  const inputPath = positional[0];
  if (!inputPath) {
    throw new WorldCutError(
      "WORLDCUT_INVALID_ARGUMENT",
      "Verification JSON path is empty",
    );
  }
  return {
    inputPath,
    full: arguments_.includes("--full"),
    requireSatisfied: arguments_.includes("--require-satisfied"),
  };
}

function summary(result: VerificationResult): object {
  return {
    protocolVersion: result.protocolVersion,
    engineVersion: result.engineVersion,
    contractId: result.contractId,
    verdict: result.verdict,
    coverage: result.coverage,
    requirements: result.requirementResults.map((requirement) => ({
      id: requirement.requirementId,
      type: requirement.requirementType,
      required: requirement.required,
      status: requirement.status,
      summary: requirement.summary,
    })),
    acquisitionPlan: result.acquisitionPlan,
    verificationRecordDigest: result.verificationRecordDigest,
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    console.log(usage());
    return;
  }

  const inputPath = resolve(options.inputPath);
  let bytes: Buffer;
  try {
    bytes = await readFile(inputPath);
  } catch (error) {
    throw new WorldCutError(
      "WORLDCUT_FILE_READ_FAILED",
      `Unable to read ${inputPath}`,
      { cause: error },
    );
  }
  // Node's lossy UTF-8 decoding would substitute U+FFFD for malformed bytes and
  // then verify the corrupted evidence. Every other WorldCut port rejects
  // transport bytes that are not valid UTF-8, so this one does too.
  // `ignoreBOM` keeps a leading U+FEFF in the string, where JSON.parse rejects
  // it, instead of silently accepting a byte-order mark the other ports refuse.
  let source: string;
  try {
    source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch (error) {
    throw new WorldCutError(
      "WORLDCUT_INVALID_JSON",
      `${inputPath} is not valid UTF-8`,
      { cause: error },
    );
  }
  let input: VerificationInput;
  try {
    input = JSON.parse(source) as VerificationInput;
  } catch (error) {
    throw new WorldCutError(
      "WORLDCUT_INVALID_JSON",
      `${inputPath} is not valid JSON`,
      { cause: error },
    );
  }
  const result = verifyDecisionContract(input);
  console.log(
    JSON.stringify(options.full ? result : summary(result), null, 2),
  );

  if (
    options.requireSatisfied &&
    result.verdict !== "CONTRACT_SATISFIED"
  ) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof WorldCutError
      ? error.code
      : "WORLDCUT_RUNTIME_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
  );
  process.exitCode = 1;
});
