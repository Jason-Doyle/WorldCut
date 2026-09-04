# Contributing

WorldCut is an experimental project. Bug reports, failing examples, and
well-scoped protocol proposals are welcome.

## Development setup

Requirements:

- Node.js 22.19 or newer
- npm 10 or newer
- Git, for the Git adapter tests

```sh
npm ci
npm run check
npm test
```

Run the full simulation when changing verification semantics, baselines, or
metadata handling:

```sh
npm run benchmark
```

Before proposing a release-affecting change:

```sh
npm run release:check
```

Changes to protocol semantics, canonicalization, conformance data, or any
language port must also pass the four-toolchain differential gate:

```sh
npm run differential
```

Its Go, Python, and .NET prerequisites and reproducible seed controls are
documented in [`docs/DIFFERENTIAL.md`](docs/DIFFERENTIAL.md).

## Pull requests

Keep changes focused and include tests for observable behavior. Protocol
changes should explain:

- the decision invariant being added or changed;
- how missing evidence is handled;
- which baseline should detect the same failure;
- whether the change affects existing verification-record digests.

Open an issue before introducing a new requirement type or changing the
declared fault model. Avoid adding model-generated heuristics to the
authorization path: `CONTRACT_SATISFIED` must remain deterministic.

By contributing, you agree that your contribution is licensed under the
Apache License 2.0.
