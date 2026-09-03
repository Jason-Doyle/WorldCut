# WorldCut protocol 0.1

This document is normative for the language-neutral WorldCut 0.1 verifier.

## Input

A verification input contains:

- `protocolVersion`, exactly `"0.1"`;
- one decision contract;
- zero or more observations.

The JSON Schema defines transport structure. Implementations must additionally
enforce every runtime invariant represented by the invalid conformance vectors.

## Observation identity

Observation IDs and roles are unique within one verification input.

A resource identity consists of four strings compared component by component:

```text
provider
account
kind
key
```

Versions are comparable only when all four resource components are equal.

## Requirements

### `dependency`

A dependency requirement is:

- `SATISFIED` when the dependent role exposes the named dependency, its
  resource equals the target role's resource, and both versions are equal;
- `VIOLATED` when the dependency names a different resource or version;
- `UNKNOWN` when either role, dependency, or required version is missing.

Only the `exact` dependency relation exists in protocol 0.1.

### `common_valid_time`

Intervals are half-open: `[from, until)`. `until: null` is positive infinity.

Intersect the contract window with every available role validity interval:

```text
start = max(all starts)
end   = min(all finite ends)
```

The requirement is:

- `VIOLATED` when known intervals prove `start >= end`;
- `UNKNOWN` when the known intersection is non-empty but a role or validity
  witness is missing;
- `SATISFIED` otherwise.

### `value_equals`

Follow each path segment through the observation JSON value using exact object
keys or canonical array index strings. An array index is `0` or a non-zero
decimal digit followed only by decimal digits. Leading zeroes, signs,
fractions, and properties such as `length` do not address array elements.

- missing role or path: `UNKNOWN`;
- unequal canonical JSON values: `VIOLATED`;
- equal canonical JSON values: `SATISFIED`.

No coercion, model judgment, or semantic similarity is permitted.

## Aggregate verdict

Advisory requirements do not affect the aggregate verdict.

For required requirements:

1. any `VIOLATED` result produces `CONTRACT_VIOLATED`;
2. otherwise, any `UNKNOWN` result produces `INSUFFICIENT_EVIDENCE`;
3. otherwise the result is `CONTRACT_SATISFIED`.

At least one required requirement must exist.

## Acquisition planning

All actions inside one acquisition option are conjunctive. Separate options
for the same requirement are alternatives.

Implementations choose the minimum declared-cost union of actions while:

- planning at most 64 unresolved requirements;
- enumerating at most 65,536 option combinations;
- visiting at most 4,259,840 search states;
- rejecting any individual cost above 1,000,000,000;
- rejecting any total above 64,000,000,000.

Costs are non-negative integer units. `FETCH_REQUIRED_METADATA` costs
`max(1, ceil(observation.acquisitionCost / 4))`; other observation-backed
actions use the full acquisition cost.

Tie-breaking order is:

1. lower total cost;
2. fewer distinct actions;
3. lexicographically smaller sorted option-ID sequence using UTF-16 code-unit
   ordering.

If exact optimality cannot be established within the limits, the plan is
`INCOMPLETE`.

## Verification record

Requirement results are sorted by requirement ID. Observations and contract
requirements are normalized by role and ID respectively before hashing.

The exact record material and expected digests are defined by the committed
conformance vectors. Human-readable messages in protocol 0.1 are therefore
part of the record contract.
