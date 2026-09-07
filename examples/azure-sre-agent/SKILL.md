# WorldCut effect-gating procedure

Use this skill whenever an investigation proposes a deployment, rollback,
restart, scale operation, configuration change, or other infrastructure
effect.

1. Collect provider evidence and construct the complete WorldCut verification
   input. Include the exact immutable resource versions the effect would use.
2. Call the `worldcut_gate` Python tool with the serialized verification input
   and the role whose exact version the effect will consume. The contract must
   contain a required dependency whose `targetRole` is that role.
3. Branch only on `allowed`. If it is not `true`, stop. Report
   `contractVerdict`, unresolved
   requirements, and acquisition plan. Do not call a write tool.
4. If `allowed` is `true`, use only `verifiedVersion`. Do not
   re-resolve a branch, tag, deployment name, or latest artifact.
5. Persist the full verification input and `result`, not only the digest.
6. Keep the SRE Agent in Review mode for production changes. Do not use
   `investigate_yolo` for a workflow that has write-capable tools.

This skill is procedural guidance, not an unbypassable security boundary. For
hard enforcement, expose no raw write tool to the agent. Put WorldCut inside
the effect service or a compound `verify_then_apply` tool that refuses the
effect unless verification is satisfied.
