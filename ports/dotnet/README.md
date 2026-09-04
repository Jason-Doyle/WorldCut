# WorldCut .NET

Independent .NET implementation of WorldCut protocol **0.1**, engine ruleset
**0.1.2**, and canonicalization **worldcut-json-v1**.

It implements the complete verifier, exact acquisition planning, RFC 8785
canonicalization, and verification-record digests without invoking Node.js,
Python, or Go, and without consuming generated TypeScript output.

| Package | Purpose |
| --- | --- |
| [`WorldCut`](https://www.nuget.org/packages/WorldCut) | Class library. No third-party package dependencies. |
| [`WorldCut.Tool`](https://www.nuget.org/packages/WorldCut.Tool) | The `worldcut-dotnet` .NET global tool. |

## Framework support

Both packages multi-target **`net8.0`** and **`net10.0`**, and both target
frameworks are built, unit tested, conformance tested, packed, and exercised
from an installed package in CI. No other framework is claimed.

Building this port requires the **.NET 10 SDK** (see [`global.json`](global.json));
the .NET 8 runtime is additionally required to run the `net8.0` test pass.

## Install

```sh
dotnet add package WorldCut
dotnet tool install --global WorldCut.Tool
```

## Library

Verify a document in one call:

```csharp
using WorldCut;

VerificationResult result = WorldCutVerifier.VerifyJsonUtf8(
    File.ReadAllBytes("verification.json"));

Console.WriteLine(result.Verdict);                  // ContractSatisfied
Console.WriteLine(result.Verdict.ToWireName());     // CONTRACT_SATISFIED
Console.WriteLine(result.Coverage.Required);        // 3
Console.WriteLine(result.VerificationRecordDigest); // 64 lowercase hex characters
```

Parse once and verify repeatedly:

```csharp
using WorldCut;

ParsedVerificationInput input = ParsedVerificationInput.Parse(json);

foreach (RequirementResult requirement in WorldCutVerifier.Verify(input).RequirementResults)
{
    Console.WriteLine($"{requirement.RequirementId}: {requirement.Status.ToWireName()}");
    Console.WriteLine(requirement.Summary);
}
```

`ParsedVerificationInput` has no public constructor, so it cannot be built into
an invalid state, and every value reachable from a parsed input or a result is
immutable. Verifying the same parsed input twice always produces two
independent, identical results.

Canonicalize and digest arbitrary JSON data:

```csharp
using WorldCut.Json;

JsonValue value = JsonValue.Parse("""{"z":1,"a":2}""");

CanonicalJson.Serialize(value);        // {"a":2,"z":1}
CanonicalJson.ComputeSha256Hex(value); // 64 lowercase hex characters
JsonText.Indent(value);                // presentation JSON, member order preserved
```

Handle failures:

```csharp
using WorldCut;

try
{
    WorldCutVerifier.VerifyJson(json);
}
catch (WorldCutException error)
{
    Console.Error.WriteLine($"{error.WireCode}: {error.Message}");
}
```

`WorldCutException` is the only exception type the API raises for protocol
failures. `WireCode` is one of `WORLDCUT_INVALID_INPUT`,
`WORLDCUT_INVALID_ARGUMENT`, `WORLDCUT_FILE_READ_FAILED`, or
`WORLDCUT_RUNTIME_ERROR`. JSON syntax failures are reported as
`WORLDCUT_INVALID_INPUT`, matching the Go and Python ports.

## CLI

```text
Usage: worldcut-dotnet [--require-satisfied] <verification.json>

Options:
  --require-satisfied  Exit with code 2 unless the contract is satisfied
  --help               Show this help
```

```sh
worldcut-dotnet ../../examples/coherent-deployment.json
worldcut-dotnet --require-satisfied ../../examples/git-ci-mismatch.json
```

The CLI reads exactly one verification input file and prints the complete
verification result as JSON on standard output, as UTF-8, with non-ASCII
characters written literally.

| Exit code | Meaning |
| ---: | --- |
| `0` | The input was verified; or `--help` was requested; or `--require-satisfied` received a satisfied contract |
| `1` | Argument, file, input, or runtime failure |
| `2` | `--require-satisfied` received a non-satisfied verdict |

Failures are written to standard error as a stable JSON envelope:

```json
{"error":{"code":"WORLDCUT_INVALID_INPUT","message":"..."}}
```

## Canonicalization

`worldcut-json-v1` is RFC 8785 applied to the accepted WorldCut JSON data
domain. The RFC 8785 serializer is **vendored source** from Jcs.NET 0.1.1
(MIT), not a package dependency; see
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for the attribution, the
exact modifications, and why the source is vendored.

WorldCut owns the behaviour layered on top:

* **Unpaired surrogates are rejected before anything else happens.**
  `System.Text.Json` substitutes `U+FFFD` for unpaired UTF-16 surrogates when
  writing, which would silently repair malformed data into a different digest.
  Every unpaired surrogate code unit — raw or `\uXXXX` escaped — is rejected
  during parsing and during `JsonValue` construction. Raw input must also be
  well-formed UTF-8.
* **Duplicate JSON members follow last-value-wins**, matching `JSON.parse` in
  the reference implementation and `json.loads` in the Python port, rather than
  RFC 8785's duplicate-name rejection.
* **Nesting limits are an explicit, stable port policy.** Parsing accepts at
  most `WorldCutProtocol.MaxJsonDepth` (48) levels and canonicalization accepts
  at most `WorldCutProtocol.MaxCanonicalizationDepth` (64). The parse limit is
  lower on purpose: a verification record wraps input values in up to eight
  further levels, so any input this port accepts can always be canonicalized.
  Deeper input is a structured `WORLDCUT_INVALID_INPUT` failure, never a stack
  overflow.
* **Timestamps do not use `DateTime`.** The protocol accepts the full
  ECMAScript date domain, including year `0000`, which `DateTime.MinValue`
  cannot represent. `NormalizedTimestamp` parses the literal
  `YYYY-MM-DDTHH:MM:SS.mmmZ` grammar and orders instants with a proleptic
  Gregorian millisecond ordinal.

## Boundaries

This port contains the verifier, canonicalization, and CLI only. It
deliberately does **not** include the cloud metadata adapters, the GitHub
Actions integration, or the Agentic Data Kernel adapter that ship with the
TypeScript reference package.

WorldCut evaluates a declared contract deterministically. It does not decide
what the contract should be, infer missing relationships, fetch evidence, or
establish that a provider is truthful. The verification-record digest detects
record changes; it is not a digital signature.

## Validate

Run from `ports/dotnet` with the .NET 10 SDK and the .NET 8 runtime available:

```sh
dotnet restore --locked-mode
dotnet format --verify-no-changes --no-restore
dotnet build --configuration Release --no-restore
dotnet test --configuration Release --no-build
dotnet pack --configuration Release --no-build
pwsh scripts/package-smoke.ps1
```

`dotnet test` runs every test against both `net8.0` and `net10.0`. The suite
covers:

* the complete shared corpus under [`conformance/0.1`](../../conformance/0.1) —
  full golden verification results, stable error codes, exact canonical bytes
  and digests, raw-byte rejection, and the file manifest;
* input order independence, immutability of parsed inputs and results, planner
  boundaries, Unicode and year-zero handling, CLI exit codes and error
  envelopes;
* deterministic seeded randomized invariant checks for canonicalization,
  number round-tripping, ordering, and structured-error containment.

The corpus is mirrored into `tests/WorldCut.Tests/data` by
`scripts/generate-conformance.mjs`, so the tests never read a file from the
parent repository.

`scripts/package-smoke.ps1` packs both packages into a local feed, asserts the
package contents against a strict allowlist, consumes the library package from
an isolated project on both target frameworks, installs the dotnet tool from
the feed, and checks every documented CLI exit code.
