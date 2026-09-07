# Stability and versioning

WorldCut `1.x` is the stable package and public API line for the TypeScript,
Go, Python, and .NET implementations.

Package versions, protocol versions, and engine versions are independent:

| Identifier | Current value | Meaning |
| --- | --- | --- |
| Package/API line | `1.x` | Consumer-facing API compatibility under Semantic Versioning |
| Protocol | `0.1` | Verification input and requirement wire format |
| Engine | `0.1.2` | Exact validation, result construction, planning, and digest semantics |
| Canonicalization | `worldcut-json-v1` | Canonical JSON and digest byte rules |

The `1.0.0` promotion does not change protocol behavior or any committed
conformance result. It declares the reviewed public APIs ready for normal
production integration under the assumptions in
[`PRODUCTION.md`](PRODUCTION.md).

## Compatibility commitment

Within the `1.x` package lines:

- existing public APIs, CLI commands, and stable error codes will not be
  removed or incompatibly changed;
- additive APIs and integrations may be introduced in minor releases;
- bug fixes that preserve protocol results may be released as patches;
- changes to normative verification results require an engine-version change
  and updated conformance vectors;
- incompatible package API changes require a new package major version;
- incompatible wire-format changes require a new protocol version.

The packages may release independently. A package patch or minor release can
continue implementing protocol `0.1` and engine `0.1.2`.

## Supported surfaces

The stability commitment covers:

- the TypeScript `worldcut` library package and the `worldcut` and
  `worldcut-github-ci` commands;
- Go verifier, construction API, adapters, integrations, and both CLIs;
- Python `worldcut` library and `worldcut-py`;
- .NET `WorldCut` and `WorldCut.Tool`;
- documented JSON schemas, stable error codes, canonicalization, result
  construction, and verification-record digests.

Provider APIs, cloud service behavior, and the completeness or truthfulness of
supplied evidence remain outside WorldCut's control. Integrations fail closed
when required provider data is unavailable or invalid.
