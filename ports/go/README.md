# WorldCut Go

Independent Go implementation of WorldCut protocol **0.1** and engine ruleset
**0.1.2**. It implements `worldcut-json-v1`, the complete verifier, exact
acquisition planning, and verification-record digests without invoking Node.js
or using generated TypeScript output.

It also ships the native Git, HTTP, and Kubernetes metadata adapters, the
GitHub Actions deployment gate, and the Agentic Data Kernel adapter, so a Go
program can capture evidence and verify a decision contract without leaving
the language.

The module requires Go 1.23 or newer and depends only on the standard library
plus [`github.com/gowebpki/jcs`](https://github.com/gowebpki/jcs) for
RFC 8785 canonicalization. No GitHub, Kubernetes, or cloud SDK is used.

## Install

```sh
go get github.com/Jason-Doyle/WorldCut/ports/go
go install github.com/Jason-Doyle/WorldCut/ports/go/cmd/worldcut-go@latest
go install github.com/Jason-Doyle/WorldCut/ports/go/cmd/worldcut-github-ci-go@latest
```

The integrations and `worldcut-github-ci-go` ship in the `ports/go/v0.2.0`
module tag. From a repository checkout:

```sh
cd ports/go
go build ./cmd/...
```

## Packages

| Import path | Contents |
| --- | --- |
| `github.com/Jason-Doyle/WorldCut/ports/go` | Protocol types, validation, verifier, canonicalization |
| `.../ports/go/adapters` | Git, HTTP, and Kubernetes metadata adapters |
| `.../ports/go/integrations/githubactions` | GitHub Actions deployment gate and evidence coverage |
| `.../ports/go/integrations/agenticdatakernel` | Structural Agentic Data Kernel adapter |
| `.../ports/go/cmd/worldcut-go` | Verification CLI |
| `.../ports/go/cmd/worldcut-github-ci-go` | GitHub Actions deployment gate CLI |

## Verify transported JSON

```go
source, err := os.ReadFile("verification.json")
if err != nil {
	log.Fatal(err)
}

result, err := worldcut.VerifyJSON(source)
if err != nil {
	log.Fatal(err)
}

fmt.Println(result.Verdict)
fmt.Println(result.VerificationRecordDigest)
```

Import the module as:

```go
import worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
```

## Construct and verify in Go

`VerifyDecisionContract` accepts a constructed `VerificationInput` and applies
exactly the same strict validation and canonicalization as `ParseInput`. There
is no second, weaker validation path: the document is encoded and parsed
through the same code the transport path uses.

```go
result, err := worldcut.VerifyDecisionContract(worldcut.VerificationInput{
	Contract: worldcut.Contract{
		ID:           "deploy-current-tested-head",
		Version:      "1",
		DecisionTime: worldcut.FormatTimestamp(time.Now()),
		Requirements: []worldcut.Requirement{
			worldcut.NewDependencyRequirement(
				"ci-tested-current-head",
				"The passing CI run tested the selected branch head",
				"ci",
				"head",
				"tested_head",
			),
		},
	},
	Observations: []worldcut.Observation{headObservation, ciObservation},
})
```

Use `ParseVerificationInput` when the same input is verified more than once;
it returns the immutable `*ParsedInput` snapshot that `Verify` consumes.

Convenience defaults are limited to protocol constants: an empty
`ProtocolVersion` becomes `0.1` and a zero `ContractAssumptions` becomes
`SupportedAssumptions()`. Any other value must be supplied explicitly and is
validated normally.

Supporting API:

| Function | Purpose |
| --- | --- |
| `ParseInput`, `Verify`, `VerifyJSON` | Unchanged transport path |
| `ParseVerificationInput`, `VerifyDecisionContract` | Constructed inputs |
| `NewDependencyRequirement`, `NewCommonValidTimeRequirement`, `NewValueEqualsRequirement`, `Requirement.Advisory` | Requirement construction |
| `SnapshotJSONValue` | Validated, independent JSON snapshot of a Go value |
| `ParseTimestamp`, `FormatTimestamp` | Normalized UTC millisecond timestamps |
| `ErrorCode`, `NewError`, `WrapError` | Stable error codes |

Snapshots and results are mutation isolated. A parsed input never aliases the
caller's maps or slices, and mutating a returned result cannot change a parsed
snapshot or a later verification.

## Metadata adapters

```go
head, err := adapters.CaptureGitHead(ctx, adapters.GitHeadOptions{
	RepositoryPath: ".",
	RepositoryID:   "payments",
	Branch:         "main",
	Role:           "head",
})
```

| Adapter | Exact version witness | Behavior |
| --- | --- | --- |
| `CaptureGitHead` | Full commit SHA | Validates the branch with `git check-ref-format --branch` and resolves only `refs/heads/<branch>^{commit}`, so revision expressions such as `main~1` and missing refs are rejected |
| `CaptureHTTPObservation` | Syntactically valid strong `ETag` | Defaults to `HEAD`, never follows redirects, never reads the body, and always closes it; weak ETags, the wildcard, unquoted values, and `Last-Modified` stay descriptive |
| `CaptureKubernetesObservation` | Opaque `metadata.resourceVersion` | Structural input only; the value is never parsed, sorted, or treated as a timestamp, and no validity is inferred |

Every adapter validates its options, bounds `AcquisitionCost` by
`worldcut.MaxAcquisitionCost`, accepts an injectable `Clock` and `NewID`, and
returns an error rather than a success-shaped observation when the provider
call fails. Identifiers are random version 4 UUIDs from `crypto/rand`.

## GitHub Actions deployment gate

```go
verification, err := githubactions.VerifyLatestWorkflow(ctx, githubactions.Options{
	Repository: "acme/payments",
	Branch:     "main",
	Workflow:   "ci.yml",
	Token:      os.Getenv("GITHUB_TOKEN"),
})
if err != nil {
	log.Fatal(err)
}
if verification.VerifiedSHA == nil {
	log.Fatalf("deployment blocked: %s", verification.Result.Verdict)
}
deploy(*verification.VerifiedSHA)
```

The gate selects the latest completed `push` run, not the latest successful
run, validates the run's repository, branch, event, status, identifiers, and
full commit SHA, then reads the branch head and requires both a `success`
conclusion and an exact `tested_head` dependency match. `VerifiedSHA` is
non-nil only for `CONTRACT_SATISFIED`.

`InspectWorkflowEvidence` reports evidence coverage across 1 to 100 recent
completed push runs.

`Options` exposes `APIBaseURL`, `Client`, `Clock`, and `NewID` so the gate can
be tested deterministically. Response bodies are bounded, redirects are
refused, and the token is never included in an error message.

CLI:

```sh
worldcut-github-ci-go \
  --repository acme/payments \
  --branch main \
  --workflow ci.yml
```

It exits with code `2` unless the contract is satisfied, exits `1` with a
stable JSON error envelope on failure, and writes `verified_sha` and
`workflow_run_id` to `GITHUB_OUTPUT` on success. See
[`examples/github-actions/deployment-gate-go.yml`](../../examples/github-actions/deployment-gate-go.yml).

## Agentic Data Kernel

```go
observation, err := agenticdatakernel.ObservationFromResolution(
	resolution,
	agenticdatakernel.Options{},
)
```

The adapter is structural and takes no runtime dependency on the kernel. It
rejects `unknown` and `conflicted` resolutions, `resolved_with_conflict`
unless `AllowResolvedWithConflict` is set, missing selections, non-`active`
assertions, assertions outside the resolved system or business interval,
missing or unsupported `basis.worldcut` metadata, unsupported fields,
provenance, or protocol versions, invalid acquisition costs and dependencies,
and cross-tenant resource or dependency claims. Every rejection uses
`WORLDCUT_ADK_RESOLUTION_INVALID`.

## Errors

| Code | Meaning |
| --- | --- |
| `WORLDCUT_INVALID_INPUT` | Input or constructed document failed protocol validation |
| `WORLDCUT_GITHUB_API_ERROR` | GitHub transport, status, or redirect failure |
| `WORLDCUT_GITHUB_RESPONSE_INVALID` | GitHub options or response content was unusable |
| `WORLDCUT_ADK_RESOLUTION_INVALID` | Kernel resolution or WorldCut metadata was unusable |

`ErrorCode` unwraps wrapped causes. Native adapter failures wrap the
underlying operational error instead of inventing a code.

## CLI

The verification CLI reads one verification input and prints the complete
verification result as JSON:

```sh
worldcut-go verification.json
```

For decision gates, exit with status 2 unless the verdict is
`CONTRACT_SATISFIED`:

```sh
worldcut-go --require-satisfied verification.json
```

Invalid JSON and invalid protocol input produce a JSON error with code
`WORLDCUT_INVALID_INPUT` on stderr and exit status 1.

## Validate

Run from `ports/go`:

```sh
gofmt -l .
go test ./...
go test -race ./...
go vet ./...
```

The tests consume every shared vector under `conformance/0.1`, including raw
Unicode rejection and exact canonical bytes and digests, and cover the
adapters, integrations, and both CLIs with adversarial provider responses,
mutation isolation, context cancellation, and exit-code checks. The race
detector requires cgo and a C toolchain.
