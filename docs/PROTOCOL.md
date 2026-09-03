# Protocol

WorldCut verifies an explicit decision contract over a selected set of
cross-service observations.

Every transport input includes:

```json
{
  "protocolVersion": "0.1",
  "contract": {},
  "observations": []
}
```

Unsupported protocol versions are rejected before evaluation.

It does not decide which observations an agent should select, infer missing
dependencies, or claim that all facts in a system form one globally consistent
snapshot.

## Terms

### Observation

An observation contains:

- a unique ID;
- a contract role;
- a canonical resource identity;
- a JSON value;
- the time it was acquired;
- its declared reacquisition cost;
- optional version, validity, and dependency witnesses.

Roles bind contract requirements to exact observations. The verifier never
selects an arbitrary observation merely because several share a resource key.
For prospective authorization, every observation must have been acquired no
later than the contract's decision time.

### Resource identity

A resource is identified by:

```text
provider + account + kind + key
```

Components are compared individually rather than concatenated with a delimiter.
Version equality is meaningful only inside the same canonical identity.

### Witness

The MVP records explicit provenance categories:

```text
provider_asserted
client_observed
derived
operator_supplied
```

These categories describe origin. They are not trust scores, signatures, or
proof that the metadata is true.

The Git adapter validates a local branch name with `git check-ref-format` and
resolves that exact `refs/heads/<branch>` ref. Revision expressions and
arbitrary labels are not accepted as branch identities.

### Decision contract

A contract names the relationships that must hold before a consumer may treat
the evidence as sufficient for a particular decision.

The raw facts:

```text
current head = B
CI run 100 passed after testing A
```

can coexist. A deployment contract adds the requirement:

```text
CI.tested_head == selected_head.version
```

That requirement is violated.

## Runtime input boundary

The verifier accepts a closed data schema. Unknown fields are rejected rather
than ignored, including fields that appear to introduce stronger clock,
overlap, trust, or dependency semantics.

Before validation, the caller's input is copied once into data-only,
null-prototype records. Accessors, non-enumerable fields, symbols, sparse
arrays, extra array properties, non-finite numbers, cycles, and unsupported
object prototypes are rejected. Evaluation and digest generation use only that
snapshot.

This prevents caller-owned objects from changing requiredness or other
semantics between validation and evaluation. WorldCut is still not a same-realm
security boundary against code that replaces JavaScript built-in functions.

## Requirement semantics

Every requirement is independently classified as:

| Result | Meaning |
| --- | --- |
| `SATISFIED` | Available metadata establishes the declared predicate |
| `VIOLATED` | Available metadata establishes that the predicate is false |
| `UNKNOWN` | Required observations or metadata are missing |

Required requirements aggregate as:

1. any `VIOLATED` result -> `CONTRACT_VIOLATED`;
2. otherwise, any `UNKNOWN` result -> `INSUFFICIENT_EVIDENCE`;
3. all required results `SATISFIED` -> `CONTRACT_SATISFIED`.

Advisory requirements are reported but never authorize or block the decision.
There is intentionally no `PARTIALLY_COHERENT` authorization verdict.

## Exact dependency requirement

An exact dependency requirement binds:

- one dependent observation role;
- one target observation role;
- one named dependency witness.

It is satisfied only when:

1. both roles are present;
2. the dependency witness is present;
3. dependency and target resource identities match;
4. both versions are present;
5. the versions are equal.

Missing metadata is `UNKNOWN`, not success.

The MVP does not implement ancestry, semantic equivalence, mutable aliases, or
provider-specific comparison rules.

## Common-valid-time requirement

This requirement asks whether named observation roles share a non-empty valid
time inside a contract-supplied window.

All intervals are half-open:

```text
[from, until)
```

`until: null` means explicitly open-ended. A missing validity witness means
unknown, not open-ended.

The MVP assumes a trusted normalized clock. It does not compensate for
cross-provider clock skew or prove that a provider's validity interval is
truthful.

There is no implicit intersection across all selected observations. Temporal
coexistence is checked only when the contract explicitly requires it.

## Value-equals requirement

`value_equals` follows a deterministic path through an observation's JSON
value and compares the result with the contract's expected JSON value.

```json
{
  "id": "ci-conclusion-success",
  "type": "value_equals",
  "description": "The CI conclusion is successful",
  "role": "ci",
  "path": ["conclusion"],
  "expected": "success"
}
```

A missing role or path is `UNKNOWN`. A present unequal value is `VIOLATED`.
Values are compared through WorldCut's canonical JSON representation; no model
or semantic similarity is involved.

## JSON Schema

The package exposes immutable protocol schemas:

```text
worldcut/schemas/0.1/verification-input.json
worldcut/schemas/0.1/verification-result.json
```

JSON Schema validates transport shape. Runtime validation additionally checks
cross-record uniqueness, interval ordering, observation timing, and other
invariants that the schema does not express.

## Verification record digest

The verifier hashes canonicalized:

- contract and ruleset versions;
- sorted observations and requirements;
- verdict;
- requirement results;
- acquisition plan.

The digest detects changes to the local verification record. It is not a
signature, certificate authority, provider attestation, or proof that the
verifier was executed honestly.

## Acquisition plan

Unsatisfied required requirements expose actions such as:

```text
REFRESH_OBSERVATION
FETCH_REQUIRED_METADATA
ACQUIRE_COMPATIBLE_EVIDENCE
```

Each unresolved requirement exposes one or more acquisition options. All
actions inside an option are conjunctive; separate options are alternatives.
The bounded planner selects one option per unresolved requirement and minimizes
the cost of the deduplicated action union. It returns an incomplete plan rather
than planning more than 64 unresolved requirements, exploring more than 65,536
option combinations, or visiting more than 4,259,840 search states.

This is an acquisition plan, not a guaranteed repair plan. Refreshing a
resource may reproduce the same mismatch, and a derived result may require
recomputation rather than rereading.

## Declared fault model

The MVP assumes:

- metadata is honest but may be absent;
- resource identities are correctly scoped;
- timestamps use a trusted normalized clock;
- observation roles are selected by the caller;
- providers are non-Byzantine;
- exact version equality has provider-defined meaning.

Violations of those assumptions require additional trust, signature,
identity-resolution, or clock-bound mechanisms that are outside this MVP.
