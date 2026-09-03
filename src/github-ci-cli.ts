#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { WorldCutError } from "./errors.js";
import { verifyLatestGitHubWorkflow } from "./integrations/github-actions.js";

function usage(): string {
  return [
    "Usage: worldcut-github-ci --repository owner/name --workflow ci.yml [options]",
    "",
    "Options:",
    "  --branch <name>       Branch to verify (default: main)",
    "  --token-env <name>    Environment variable containing a GitHub token",
    "  --full                Include verification input and full result",
    "  --help                Show this help",
  ].join("\n");
}

async function main(): Promise<void> {
  let values: {
    repository?: string;
    branch?: string;
    workflow?: string;
    tokenEnv?: string;
    full?: boolean;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({
      options: {
        repository: { type: "string" },
        branch: { type: "string", default: "main" },
        workflow: { type: "string" },
        tokenEnv: { type: "string" },
        full: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    throw new WorldCutError(
      "WORLDCUT_INVALID_ARGUMENT",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
  if (values.help) {
    console.log(usage());
    return;
  }
  if (!values.repository || !values.workflow) {
    throw new WorldCutError(
      "WORLDCUT_INVALID_ARGUMENT",
      "--repository and --workflow are required",
    );
  }
  const tokenEnvironment = values.tokenEnv;
  const token = tokenEnvironment
    ? process.env[tokenEnvironment]
    : process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const verification = await verifyLatestGitHubWorkflow({
    repository: values.repository,
    branch: values.branch ?? "main",
    workflow: values.workflow,
    ...(token ? { token } : {}),
  });
  const output = values.full
    ? verification
    : {
        repository: verification.repository,
        branch: verification.branch,
        workflow: verification.workflow,
        branchSha: verification.branchSha,
        verifiedSha: verification.verifiedSha,
        workflowRun: verification.workflowRun,
        verdict: verification.result.verdict,
        requirements: verification.result.requirementResults.map(
          (requirement) => ({
            id: requirement.requirementId,
            status: requirement.status,
            summary: requirement.summary,
          }),
        ),
        verificationRecordDigest:
          verification.result.verificationRecordDigest,
      };
  console.log(JSON.stringify(output, null, 2));

  if (verification.verifiedSha && process.env.GITHUB_OUTPUT) {
    const runId = verification.workflowRun?.id ?? "";
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `verified_sha=${verification.verifiedSha}\nworkflow_run_id=${runId}\n`,
      "utf8",
    );
  }
  if (verification.result.verdict !== "CONTRACT_SATISFIED") {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof WorldCutError
      ? error.code
      : "WORLDCUT_RUNTIME_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: { code, message } }));
  process.exitCode = 1;
});
