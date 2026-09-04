# Cross-language differential verification

The four WorldCut implementations share one protocol but no code. Passing the
committed vectors in `conformance/0.1` proves that each one agrees with the
specification on a small fixed corpus. It does not prove that they still agree
on inputs nobody wrote a vector for.

The differential suite closes that gap. It runs the TypeScript, Go, Python, and
.NET command-line tools over one identical corpus of transport bytes and
compares their complete parsed verification results.

```sh
npm run differential
```

The suite is a required CI check. The `differential` job in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs it on every pull
request and `Required checks` fails unless it succeeds.

## What is compared

For every case the harness spawns each CLI with the same input file, then
classifies the outcome as a verification result, a stable error envelope, or an
unusable output. An unusable output always fails the case.

| Case category | Comparison |
| --- | --- |
| Verification input that TypeScript accepts | Every port must print a result that is structurally identical to the TypeScript result, including summaries, `details`, acquisition action identifiers, costs and order, the acquisition plan, coverage counters, protocol and engine versions, and `verificationRecordDigest`. |
| Committed verification vector | The TypeScript result must additionally equal the committed `expected` result. |
| Verification input that TypeScript rejects | Every port must fail with the same stable `WORLDCUT_*` code. |
| Committed invalid vector | Every port must fail with the code recorded in `invalid-vectors.json`. |
| Malformed raw transport bytes | Every port must fail with an outcome that `spec/0.1/CONFORMANCE.md` permits: `PARSE_ERROR` or `WORLDCUT_INVALID_INPUT`. A port that accepts the bytes fails the case. |

`verificationRecordDigest` is checked twice: it must match
`^[0-9a-f]{64}$` in every port, and every port's digest must equal the
TypeScript digest. Case pairs that are canonically identical but textually
different — reordered members, reordered observations and requirements, `\u`
escapes versus literal UTF-8 — must also produce the same digest as each other.

## What is deliberately ignored

Results are compared after `JSON.parse`, so the following never fail a case:

- indentation, spacing, and line endings;
- object member order;
- `\uXXXX` escaping versus literal UTF-8;
- number spelling, for example `1e+21` versus `1E+21` versus `1000000...`;
- `-0` versus `0`, because `worldcut-json-v1` serializes negative zero as `0`
  and the two spellings can never produce different digests.

Everything else is treated as a semantic difference, including a missing member,
a different array order, a different summary string, and a different cost.

## Case categories

| Category | Source | Count |
| --- | --- | ---: |
| `golden` | every case in `conformance/0.1/verification-vectors.json` | 15 |
| `invalid` | every case in `conformance/0.1/invalid-vectors.json` | 12 |
| `raw` | every case in `conformance/0.1/raw-vectors.json` | 1 |
| `example` | every published fixture in `examples/` | 4 |
| `edge` | handcrafted deterministic cases | 31 |
| `transport` | handcrafted malformed byte sequences | 20 |
| `random` | seeded generated inputs | `--count`, default 500 |

The `edge` category covers finite IEEE-754 underflow (`1e-400`), negative zero,
alternative number spellings, boundary doubles, integer precision loss, UTF-16
member ordering across ASCII, Latin-1, full-width, and astral names, whitespace
and array-index value paths, structural `value_equals` comparison, deep nesting,
every dependency and temporal outcome, acquisition action de-duplication,
required and advisory aggregation, cost boundaries, and input array reordering.

The `transport` category covers empty and whitespace-only files, truncated
documents, trailing values, trailing commas, byte-order marks, invalid UTF-8,
raw control characters, NUL bytes, unpaired surrogate escapes, `NaN` and
`Infinity` literals, numbers that overflow to infinity, leading zeros,
hexadecimal, single quotes, and non-object top-level values.

Cases whose meaning depends on lexical form are authored as text or bytes, never
as JavaScript values. `JSON.stringify` would turn `1e-400` into `0` and `-0`
into `0` before any CLI could observe them.

### Randomized inputs

Randomized cases are generated from `${seed}:${index}` with a seeded sfc32
generator, so a seed and count always reproduce the same bytes on every
platform. They exercise nested arrays and objects, Unicode strings and member
names, UTF-16 ordering, safe finite doubles and integers, negative zero,
`value_equals` hits and misses, satisfied, violated, and unknown dependency
cases, temporal overlap and gap cases, reordered observation and requirement
arrays, acquisition planning and de-duplication, and required and advisory
aggregation. Nesting stays far below the 48-level transport cap documented by
the .NET port.

About a third of the generated corpus is built in a coherent mode where every
requirement is satisfiable, so the suite keeps reaching `CONTRACT_SATISFIED` and
`NOT_NEEDED` acquisition plans rather than only failure paths. The run fails if
fewer than 75% of randomized cases produce a verification result, or if the
randomized corpus stops reaching all three verdicts.

## Options

| Flag | Environment variable | Default |
| --- | --- | --- |
| `--seed <text>` | `WORLDCUT_DIFFERENTIAL_SEED` | `worldcut-0.1` |
| `--count <n>` | `WORLDCUT_DIFFERENTIAL_COUNT` | `500` |
| `--jobs <n>` | `WORLDCUT_DIFFERENTIAL_JOBS` | `max(2, min(6, available parallelism))` |
| `--only <substring>` | — | all cases |
| `--category <name>` | — | all categories |
| `--max-failures <n>` | — | `10` reported in full |
| `--timeout-ms <n>` | `WORLDCUT_DIFFERENTIAL_TIMEOUT_MS` | `60000` per CLI invocation |
| `--list` | — | print the corpus and exit |
| `--self-check-only` | — | run the harness self-checks and exit |

```sh
npm run differential -- --seed release-audit --count 2000
npm run differential -- --only edge/number-underflow-positive --count 0
npm run differential -- --category transport --count 0 --list
```

The harness runs deterministic self-checks before it starts any port. Those
checks cover the seeded generator, the raw-lexeme writer, the structural
comparison, the outcome mapping, and corpus invariants, so a broken harness
fails loudly instead of comparing a weaker corpus. `npm test` runs them too, so
a harness regression is caught by the Node job even though that job has no Go,
Python, or .NET toolchain.

## Prerequisites

| Port | Requirement |
| --- | --- |
| TypeScript | Node.js 22.19 or newer. `npm run differential` builds `dist/` first. |
| Go | A Go toolchain that satisfies `ports/go/go.mod`. The harness builds `cmd/worldcut-go` once. |
| Python | Python 3.11 or newer with the `ports/python` package installed, for example `python -m pip install ./ports/python`. |
| .NET | The .NET SDKs named in `ports/dotnet/global.json`. The harness builds `WorldCut.Tool` once. |

Executables are resolved from `PATH` unless overridden:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORLDCUT_NODE` | the running `node` | TypeScript CLI host |
| `WORLDCUT_GO` | `go` | Go toolchain |
| `WORLDCUT_PYTHON` | `python` | Python interpreter that can import `worldcut` |
| `WORLDCUT_DOTNET` | `dotnet` | .NET host |
| `WORLDCUT_DOTNET_FRAMEWORK` | `net8.0` | .NET target framework to build and run |

Example on a machine with private toolchains:

```sh
WORLDCUT_GO=/opt/go/bin/go \
WORLDCUT_PYTHON=ports/python/.venv/bin/python \
WORLDCUT_DOTNET=/opt/dotnet/dotnet \
npm run differential
```

Inputs are written to a temporary directory outside the repository and that
directory is always removed, including after a failure.

Each CLI invocation is terminated if it exceeds the configured timeout. A
timeout, runtime error, argument error, or file error never counts as an
allowed parser rejection for malformed transport bytes.

## Reading a failure

A failing case prints its identifier and category, the seed and count that
produced it, a ready-to-paste reproduction command, the exact input bytes with
their length and SHA-256, and the specific differences per port as JSON
pointers. Inputs larger than 8 KiB, or inputs that are not valid UTF-8, are
printed as base64 so the exact bytes survive. Nothing else from the workspace is
printed.

## Why TypeScript is the oracle

The TypeScript package is the reference implementation. `spec/0.1` and the
committed vectors are generated from it by `npm run conformance:update`, and
`spec/0.1/CANONICALIZATION.md` defines canonicalization in terms of the
ECMAScript rules it follows. When the ports disagree, TypeScript defines the
answer unless TypeScript itself is shown to violate the specification, in which
case the specification, the vectors, and every implementation are corrected
together.

Using one oracle is a pragmatic choice, not a claim that TypeScript is correct.
The suite also re-checks TypeScript against the committed golden results on
every run, so a regression in the oracle fails the gate instead of being copied
into the other ports.

## What this does and does not establish

Agreement across a large shared corpus is evidence of protocol equivalence for
the inputs that were compared. It is not a proof.

The suite does not:

- exhaustively cover the input space, or replace the committed vectors;
- prove the four implementations are equivalent for untested inputs;
- constitute a formal verification, a model check, or a refinement proof;
- compare library APIs, only the command-line tools;
- exercise every supported language runtime version — CI runs the differential
  job on one Node.js, Go, Python, and .NET version each, while the independent
  per-language jobs cover the full support matrix.

Its value is regression pressure: an accidental divergence introduced by a
change to any one port is very likely to fail this gate before it is released.
