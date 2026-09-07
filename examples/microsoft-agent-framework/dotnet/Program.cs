using System.Text.Json;
using Microsoft.Agents.AI.Workflows;
using WorldCut;

EffectOutcome satisfied = await RunScenarioAsync(new EvidenceSnapshot(
    BranchVersion: "commit-B",
    TestedVersion: "commit-B",
    Conclusion: "success"));
EffectOutcome stale = await RunScenarioAsync(new EvidenceSnapshot(
    BranchVersion: "commit-B",
    TestedVersion: "commit-A",
    Conclusion: "success"));

if (!satisfied.Applied || stale.Applied)
{
  throw new InvalidOperationException("The WorldCut workflow gate did not enforce the expected paths.");
}

Console.WriteLine($"satisfied: {satisfied.Message}");
Console.WriteLine($"stale: {stale.Message}");

static async Task<EffectOutcome> RunScenarioAsync(EvidenceSnapshot evidence)
{
  const string immutableTarget = "commit-B";
  var gate = new WorldCutGateExecutor();
  var apply = new ApplyEffectExecutor();
  var block = new BlockEffectExecutor();

  Workflow workflow = new WorkflowBuilder(gate)
      .AddEdge<GateDecision>(
          gate,
          apply,
          condition: decision => decision?.Allowed == true)
      .AddEdge<GateDecision>(
          gate,
          block,
          condition: decision => decision?.Allowed != true)
      .WithOutputFrom(apply, block)
      .Build();

  await using Run run = await InProcessExecution.RunAsync(
      workflow,
      new EffectRequest(immutableTarget, evidence));

  WorkflowOutputEvent output = run.NewEvents
      .OfType<WorkflowOutputEvent>()
      .Single();
  return output.Data as EffectOutcome
      ?? throw new InvalidOperationException("The workflow returned an unexpected output.");
}

internal sealed record EvidenceSnapshot(
    string BranchVersion,
    string TestedVersion,
    string Conclusion);

internal sealed record EffectRequest(
    string ImmutableTarget,
    EvidenceSnapshot Evidence);

internal sealed record GateDecision(
    string ImmutableTarget,
    bool Allowed,
    string Verdict,
    string VerificationRecordDigest);

internal sealed record EffectOutcome(
    bool Applied,
    string Message,
    string VerificationRecordDigest);

internal sealed class WorldCutGateExecutor()
    : Executor<EffectRequest, GateDecision>("WorldCutGate")
{
  public override ValueTask<GateDecision> HandleAsync(
      EffectRequest message,
      IWorkflowContext context,
      CancellationToken cancellationToken = default)
  {
    cancellationToken.ThrowIfCancellationRequested();
    byte[] input = BuildVerificationInput(message);
    VerificationResult result = WorldCutVerifier.VerifyJsonUtf8(input);

    return ValueTask.FromResult(new GateDecision(
        message.ImmutableTarget,
        result.Verdict == ContractVerdict.ContractSatisfied,
        result.Verdict.ToWireName(),
        result.VerificationRecordDigest));
  }

  private static byte[] BuildVerificationInput(EffectRequest request)
  {
    const string decisionTime = "2026-09-07T12:00:00.000Z";
    Dictionary<string, object?> branchResource = Resource(
        provider: "github",
        account: "acme/service",
        kind: "branch_head",
        key: "main");

    Dictionary<string, object?> document = new()
    {
      ["protocolVersion"] = "0.1",
      ["contract"] = new Dictionary<string, object?>
      {
        ["id"] = "agent-effect-gate",
        ["version"] = "1",
        ["decisionTime"] = decisionTime,
        ["assumptions"] = new Dictionary<string, object?>
        {
          ["clockModel"] = "trusted_normalized",
          ["intervalModel"] = "half_open",
          ["metadataModel"] = "honest_but_possibly_incomplete",
        },
        ["requirements"] = new object[]
            {
                    new Dictionary<string, object?>
                    {
                        ["id"] = "effect-target-is-selected-head",
                        ["description"] = "The proposed effect targets the selected immutable head",
                        ["type"] = "value_equals",
                        ["role"] = "head",
                        ["path"] = new[] { "commit" },
                        ["expected"] = request.ImmutableTarget,
                    },
                    new Dictionary<string, object?>
                    {
                        ["id"] = "ci-concluded-successfully",
                        ["description"] = "The selected CI run concluded successfully",
                        ["type"] = "value_equals",
                        ["role"] = "ci",
                        ["path"] = new[] { "conclusion" },
                        ["expected"] = "success",
                    },
                    new Dictionary<string, object?>
                    {
                        ["id"] = "ci-tested-selected-head",
                        ["description"] = "The selected CI run tested the selected immutable head",
                        ["type"] = "dependency",
                        ["dependentRole"] = "ci",
                        ["targetRole"] = "head",
                        ["dependencyName"] = "tested_head",
                    },
            },
      },
      ["observations"] = new object[]
        {
                new Dictionary<string, object?>
                {
                    ["id"] = "head-observation",
                    ["role"] = "head",
                    ["resource"] = branchResource,
                    ["value"] = new Dictionary<string, object?>
                    {
                        ["commit"] = request.Evidence.BranchVersion,
                    },
                    ["observedAt"] = "2026-09-07T11:59:58.000Z",
                    ["acquisitionCost"] = 1,
                    ["witness"] = new Dictionary<string, object?>
                    {
                        ["provenance"] = "provider_asserted",
                        ["version"] = request.Evidence.BranchVersion,
                    },
                },
                new Dictionary<string, object?>
                {
                    ["id"] = "ci-observation",
                    ["role"] = "ci",
                    ["resource"] = Resource(
                        provider: "github-actions",
                        account: "acme/service",
                        kind: "workflow_run",
                        key: "ci.yml/2041"),
                    ["value"] = new Dictionary<string, object?>
                    {
                        ["conclusion"] = request.Evidence.Conclusion,
                    },
                    ["observedAt"] = "2026-09-07T11:59:59.000Z",
                    ["acquisitionCost"] = 2,
                    ["witness"] = new Dictionary<string, object?>
                    {
                        ["provenance"] = "provider_asserted",
                        ["version"] = "2041",
                        ["dependencies"] = new object[]
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "tested_head",
                                ["resource"] = branchResource,
                                ["relation"] = "exact",
                                ["version"] = request.Evidence.TestedVersion,
                                ["provenance"] = "provider_asserted",
                            },
                        },
                    },
                },
        },
    };

    return JsonSerializer.SerializeToUtf8Bytes(document);
  }

  private static Dictionary<string, object?> Resource(
      string provider,
      string account,
      string kind,
      string key) =>
      new()
      {
        ["provider"] = provider,
        ["account"] = account,
        ["kind"] = kind,
        ["key"] = key,
      };
}

internal sealed class ApplyEffectExecutor()
    : Executor<GateDecision, EffectOutcome>("ApplyEffect")
{
  public override ValueTask<EffectOutcome> HandleAsync(
      GateDecision message,
      IWorkflowContext context,
      CancellationToken cancellationToken = default)
  {
    cancellationToken.ThrowIfCancellationRequested();
    if (!message.Allowed)
    {
      throw new InvalidOperationException("An unsatisfied WorldCut decision reached the effect executor.");
    }

    // The example records the exact immutable target instead of performing
    // infrastructure mutation. Replace this line with the real effect
    // implementation, preserving the same gate and immutable target.
    return ValueTask.FromResult(new EffectOutcome(
        Applied: true,
        Message: $"applied {message.ImmutableTarget}",
        message.VerificationRecordDigest));
  }
}

internal sealed class BlockEffectExecutor()
    : Executor<GateDecision, EffectOutcome>("BlockEffect")
{
  public override ValueTask<EffectOutcome> HandleAsync(
      GateDecision message,
      IWorkflowContext context,
      CancellationToken cancellationToken = default)
  {
    cancellationToken.ThrowIfCancellationRequested();
    return ValueTask.FromResult(new EffectOutcome(
        Applied: false,
        Message: $"blocked {message.Verdict}",
        message.VerificationRecordDigest));
  }
}
