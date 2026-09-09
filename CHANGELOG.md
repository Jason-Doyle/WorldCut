# Changelog

## Unreleased

## 1.0.1 - 2026-09-09

- Replaced the long-lived npm publishing token with npm Trusted Publishing
  through GitHub Actions OIDC.
- Updated the repository and release workflows to npm `11.19.1`, which
  supports OIDC while retaining the existing Node.js `22.19.0` compatibility
  floor and release-command output contracts.

## 1.0.0 - 2026-09-07

- Promoted the npm, Go, Python, and .NET package/API lines to stable `1.0.0`.
  This is an API-stability release; protocol `0.1`, engine `0.1.2`, canonical
  results, and verification digests are unchanged.
- Added tested agent effect-gating examples:
  - a Microsoft Agent Framework .NET workflow whose effect executor is
    reachable only through a satisfied WorldCut decision;
  - an Azure SRE Agent custom Python tool and skill procedure using the
    published PyPI package;
  - framework-neutral guidance for LangGraph, OpenAI Agents SDK, MCP clients,
    and scheduled runbooks.
- Added Go integrations to the `ports/go` module, closing the gap where the Go
  port shipped a verifier but no adapters or integrations:
  - `adapters.CaptureGitHead`, `adapters.CaptureHTTPObservation`, and
    `adapters.CaptureKubernetesObservation`, behavior-compatible with the
    TypeScript adapters, including exact branch-ref resolution, strong-ETag
    promotion only, refused redirects, unread-and-closed response bodies, and
    opaque Kubernetes `resourceVersion` handling;
  - `githubactions.VerifyLatestWorkflow` and
    `githubactions.InspectWorkflowEvidence`, the latest-completed-push
    deployment gate and evidence coverage report, built on `net/http` with an
    injectable client, API base URL, clock, and identifier source;
  - `agenticdatakernel.ObservationFromResolution`, the structural Agentic Data
    Kernel adapter, with no runtime kernel dependency;
  - the `worldcut-github-ci-go` command, equivalent to `worldcut-github-ci`,
    including stable JSON errors, exit status 2 unless the contract is
    satisfied, and `verified_sha`/`workflow_run_id` in `GITHUB_OUTPUT`.
- Added a Go construction API so captured observations can be verified without
  hand-assembling protocol JSON: `VerificationInput`, `ContractAssumptions`,
  `SupportedAssumptions`, `ParseVerificationInput`, `VerifyDecisionContract`,
  requirement constructors, `SnapshotJSONValue`, `ParseTimestamp`, and
  `FormatTimestamp`. Constructed inputs are encoded and then validated by the
  existing `ParseInput` path, so there is no second or weaker validation route,
  and parsed snapshots and results remain mutation isolated. `ParseInput`,
  `Verify`, and `VerifyJSON` are unchanged, and protocol 0.1 and engine 0.1.2
  outputs are unchanged.
- Added the stable Go integration error codes `WORLDCUT_GITHUB_API_ERROR`,
  `WORLDCUT_GITHUB_RESPONSE_INVALID`, and `WORLDCUT_ADK_RESOLUTION_INVALID`,
  plus `NewError`, `WrapError`, and cause unwrapping in `ErrorCode`.
- Added a Go GitHub Actions deployment-gate example workflow and documented the
  Go integrations in the port README, root README, `docs/INTEGRATIONS.md`,
  `docs/AGENTIC_DATA_KERNEL.md`, and `docs/VALIDATION.md`. The Go module keeps
  its single `jcs` dependency and adds no GitHub, Kubernetes, or cloud SDK.
- Added OIDC trusted-publishing workflows for Python on PyPI and
  `WorldCut`/`WorldCut.Tool` on NuGet.org, including protected tag
  validation, exact-artifact checks, and language-specific GitHub releases.
- Published stable `WorldCut` and `WorldCut.Tool` `1.0.0` on NuGet.org with
  repository signatures and verified package contents.
- Published stable Python `worldcut` `1.0.0` on PyPI with verified PEP 740
  attestations for the wheel and source distribution.

## 0.2.0 - 2026-09-04

- Added a required cross-language differential CI gate that runs the TypeScript,
  Go, Python, and .NET command-line tools over one shared corpus of golden,
  edge, invalid, malformed, and seeded random inputs and compares their complete
  verification results, error codes, and verification-record digests
  (`npm run differential`, documented in `docs/DIFFERENTIAL.md`).
- Added independent conformant Go, Python, and .NET implementations with
  language-native CLIs, immutable parsed inputs, exact golden-vector coverage,
  and isolated package-consumption tests. The .NET implementation targets
  `net8.0` and `net10.0`.
- Fixed the TypeScript CLI accepting transport bytes that are not valid UTF-8.
  Node's lossy decoding replaced malformed bytes with U+FFFD and then verified
  the corrupted evidence; the Go, Python, and .NET ports already rejected it.
  The CLI now reports `WORLDCUT_INVALID_JSON`, and a byte-order mark stays
  rejected.
- Hardened the Go port so a JSON number that underflows the IEEE-754 double
  range, such as `1e-400`, is accepted as a finite zero like the other ports,
  while syntax errors and overflow to infinity are still rejected.
- Added language-neutral protocol, canonicalization, and conformance
  specifications with committed golden vectors.
- Defined package-independent engine versioning for cross-language
  implementations.
- Rejected invalid Unicode scalar sequences and restricted array value paths to
  canonical non-negative indices.
- Defined acquisition costs as bounded integer units with deterministic
  metadata-cost rounding.

## 0.1.0 - 2026-09-02

- Added deterministic decision-contract verification with exact dependency,
  value equality, and scoped common-valid-time requirements.
- Added explicit satisfied, violated, and insufficient-evidence verdicts.
- Added bounded acquisition planning and deterministic verification-record
  digests.
- Added Git, HTTP, Kubernetes, GitHub Actions, and Agentic Data Kernel
  integration surfaces.
- Added immutable JSON Schema 0.1 documents, structured errors, CLI tools,
  checked examples, benchmark coverage, and package release automation.
