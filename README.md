# WorldCut

[![CI](https://github.com/Jason-Doyle/WorldCut/actions/workflows/ci.yml/badge.svg)](https://github.com/Jason-Doyle/WorldCut/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

WorldCut is an experimental TypeScript library for verifying that observations
from independent systems satisfy the version and time relationships required
by a decision.

## The problem

An agent can combine individually correct responses into an unsupported
conclusion:

```text
GitHub: current branch head = B
CI:     run passed; tested branch head = A

Required relationship: tested head == current head
```

Both responses are true, but they do not justify deploying `B`.

Freshness does not solve the broader problem. Two records can be fetched
milliseconds apart and still describe conditions that were never valid at the
same time.

## What WorldCut verifies

A verification request contains:

- named observation roles;
- canonical resource identities;
- optional version, validity, and dependency witnesses;
- a decision contract describing the relationships that must hold.

Each requirement returns one of:

| Result | Meaning |
| --- | --- |
| `SATISFIED` | Available evidence establishes the requirement |
| `VIOLATED` | Available evidence establishes that the requirement is false |
| `UNKNOWN` | Required evidence is missing |

Required results aggregate conservatively:

```text
any violation       -> CONTRACT_VIOLATED
otherwise unknown   -> INSUFFICIENT_EVIDENCE
all satisfied       -> CONTRACT_SATISFIED
```

The current implementation supports exact version dependencies and scoped
common-valid-time checks over half-open intervals.

```ts
import { verifyDecisionContract } from "./dist/index.js";

const result = verifyDecisionContract({
  contract,
  observations,
});

if (result.verdict !== "CONTRACT_SATISFIED") {
  console.error(result.requirementResults);
}
```

See [`src/examples/deployment.ts`](src/examples/deployment.ts) for runnable
examples and [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the data model and
runtime semantics.

## Evaluation

The repository includes a deterministic event-history simulator and five
comparison strategies: latest-value selection, a TTL sweep, permissive and
strict dependency checking, and equivalent hand-written contract checks.

Across 16,000 generated decisions:

- WorldCut produced no false authorizations with complete, truthful metadata;
- it authorized every safe complete-metadata case;
- strict dependency-only validation still authorized 676 and 976 unsafe cases
  in the two complete-metadata profiles because it did not evaluate the scoped
  temporal requirement;
- WorldCut and equivalent hand-written predicates produced identical verdicts;
- weak metadata caused 3,505 abstentions in 4,000 trials.

These results support a narrow claim: freshness and exact dependency checks do
not express every cross-service compatibility requirement. They do not prove
that WorldCut is better than equivalent application code, that production APIs
expose enough metadata, or that the acquisition planner reduces operational
cost.

Run the evaluation locally:

```sh
npm run benchmark
```

The command writes detailed results under `benchmark/`, which is intentionally
excluded from version control.

## Metadata adapters

The MVP can capture native resource versions from:

- local Git branches using commit SHAs;
- HTTP resources using strong `ETag` validators;
- Kubernetes objects using `metadata.resourceVersion`.

These identifiers establish per-resource versions. They do not create
cross-provider dependency or validity information automatically.
Weak ETags and `Last-Modified` headers are captured as descriptive metadata but
cannot satisfy an exact-version requirement.

```sh
npm run feasibility
```

Set `WORLDCUT_SAMPLE_GIT_REPO` to probe a different local Git repository.

## Development

WorldCut requires Node.js 22.19 or newer.

```sh
npm ci
npm run check
npm run example
npm run benchmark
```

The project uses the Node.js test runner and has no runtime dependencies.

## Scope

WorldCut is not:

- a distributed transaction manager;
- a source-of-truth database;
- a cryptographic attestation system;
- a same-process JavaScript security boundary;
- proof that provider metadata is complete or truthful.

The API is experimental and may change as real integrations test whether the
contract remains useful outside the simulator.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Security reports should follow
[`SECURITY.md`](SECURITY.md).

## License

Apache License 2.0.
