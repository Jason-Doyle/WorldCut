# Integrations

Integrations are available in TypeScript and Go. Both implement the same
behavior; the tables below give the TypeScript name first and the Go name
second.

| Integration | TypeScript | Go |
| --- | --- | --- |
| GitHub Actions gate | `verifyLatestGitHubWorkflow` | `githubactions.VerifyLatestWorkflow` |
| GitHub evidence coverage | `inspectGitHubWorkflowEvidence` | `githubactions.InspectWorkflowEvidence` |
| GitHub gate CLI | `worldcut-github-ci` | `worldcut-github-ci-go` |
| Git | `captureGitHead` | `adapters.CaptureGitHead` |
| HTTP | `captureHttpObservation` | `adapters.CaptureHTTPObservation` |
| Kubernetes | `captureKubernetesObservation` | `adapters.CaptureKubernetesObservation` |
| Agentic Data Kernel | `observationFromAgenticDataResolution` | `agenticdatakernel.ObservationFromResolution` |

The Python and .NET ports implement the verifier only. There is no
TypeScript-only integration in the list above.

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

In Go:

```go
verification, err := githubactions.VerifyLatestWorkflow(ctx, githubactions.Options{
	Repository: "acme/payments",
	Branch:     "main",
	Workflow:   "ci.yml",
	Token:      os.Getenv("GITHUB_TOKEN"),
})
if err != nil {
	return err
}
if verification.VerifiedSHA == nil {
	return fmt.Errorf("deployment blocked: %s", verification.Result.Verdict)
}
return deployCommit(ctx, *verification.VerifiedSHA)
```

The Go gate uses `net/http` only. `Options` accepts an injectable HTTP client,
API base URL, clock, and observation identifier source, so the gate is tested
without network access. Response bodies are bounded, redirects are refused,
and a token is never included in an error message.

The command-line gate is:

```sh
worldcut-github-ci \
  --repository acme/payments \
  --branch main \
  --workflow ci.yml
```

The Go gate takes the same flags:

```sh
worldcut-github-ci-go \
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
and
[`examples/github-actions/deployment-gate-go.yml`](../examples/github-actions/deployment-gate-go.yml)
for `workflow_run` examples.

## Native metadata adapters

Both implementations return an error rather than a success-shaped observation
when a provider call fails, and neither invents dependency or validity
metadata.

### Git

`captureGitHead` and `adapters.CaptureGitHead` validate and resolve an exact
local branch ref and return its full commit SHA. Revision expressions such as
`main~1` are rejected.

### HTTP

`captureHttpObservation` and `adapters.CaptureHTTPObservation` promote only a
syntactically valid strong ETag into an exact version witness. Weak ETags, the
wildcard, unquoted values, and `Last-Modified` remain descriptive metadata.
Redirects are never followed and the response body is never read.

### Kubernetes

`captureKubernetesObservation` and `adapters.CaptureKubernetesObservation`
record `metadata.resourceVersion` as an opaque version token. Clients must not
sort, parse, or treat it as a timestamp.

## Agentic Data Kernel

The structural adapter validates kernel resolution and assertion lifecycle
semantics before producing a WorldCut observation. See
[Agentic Data Kernel integration](AGENTIC_DATA_KERNEL.md).

## Building a contract from captured observations

The captured observations are ordinary protocol observations. In TypeScript
pass them to `verifyDecisionContract`; in Go pass them to
`worldcut.VerifyDecisionContract`, which applies exactly the same validation
and canonicalization as the JSON transport path.
