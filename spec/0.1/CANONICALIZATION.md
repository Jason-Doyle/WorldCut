# WorldCut JSON canonicalization v1

`worldcut-json-v1` converts accepted JSON data to UTF-8 before SHA-256 hashing.

The serialization follows the RFC 8785 JSON Canonicalization Scheme rules used
by ECMAScript JSON serialization:

- object keys are sorted by raw UTF-16 code units;
- arrays retain their original order;
- strings use JSON escaping without optional whitespace;
- finite numbers use ECMAScript's shortest round-trippable representation;
- negative zero is serialized as `0`;
- `NaN` and infinities are rejected;
- unpaired UTF-16 surrogates are rejected;
- object members are separated by `,` and names from values by `:`.

WorldCut's JavaScript reference performs an additional data snapshot before
canonicalization. It rejects accessors, symbols, hidden fields, sparse arrays,
cycles, non-plain objects, and extra array properties. Other language
implementations need not reproduce JavaScript object-model checks, but they
must reject non-JSON input exposed by their public API.

The file
`conformance/0.1/canonicalization-vectors.json` is normative. A compliant
implementation must produce every byte string and SHA-256 digest exactly.

Implementations may use an RFC 8785 library only if it passes the WorldCut
vectors unchanged.
