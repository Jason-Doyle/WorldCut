# Production use

WorldCut is suitable for deterministic decision gating inside its declared
fault model. It is not a replacement for provider authentication,
authorization, transactions, or signed provenance.

## Required assumptions

Production use currently assumes:

- metadata is honest but may be absent;
- provider/account/kind/key identifies the intended resource;
- timestamps use normalized UTC and a trusted clock;
- exact version equality has provider-defined meaning;
- the caller selects the correct observations and decision contract;
- the process running WorldCut is trusted.

If those assumptions are not valid, return insufficient evidence or add a
stronger provider-specific mechanism before authorization.

## Deployment checklist

1. Pin an exact WorldCut package version.
2. Validate JSON transport data against the matching immutable schema path.
3. Always call `verifyDecisionContract`; schema validation alone is not
   authorization.
4. Treat `INSUFFICIENT_EVIDENCE` as a blocked decision.
5. Set `decisionTime` after all selected observations have been acquired.
6. Use provider-native immutable versions such as commit SHAs, strong ETags,
   and artifact digests.
7. Deploy the exact verified version, never a mutable branch or alias.
8. Persist the complete verification input and result.
9. Protect persisted evidence according to its sensitivity.
10. Monitor verdict counts, missing roles, missing witnesses, and acquisition
    plan frequency.

## JSON Schema boundary

Published schemas validate the wire format, required fields, enums, timestamp
shape, and non-negative costs.

Runtime verification additionally enforces invariants that JSON Schema cannot
express directly, including:

- unique observation IDs and roles;
- unique requirement IDs;
- unique dependency names per observation;
- valid half-open interval ordering;
- observations acquired no later than `decisionTime`;
- at least one required requirement;
- data-only JavaScript input without accessors, hidden fields, or prototype
  semantics.

## Failure handling

The library throws exported errors with stable codes:

| Code | Meaning |
| --- | --- |
| `WORLDCUT_INVALID_INPUT` | Verification input failed runtime validation |
| `WORLDCUT_INVALID_ARGUMENT` | CLI arguments are invalid |
| `WORLDCUT_FILE_READ_FAILED` | A CLI input file could not be read |
| `WORLDCUT_INVALID_JSON` | A CLI input file is not JSON |
| `WORLDCUT_GITHUB_API_ERROR` | GitHub transport or HTTP failure |
| `WORLDCUT_GITHUB_RESPONSE_INVALID` | GitHub returned unexpected evidence |
| `WORLDCUT_ADK_RESOLUTION_INVALID` | Kernel resolution cannot safely become evidence |

CLI failures are written to stderr as:

```json
{"error":{"code":"WORLDCUT_INVALID_INPUT","message":"..."}}
```

Exit code `2` is reserved for a valid verification that did not satisfy the
required contract. Transport, parsing, and runtime errors use exit code `1`.

## Acquisition plans

An acquisition plan identifies a minimum declared-cost set of evidence actions
within explicit search bounds. It does not guarantee that refreshing evidence
will make a contract satisfiable.

Do not execute acquisition actions automatically unless the application has
separately authorized their effects and bounded their retries.

## Verification records

`verificationRecordDigest` is deterministic for the accepted input domain. It
detects record changes but is not a signature.

For tamper-evident audit:

- persist the full input and result;
- sign or attest the persisted artifact in the surrounding trusted system;
- bind downstream effect intent to the exact digest and verified versions.

## Operational limits

- dependency relations are exact equality only;
- temporal checks assume normalized trusted clocks;
- providers may expose insufficient validity or dependency metadata;
- the acquisition cost model is caller-supplied and operational savings remain
  unproven;
- WorldCut does not coordinate distributed commits or rollbacks.

Production adoption should measure both false authorization and useful
authorization coverage. A system that safely abstains on nearly every request
is not operationally successful.
