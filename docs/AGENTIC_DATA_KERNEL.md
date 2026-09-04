# Agentic Data Kernel integration

WorldCut can consume resolved Agentic Data Kernel assertions without taking a
runtime dependency on the kernel package. The adapter is available in
TypeScript (`observationFromAgenticDataResolution`) and Go
(`agenticdatakernel.ObservationFromResolution`).

The integration is structural by design:

- Agentic Data Kernel remains responsible for durable evidence, bitemporal
  assertions, conflict-preserving resolution, workflow state, and effects.
- WorldCut verifies relationships across the selected resolved observations.
- Application code remains responsible for enforcing a satisfied WorldCut
  result before requesting or dispatching an effect.

Agentic Data Kernel does not currently enforce WorldCut verification records
natively.

## Required assertion metadata

Store WorldCut metadata in the assertion's namespaced `basis` field:

```json
{
  "worldcut": {
    "protocolVersion": "0.1",
    "role": "head",
    "resource": {
      "provider": "github",
      "account": "tenant-a",
      "kind": "branch_head",
      "key": "payments/main"
    },
    "provenance": "provider_asserted",
    "version": "commit-B",
    "acquisitionCost": 1
  }
}
```

Dependency witnesses use the same representation as native WorldCut
observations:

```json
{
  "worldcut": {
    "protocolVersion": "0.1",
    "role": "ci",
    "resource": {
      "provider": "github-actions",
      "account": "tenant-a",
      "kind": "workflow_run",
      "key": "ci.yml/2041"
    },
    "provenance": "provider_asserted",
    "version": "2041",
    "dependencies": [
      {
        "name": "tested_head",
        "resource": {
          "provider": "github",
          "account": "tenant-a",
          "kind": "branch_head",
          "key": "payments/main"
        },
        "relation": "exact",
        "version": "commit-B",
        "provenance": "provider_asserted"
      }
    ]
  }
}
```

The resource `account` must equal the assertion's `tenantId`. This prevents a
record from claiming evidence belonging to another tenant.

## Resolution requirements

Use a kernel resolution result, not an arbitrary assertion row:

```ts
import {
  observationFromAgenticDataResolution,
  verifyDecisionContract,
} from "worldcut";

const headObservation = observationFromAgenticDataResolution(headResolution);
const ciObservation = observationFromAgenticDataResolution(ciResolution);

const result = verifyDecisionContract({
  protocolVersion: "0.1",
  contract,
  observations: [headObservation, ciObservation],
});
```

The adapter rejects:

- `unknown` and `conflicted` resolutions;
- `resolved_with_conflict` unless explicitly allowed;
- a missing selected assertion;
- any assertion status other than `active`;
- assertions not system-valid at `resolution.systemAt`;
- assertions not business-valid at `resolution.validAt`;
- missing or unsupported `basis.worldcut` metadata;
- resource accounts that do not match `tenantId`.

Allowing `resolved_with_conflict` is an application policy decision:

```ts
const observation = observationFromAgenticDataResolution(resolution, {
  allowResolvedWithConflict: true,
});
```

The unresolved candidates remain relevant audit evidence and should be
persisted with the verification record.

## Go

The Go port provides the same structural adapter, with the same rejections and
the same `WORLDCUT_ADK_RESOLUTION_INVALID` error code:

```go
import (
	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	adk "github.com/Jason-Doyle/WorldCut/ports/go/integrations/agenticdatakernel"
)

head, err := adk.ObservationFromResolution(headResolution, adk.Options{})
if err != nil {
	return err
}
ci, err := adk.ObservationFromResolution(ciResolution, adk.Options{
	AllowResolvedWithConflict: true,
})
if err != nil {
	return err
}

result, err := worldcut.VerifyDecisionContract(worldcut.VerificationInput{
	Contract:     contract,
	Observations: []worldcut.Observation{head, ci},
})
```

`Resolution` and `Assertion` are structural Go types. The kernel object and
`basis` values are supplied as ordinary Go values and are snapshotted, so the
returned observation never aliases caller state.

## Persisting verification

Persist the complete WorldCut input and result as an immutable kernel artifact,
not only `verificationRecordDigest`. The digest detects changes but does not
contain the evidence needed to reconstruct the decision.

A recommended application flow is:

```text
resolve kernel assertions
        |
        v
adapt selected records to WorldCut observations
        |
        v
verify decision contract
        |
        +--> violated / insufficient: stop
        |
        v
store input + result as immutable artifact
        |
        v
link artifact to decision and workflow revision
        |
        v
request effect using the exact verified resource versions
```

WorldCut verification and effect creation are not currently one database
transaction. Production applications should either:

1. repeat verification immediately before effect creation; or
2. add an application transaction that binds the effect intent and
   idempotency record to the verification digest and exact selected versions.

Do not verify a branch name and later re-resolve that branch during execution.
Effects should consume the immutable commit, artifact digest, or provider
version that WorldCut verified.
