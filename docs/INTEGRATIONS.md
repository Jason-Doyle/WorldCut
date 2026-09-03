# Integrations

## GitHub Actions deployment gate

`verifyLatestGitHubWorkflow` checks the latest completed `push` run for an
exact workflow ID or workflow filename and branch.

It:

1. requests the latest completed push run for the workflow and branch;
2. validates the run's repository, branch, event, status, and identity;
3. requests the current branch head;
4. verifies that the latest run concluded with `success`;
5. verifies that the run's `head_sha` equals the observed branch SHA;
6. returns that immutable SHA as `verifiedSha`.

```ts
import { verifyLatestGitHubWorkflow } from "worldcut";

const verification = await verifyLatestGitHubWorkflow({
  repository: "acme/payments",
  branch: "main",
  workflow: "ci.yml",
  token: process.env.GITHUB_TOKEN,
});

if (!verification.verifiedSha) {
  throw new Error(`Deployment blocked: ${verification.result.verdict}`);
}

await deployCommit(verification.verifiedSha);
```

Use a numeric workflow ID or a filename such as `ci.yml`. Display names are
not accepted because they are not unambiguous identifiers.

The command-line gate is:

```sh
worldcut-github-ci \
  --repository acme/payments \
  --branch main \
  --workflow ci.yml
```

It exits with code `2` unless the contract is satisfied. In GitHub Actions it
writes `verified_sha` and `workflow_run_id` to `GITHUB_OUTPUT`.

The gate deliberately selects the latest completed run rather than the latest
successful run. A newer failed run is therefore a known violation rather than
being hidden by an older success.

### Deployment rule

Deploy `verifiedSha` or an immutable artifact built from that SHA. Never verify
`main` and later deploy whatever `main` points to.

See
[`examples/github-actions/deployment-gate.yml`](../examples/github-actions/deployment-gate.yml)
for a `workflow_run` example.

## Native metadata adapters

### Git

`captureGitHead` validates and resolves an exact local branch ref and returns
its full commit SHA. Revision expressions such as `main~1` are rejected.

### HTTP

`captureHttpObservation` promotes only a syntactically valid strong ETag into
an exact version witness. Weak ETags and `Last-Modified` remain descriptive
metadata.

### Kubernetes

`captureKubernetesObservation` records `metadata.resourceVersion` as an opaque
version token. Clients must not sort, parse, or treat it as a timestamp.

## Agentic Data Kernel

The structural adapter validates kernel resolution and assertion lifecycle
semantics before producing a WorldCut observation. See
[Agentic Data Kernel integration](AGENTIC_DATA_KERNEL.md).
