# WorldCut

Independent .NET implementation of the **WorldCut** decision-coherence
protocol `0.1`, engine ruleset `0.1.2`, and canonicalization
`worldcut-json-v1`.

WorldCut answers one question: *do observations gathered from independent
systems actually satisfy the version and time relationships a decision
requires?* It returns `CONTRACT_SATISFIED`, `CONTRACT_VIOLATED`, or
`INSUFFICIENT_EVIDENCE`, plus a deterministic digest of the verification
record.

The package has **no third-party package dependencies** and targets
**.NET 8** and **.NET 10**.

## Install

```sh
dotnet add package WorldCut
```

The matching CLI is published separately as a .NET tool:

```sh
dotnet tool install --global WorldCut.Tool
worldcut-dotnet verification.json
```

## Verify a document

```csharp
using WorldCut;

VerificationResult result = WorldCutVerifier.VerifyJsonUtf8(File.ReadAllBytes("verification.json"));

Console.WriteLine(result.Verdict);                   // ContractSatisfied
Console.WriteLine(result.Verdict.ToWireName());      // CONTRACT_SATISFIED
Console.WriteLine(result.VerificationRecordDigest);  // 64 lowercase hex characters
```

## Parse once, verify repeatedly

```csharp
using WorldCut;

ParsedVerificationInput input = ParsedVerificationInput.Parse(json);

VerificationResult first = WorldCutVerifier.Verify(input);
VerificationResult second = WorldCutVerifier.Verify(input);
// first and second are independent, deeply immutable values.
```

`ParsedVerificationInput` has no public constructor, so it cannot be built into
an invalid state, and every value reachable from a result is immutable.

## Canonical JSON and digests

```csharp
using WorldCut.Json;

JsonValue value = JsonValue.Parse("""{"z":1,"a":2}""");

CanonicalJson.Serialize(value);       // {"a":2,"z":1}
CanonicalJson.ComputeSha256Hex(value);
```

## Errors

Every failure is a `WorldCutException` carrying a stable
`Code`/`WireCode`: `WORLDCUT_INVALID_INPUT`, `WORLDCUT_INVALID_ARGUMENT`,
`WORLDCUT_FILE_READ_FAILED`, or `WORLDCUT_RUNTIME_ERROR`. JSON syntax failures
are reported as `WORLDCUT_INVALID_INPUT`, matching the Go and Python ports.

## Boundaries

WorldCut evaluates a declared contract deterministically. It does not decide
what the contract should be, infer missing relationships, fetch evidence, or
establish that a provider is truthful. The record digest detects record
changes; it is not a digital signature.

This port contains the verifier, canonicalization, and CLI only. Cloud
adapters, the GitHub Actions integration, and the Agentic Data Kernel adapter
are not included.

## More

* Protocol, results, canonicalization, and conformance specifications:
  <https://github.com/Jason-Doyle/WorldCut/tree/main/spec/0.1>
* Port documentation:
  <https://github.com/Jason-Doyle/WorldCut/tree/main/ports/dotnet>
* Third-party notices: `THIRD-PARTY-NOTICES.md` in this package.

Licensed under the Apache License 2.0.
