# Gating agent effects with WorldCut

WorldCut belongs on the effect path. Exposing verification as an optional tool
is useful for investigation, but it does not guarantee that an agent calls the
tool before a write.

## Enforceable pattern

```text
agent proposes action + immutable target
                  |
                  v
          collect provider evidence
                  |
                  v
             WorldCut gate
             /          \
       satisfied      violated / unknown
           |                 |
           v                 v
 apply exact version        stop
```

The effect implementation must consume the exact verified version. Verifying a
branch or deployment name and resolving it again during execution reintroduces
the race WorldCut is meant to prevent.

Persist the full verification input and result with the decision. The digest
detects changes but cannot reconstruct the evidence.

## Microsoft Agent Framework

Use an explicit workflow executor between the agent and effect executors.
Conditional edges route `CONTRACT_SATISFIED` to the effect and every other
verdict to a blocked output. The effect executor should also check the decision
defensively.

The runnable example under
[`examples/microsoft-agent-framework/dotnet`](../examples/microsoft-agent-framework/dotnet)
uses `Microsoft.Agents.AI.Workflows` and the published `WorldCut` NuGet package.
It needs no model endpoint or Azure credentials.

Function-calling middleware can provide a second boundary for agents with
tool-calling loops: intercept effectful functions, construct or load the
verification input, and do not call `next` unless WorldCut is satisfied.
Avoid relying on agent-run middleware alone when effects occur in tools.

## Azure SRE Agent

Azure SRE Agent supports custom Python tools with pip dependencies and skills
that attach procedural guidance to tools. The example under
[`examples/azure-sre-agent`](../examples/azure-sre-agent) provides:

- a tested `main(verification_input: str, target_role: str) -> dict` Python
  tool;
- one requested exact verified version only when the contract is satisfied;
- a `SKILL.md` procedure for investigation and remediation workflows.

An SRE Agent skill is guidance rather than a mandatory policy hook. For hard
enforcement, do not expose an unguarded write tool. Put WorldCut inside a
compound effect service or require a verified record at the target API.
Keep production workflows in Review mode; Azure documents that
`investigate_yolo` bypasses approval gates, including infrastructure changes.

An MCP server is not required for this pattern. MCP is useful when WorldCut
must be shared as a remote tool across many clients, but it still does not make
verification mandatory unless the effect endpoint enforces it.

## Other agent runtimes

Use the same control boundary regardless of framework:

| Runtime | WorldCut placement |
| --- | --- |
| LangGraph | A deterministic node followed by a conditional edge; no path to the effect node for violated or unknown verdicts |
| OpenAI Agents SDK | A wrapper around effectful tools that verifies before dispatch; do not expose the unwrapped tool |
| GitHub Copilot or other MCP clients | Keep verification in CI or the effect service; an MCP tool alone is optional |
| Scheduled runbooks | Verify immediately before the effect and pass the immutable version into the command |

Framework integrations should remain thin. WorldCut verifies declared
relationships; the framework remains responsible for orchestration, approvals,
credentials, retries, and effect execution.
