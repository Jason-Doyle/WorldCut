# Conformance

An implementation is WorldCut 0.1 conformant only when it passes all committed
vectors.

## Vector files

| File | Requirement |
| --- | --- |
| `verification-vectors.json` | Full verification result must match |
| `invalid-vectors.json` | Stable error code must match |
| `canonicalization-vectors.json` | Canonical bytes and SHA-256 must match |
| `raw-vectors.json` | Raw bytes must produce one of the explicitly allowed parse or validation failures |
| `manifest.json` | File hashes and case counts must match |

Exact result construction and digest material are defined in
[`RESULTS.md`](RESULTS.md).

Human summaries, acquisition actions, ordering, and digests are included in the
verification vectors. Implementations cannot substitute equivalent wording.

## Updating vectors

Protocol behavior must change before vectors change. Update the normative
specification, implementation, schemas, and vector generator in the same pull
request.

```sh
npm run conformance:update
npm run conformance:check
```

The update command is intentionally explicit. Normal builds and tests never
rewrite golden files.

## SDK versions

Package versions and protocol versions are independent. An SDK patch can retain
protocol 0.1 and engine 0.1.2 when verification semantics are unchanged.

Any change that alters a committed verification result or digest requires a new
engine version and a documented compatibility decision.
