import { randomUUID } from "node:crypto";
import {
  WorldCutIntegrationError,
} from "../errors.js";
import type {
  CoherenceContract,
  Observation,
  ResourceIdentity,
  VerificationInput,
  VerificationResult,
} from "../types.js";
import { verifyDecisionContract } from "../verifier.js";

export interface VerifyGitHubWorkflowOptions {
  repository: string;
  branch: string;
  workflow: string;
  token?: string;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
}

export interface GitHubWorkflowRunEvidence {
  id: number;
  workflowId: number;
  headSha: string;
  headBranch: string;
  event: "push";
  status: "completed";
  conclusion: string;
  url: string;
}

export interface GitHubWorkflowVerification {
  repository: string;
  branch: string;
  workflow: string;
  branchSha: string;
  verifiedSha: string | null;
  workflowRun: GitHubWorkflowRunEvidence | null;
  input: VerificationInput;
  result: VerificationResult;
}

export interface GitHubWorkflowEvidenceCoverage {
  repository: string;
  branch: string;
  workflow: string;
  inspectedRuns: number;
  dependencyEvidenceAvailable: number;
  conclusionEvidenceAvailable: number;
  completeEvidenceRuns: number;
  evidenceCoverage: number;
  conclusions: Record<string, number>;
}

interface GitHubWorkflowRunResponse {
  workflow_runs: unknown[];
}

function requireRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      `${field} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      `GitHub response field ${field} must be a non-empty string`,
    );
  }
  return value;
}

function requireNumber(
  record: Record<string, unknown>,
  field: string,
): number {
  const value = record[field];
  if (!Number.isSafeInteger(value)) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      `GitHub response field ${field} must be a safe integer`,
    );
  }
  return value as number;
}

function requireSha(value: string, field: string): string {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      `${field} must be a full Git commit SHA`,
    );
  }
  return value;
}

function validateOptions(options: VerifyGitHubWorkflowOptions): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "repository must use owner/name form",
    );
  }
  if (options.branch.trim().length === 0) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "branch must not be empty",
    );
  }
  if (
    !/^[0-9]+$/.test(options.workflow) &&
    !/^[A-Za-z0-9_.-]+\.ya?ml$/i.test(options.workflow)
  ) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "workflow must be a numeric workflow ID or workflow filename",
    );
  }
}

function normalizeApiBaseUrl(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  const normalized = value.slice(0, end);
  if (normalized.length === 0) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "apiBaseUrl must not be empty",
    );
  }
  return normalized;
}

async function githubJson(
  fetchImplementation: typeof fetch,
  url: string,
  token: string | undefined,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "worldcut",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
    });
  } catch (error) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_API_ERROR",
      `GitHub request failed for ${url}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    const body = await response.text();
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_API_ERROR",
      `GitHub request returned ${response.status}: ${body.slice(0, 500)}`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      `GitHub returned invalid JSON for ${url}`,
      { cause: error },
    );
  }
}

function workflowRunFromResponse(
  value: unknown,
  repository: string,
  branch: string,
): GitHubWorkflowRunEvidence {
  const run = requireRecord(value, "workflow run");
  const headRepository = requireRecord(
    run.head_repository,
    "workflow run head_repository",
  );
  const fullName = requireString(headRepository, "full_name");
  const headBranch = requireString(run, "head_branch");
  const event = requireString(run, "event");
  const status = requireString(run, "status");

  if (fullName.toLowerCase() !== repository.toLowerCase()) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      `Workflow run belongs to ${fullName}, not ${repository}`,
    );
  }
  if (headBranch !== branch || event !== "push" || status !== "completed") {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "Workflow run does not match the requested branch, push event, and completed status",
    );
  }

  return {
    id: requireNumber(run, "id"),
    workflowId: requireNumber(run, "workflow_id"),
    headSha: requireSha(requireString(run, "head_sha"), "workflow head_sha"),
    headBranch,
    event: "push",
    status: "completed",
    conclusion: requireString(run, "conclusion"),
    url: requireString(run, "html_url"),
  };
}

function branchShaFromResponse(value: unknown): string {
  const branch = requireRecord(value, "branch");
  const commit = requireRecord(branch.commit, "branch commit");
  return requireSha(requireString(commit, "sha"), "branch commit sha");
}

export async function verifyLatestGitHubWorkflow(
  options: VerifyGitHubWorkflowOptions,
): Promise<GitHubWorkflowVerification> {
  validateOptions(options);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const apiBaseUrl = normalizeApiBaseUrl(
    options.apiBaseUrl ?? "https://api.github.com",
  );
  const [owner, repositoryName] = options.repository.split("/");
  if (!owner || !repositoryName) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "repository must use owner/name form",
    );
  }

  const repositoryPath = `${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`;
  const workflowUrl =
    `${apiBaseUrl}/repos/${repositoryPath}/actions/workflows/` +
    `${encodeURIComponent(options.workflow)}/runs?` +
    `branch=${encodeURIComponent(options.branch)}&event=push&` +
    "status=completed&exclude_pull_requests=true&per_page=1";
  const runsResponse = requireRecord(
    await githubJson(
      fetchImplementation,
      workflowUrl,
      options.token,
    ),
    "workflow runs response",
  ) as unknown as GitHubWorkflowRunResponse;
  if (!Array.isArray(runsResponse.workflow_runs)) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "GitHub workflow_runs must be an array",
    );
  }
  const run =
    runsResponse.workflow_runs.length === 0
      ? null
      : workflowRunFromResponse(
          runsResponse.workflow_runs[0],
          options.repository,
          options.branch,
        );
  const runObservedAt = new Date().toISOString();

  const branchUrl =
    `${apiBaseUrl}/repos/${repositoryPath}/branches/` +
    encodeURIComponent(options.branch);
  const branchSha = branchShaFromResponse(
    await githubJson(
      fetchImplementation,
      branchUrl,
      options.token,
    ),
  );
  const branchObservedAt = new Date().toISOString();
  const decisionTime = new Date().toISOString();
  const branchResource: ResourceIdentity = {
    provider: "github",
    account: options.repository,
    kind: "branch_head",
    key: options.branch,
  };
  const headObservation: Observation = {
    id: `github-head-${randomUUID()}`,
    role: "head",
    resource: branchResource,
    value: {
      repository: options.repository,
      branch: options.branch,
      sha: branchSha,
    },
    observedAt: branchObservedAt,
    acquisitionCost: 1,
    witness: {
      provenance: "provider_asserted",
      version: branchSha,
    },
  };
  const observations: Observation[] = [headObservation];
  if (run) {
    observations.push({
      id: `github-run-${randomUUID()}`,
      role: "ci",
      resource: {
        provider: "github-actions",
        account: options.repository,
        kind: "workflow_run",
        key: `${options.workflow}/${run.id}`,
      },
      value: {
        conclusion: run.conclusion,
        event: run.event,
        headSha: run.headSha,
        runId: run.id,
        status: run.status,
        url: run.url,
        workflowId: run.workflowId,
      },
      observedAt: runObservedAt,
      acquisitionCost: 2,
      witness: {
        provenance: "provider_asserted",
        version: String(run.id),
        dependencies: [
          {
            name: "tested_head",
            resource: branchResource,
            relation: "exact",
            version: run.headSha,
            provenance: "provider_asserted",
          },
        ],
      },
    });
  }
  const contract: CoherenceContract = {
    id: "github-latest-completed-push",
    version: "1",
    decisionTime,
    assumptions: {
      clockModel: "trusted_normalized",
      intervalModel: "half_open",
      metadataModel: "honest_but_possibly_incomplete",
    },
    requirements: [
      {
        id: "workflow-conclusion-success",
        type: "value_equals",
        description: "The latest completed push workflow concluded successfully",
        role: "ci",
        path: ["conclusion"],
        expected: "success",
      },
      {
        id: "workflow-tested-current-head",
        type: "dependency",
        description: "The workflow run tested the selected branch head",
        dependentRole: "ci",
        targetRole: "head",
        dependencyName: "tested_head",
      },
    ],
  };
  const input: VerificationInput = {
    protocolVersion: "0.1",
    contract,
    observations,
  };
  const result = verifyDecisionContract(input);

  return {
    repository: options.repository,
    branch: options.branch,
    workflow: options.workflow,
    branchSha,
    verifiedSha:
      result.verdict === "CONTRACT_SATISFIED" ? branchSha : null,
    workflowRun: run,
    input,
    result,
  };
}

export async function inspectGitHubWorkflowEvidence(
  options: VerifyGitHubWorkflowOptions,
  limit = 20,
): Promise<GitHubWorkflowEvidenceCoverage> {
  validateOptions(options);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "history limit must be an integer from 1 through 100",
    );
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const apiBaseUrl = normalizeApiBaseUrl(
    options.apiBaseUrl ?? "https://api.github.com",
  );
  const [owner, repositoryName] = options.repository.split("/");
  if (!owner || !repositoryName) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "repository must use owner/name form",
    );
  }
  const repositoryPath = `${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`;
  const workflowUrl =
    `${apiBaseUrl}/repos/${repositoryPath}/actions/workflows/` +
    `${encodeURIComponent(options.workflow)}/runs?` +
    `branch=${encodeURIComponent(options.branch)}&event=push&` +
    `status=completed&exclude_pull_requests=true&per_page=${limit}`;
  const response = requireRecord(
    await githubJson(
      fetchImplementation,
      workflowUrl,
      options.token,
    ),
    "workflow runs response",
  ) as unknown as GitHubWorkflowRunResponse;
  if (!Array.isArray(response.workflow_runs)) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_GITHUB_RESPONSE_INVALID",
      "GitHub workflow_runs must be an array",
    );
  }
  const runs = response.workflow_runs.map((run) =>
    workflowRunFromResponse(run, options.repository, options.branch),
  );
  const conclusions: Record<string, number> = {};
  for (const run of runs) {
    conclusions[run.conclusion] = (conclusions[run.conclusion] ?? 0) + 1;
  }
  const completeEvidenceRuns = runs.filter(
    (run) => run.headSha.length === 40 && run.conclusion.length > 0,
  ).length;

  return {
    repository: options.repository,
    branch: options.branch,
    workflow: options.workflow,
    inspectedRuns: runs.length,
    dependencyEvidenceAvailable: runs.length,
    conclusionEvidenceAvailable: runs.length,
    completeEvidenceRuns,
    evidenceCoverage:
      runs.length === 0 ? 0 : completeEvidenceRuns / runs.length,
    conclusions,
  };
}
