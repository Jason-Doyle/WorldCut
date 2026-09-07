# Microsoft Agent Framework effect gate

This deterministic .NET example places WorldCut inside a Microsoft Agent
Framework workflow, between an agent-proposed effect and the effect executor.
No model or Azure credentials are needed to build and run it.

```text
agent or code proposes immutable target
                 |
                 v
        WorldCutGateExecutor
            /           \
   satisfied             violated / unknown
       |                         |
       v                         v
ApplyEffectExecutor       BlockEffectExecutor
```

The effect executor is reachable only through a conditional edge whose input
contains a `CONTRACT_SATISFIED` WorldCut result. It also checks `Allowed`
defensively before applying anything. The target (`commit-B`) is part of the
verified contract, so the executor never re-resolves a mutable branch name.

Run it:

```sh
dotnet restore --locked-mode
dotnet build --configuration Release --no-restore
dotnet run --configuration Release --no-build
```

Expected output:

```text
satisfied: applied commit-B
stale: blocked CONTRACT_VIOLATED
```

The sample effect is intentionally a recorded dry run. Replace the indicated
line in `ApplyEffectExecutor` with the real operation while preserving the gate
and exact immutable target. Do not expose a second unguarded write tool.

Packages are pinned to stable `WorldCut 1.0.0` and
`Microsoft.Agents.AI.Workflows 1.20.0`.
