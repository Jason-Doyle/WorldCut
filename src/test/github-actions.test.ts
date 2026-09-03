import assert from "node:assert/strict";
import test from "node:test";
import { WorldCutIntegrationError } from "../errors.js";
import {
  inspectGitHubWorkflowEvidence,
  verifyLatestGitHubWorkflow,
} from "../integrations/github-actions.js";

const currentSha = "b".repeat(40);
const staleSha = "a".repeat(40);

function mockGitHub(options: {
  branchSha?: string;
  run?: null | {
    headSha: string;
    conclusion: string;
    event?: string;
    branch?: string;
    repository?: string;
  };
  status?: number;
}): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (options.status) {
      return new Response("failure", { status: options.status });
    }
    if (url.includes("/actions/workflows/")) {
      assert.match(url, /event=push/);
      assert.match(url, /status=completed/);
      assert.match(url, /exclude_pull_requests=true/);
      return Response.json({
        workflow_runs:
          options.run === null
            ? []
            : [
                {
                  id: 81,
                  workflow_id: 42,
                  head_sha: options.run?.headSha ?? currentSha,
                  head_branch: options.run?.branch ?? "main",
                  event: options.run?.event ?? "push",
                  status: "completed",
                  conclusion: options.run?.conclusion ?? "success",
                  html_url: "https://github.com/acme/service/actions/runs/81",
                  head_repository: {
                    full_name:
                      options.run?.repository ?? "acme/service",
                  },
                },
              ],
      });
    }
    if (url.includes("/branches/")) {
      return Response.json({
        commit: {
          sha: options.branchSha ?? currentSha,
        },
      });
    }
    throw new Error(`Unexpected GitHub URL: ${url}`);
  };
}

test("GitHub gate returns the immutable SHA for a successful current run", async () => {
  const result = await verifyLatestGitHubWorkflow({
    repository: "acme/service",
    branch: "main",
    workflow: "ci.yml",
    fetchImplementation: mockGitHub({}),
  });

  assert.equal(result.result.verdict, "CONTRACT_SATISFIED");
  assert.equal(result.verifiedSha, currentSha);
  assert.equal(result.workflowRun?.headSha, currentSha);
});

test("GitHub gate rejects a successful run for an older branch head", async () => {
  const result = await verifyLatestGitHubWorkflow({
    repository: "acme/service",
    branch: "main",
    workflow: "ci.yml",
    fetchImplementation: mockGitHub({
      run: { headSha: staleSha, conclusion: "success" },
    }),
  });

  assert.equal(result.result.verdict, "CONTRACT_VIOLATED");
  assert.equal(result.verifiedSha, null);
});

test("GitHub gate rejects the latest completed failed run", async () => {
  const result = await verifyLatestGitHubWorkflow({
    repository: "acme/service",
    branch: "main",
    workflow: "ci.yml",
    fetchImplementation: mockGitHub({
      run: { headSha: currentSha, conclusion: "failure" },
    }),
  });

  assert.equal(result.result.verdict, "CONTRACT_VIOLATED");
  assert.equal(
    result.result.requirementResults.find(
      (requirement) =>
        requirement.requirementId === "workflow-conclusion-success",
    )?.status,
    "VIOLATED",
  );
});

test("GitHub gate treats no completed push run as insufficient evidence", async () => {
  const result = await verifyLatestGitHubWorkflow({
    repository: "acme/service",
    branch: "main",
    workflow: "ci.yml",
    fetchImplementation: mockGitHub({ run: null }),
  });

  assert.equal(result.result.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.workflowRun, null);
});

test("GitHub API and response failures remain integration errors", async () => {
  await assert.rejects(
    verifyLatestGitHubWorkflow({
      repository: "acme/service",
      branch: "main",
      workflow: "ci.yml",
      fetchImplementation: mockGitHub({ status: 403 }),
    }),
    (error: unknown) =>
      error instanceof WorldCutIntegrationError &&
      error.code === "WORLDCUT_GITHUB_API_ERROR",
  );

  await assert.rejects(
    verifyLatestGitHubWorkflow({
      repository: "acme/service",
      branch: "main",
      workflow: "ci.yml",
      fetchImplementation: mockGitHub({
        run: {
          headSha: currentSha,
          conclusion: "success",
          repository: "fork/service",
        },
      }),
    }),
    (error: unknown) =>
      error instanceof WorldCutIntegrationError &&
      error.code === "WORLDCUT_GITHUB_RESPONSE_INVALID",
  );
});

test("GitHub history reports required evidence coverage", async () => {
  const coverage = await inspectGitHubWorkflowEvidence(
    {
      repository: "acme/service",
      branch: "main",
      workflow: "ci.yml",
      fetchImplementation: mockGitHub({}),
    },
    20,
  );

  assert.equal(coverage.inspectedRuns, 1);
  assert.equal(coverage.completeEvidenceRuns, 1);
  assert.equal(coverage.evidenceCoverage, 1);
  assert.deepEqual(coverage.conclusions, { success: 1 });
});
