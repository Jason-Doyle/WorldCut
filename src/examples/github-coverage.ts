import { inspectGitHubWorkflowEvidence } from "../integrations/github-actions.js";

const coverage = await inspectGitHubWorkflowEvidence(
  {
    repository: "Jason-Doyle/WorldCut",
    branch: "main",
    workflow: "ci.yml",
    ...(process.env.GITHUB_TOKEN
      ? { token: process.env.GITHUB_TOKEN }
      : {}),
  },
  20,
);

console.log(JSON.stringify(coverage, null, 2));
