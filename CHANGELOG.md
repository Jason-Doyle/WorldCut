# Changelog

## Unreleased

- Added a required cross-language differential CI gate that runs the TypeScript,
  Go, Python, and .NET command-line tools over one shared corpus of golden,
  edge, invalid, malformed, and seeded random inputs and compares their complete
  verification results, error codes, and verification-record digests
  (`npm run differential`, documented in `docs/DIFFERENTIAL.md`).
- Fixed the TypeScript CLI accepting transport bytes that are not valid UTF-8.
  Node's lossy decoding replaced malformed bytes with U+FFFD and then verified
  the corrupted evidence; the Go, Python, and .NET ports already rejected it.
  The CLI now reports `WORLDCUT_INVALID_JSON`, and a byte-order mark stays
  rejected.
- Hardened the Go port so a JSON number that underflows the IEEE-754 double
  range, such as `1e-400`, is accepted as a finite zero like the other ports,
  while syntax errors and overflow to infinity are still rejected.

## 0.2.0 - 2026-09-03

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
