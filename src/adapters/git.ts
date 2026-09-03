import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Observation } from "../types.js";

const execFileAsync = promisify(execFile);

export interface CaptureGitHeadOptions {
  repositoryPath: string;
  repositoryId: string;
  branch: string;
  role: string;
  account?: string;
  acquisitionCost?: number;
}

export async function captureGitHead(
  options: CaptureGitHeadOptions,
): Promise<Observation> {
  await execFileAsync(
    "git",
    ["-C", options.repositoryPath, "check-ref-format", "--branch", options.branch],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const { stdout } = await execFileAsync(
    "git",
    [
      "-C",
      options.repositoryPath,
      "rev-parse",
      "--verify",
      `refs/heads/${options.branch}^{commit}`,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const commit = stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) {
    throw new Error("Git returned an invalid commit identifier");
  }

  return {
    id: `git-${randomUUID()}`,
    role: options.role,
    resource: {
      provider: "git",
      account: options.account ?? "local",
      kind: "branch_head",
      key: `${options.repositoryId}/${options.branch}`,
    },
    value: {
      repository: options.repositoryId,
      branch: options.branch,
      commit,
    },
    observedAt: new Date().toISOString(),
    acquisitionCost: options.acquisitionCost ?? 1,
    witness: {
      provenance: "client_observed",
      version: commit,
    },
  };
}
