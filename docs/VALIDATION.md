# Validation evidence

This document separates demonstrated behavior from assumptions that remain
unproven.

## Real GitHub Actions evidence

On 2 September 2026, the public WorldCut repository was queried through the
GitHub Actions integration:

```sh
npm run integration:github
npm run integration:github:coverage
```

Observed results:

| Measurement | Result |
| --- | ---: |
| Completed `push` runs inspected | 5 |
| Runs containing a full `head_sha` | 5 |
| Runs containing a conclusion | 5 |
| Runs with complete dependency and conclusion evidence | 5 |
| Evidence coverage | 100% |

The latest completed run concluded successfully and its `head_sha` matched the
branch head fetched afterward, so the gate returned `CONTRACT_SATISFIED` and an
immutable `verifiedSha`.

This establishes that GitHub exposes the fields required by this integration
for the inspected workflow history. It does not establish the same coverage
for other providers or prove that an arbitrary workflow is trustworthy.

### Go implementation parity

On 4 September 2026 the same public repository, branch, and workflow were
queried with both implementations. The TypeScript gate
(`node dist/github-ci-cli.js`) and the Go gate (`worldcut-github-ci-go`)
returned the same `branchSha`, the same `verifiedSha`, the same workflow run
identity, the same `CONTRACT_SATISFIED` verdict, and the same two satisfied
requirement summaries. The verification-record digests differ, as they must,
because each run carries its own observation timestamps and observation
identifiers.

`inspectGitHubWorkflowEvidence` and `githubactions.InspectWorkflowEvidence`
returned identical coverage over the same 20 completed push runs:

| Measurement | Result |
| --- | ---: |
| Completed `push` runs inspected | 20 |
| Runs with complete dependency and conclusion evidence | 20 |
| Evidence coverage | 100% |
| Conclusions | 19 `success`, 1 `cancelled` |

This is a single live observation of one public repository. It is not a
continuous parity guarantee; the enforced cross-language guarantee remains the
verifier differential suite.

## Package artifact

`npm run test:package`:

1. builds and packs WorldCut;
2. verifies an explicit package file allowlist;
3. rejects source, tests, private notes, and build-only scripts;
4. installs the tarball into an empty consumer project;
5. checks ESM and TypeScript exports;
6. resolves the versioned JSON Schema subpaths;
7. runs both packaged command-line tools.

The release workflow repeats the smoke test against the exact tarball that is
published and attached to the GitHub release.

## Synthetic decision benchmark

The deterministic benchmark evaluates 16,000 generated decisions across
complete and incomplete metadata profiles.

With complete truthful metadata:

- WorldCut produced no false authorizations;
- every safe case was authorized;
- dependency-only checks authorized unsafe cases when the contract also
  required temporal coexistence.

With weak metadata, WorldCut abstained rather than authorizing but useful
coverage fell sharply. Production users must therefore monitor authorization
coverage as well as safety.

## Not established

The current evidence does not establish:

- honest or authenticated metadata from every provider;
- safe cross-provider clock comparison without the documented clock model;
- operational savings from acquisition plans;
- transactional atomicity between verification and downstream effects;
- applicability of GitHub evidence coverage to other CI systems.
