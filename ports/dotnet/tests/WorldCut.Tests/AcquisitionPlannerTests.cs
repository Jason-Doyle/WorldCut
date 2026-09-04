using WorldCut.Engine;
using WorldCut.Json;

namespace WorldCut.Tests;

/// <summary>
/// Boundary behaviour of the bounded acquisition planner.
/// </summary>
public sealed class AcquisitionPlannerTests
{
    [Fact]
    public void Shared_actions_are_deduplicated_and_counted_once()
    {
        AcquisitionAction shared = Action("shared", 3);

        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(
        [
            Unresolved("r1", [Option("r1-shared", shared), Option("r1-only", Action("r1", 2))]),
            Unresolved("r2", [Option("r2-shared", shared), Option("r2-only", Action("r2", 2))]),
        ]);

        Assert.Equal(AcquisitionPlanStatus.Available, plan.Status);
        Assert.Equal(3, plan.TotalCost);
        Assert.Equal(["shared"], plan.Actions.Select(action => action.Id));
        Assert.Equal(["r1-shared", "r2-shared"], plan.SelectedOptionIds);
        Assert.Equal(["r1", "r2"], plan.CoveredRequirementIds);
        Assert.Empty(plan.UnresolvedRequirementIds);
    }

    [Fact]
    public void Ties_break_by_action_count_before_option_identifier()
    {
        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(
        [
            Unresolved("r",
            [
                Option("r:b", Action("one", 2)),
                Option("r:a", Action("left", 1), Action("right", 1)),
            ]),
        ]);

        Assert.Equal(["r:b"], plan.SelectedOptionIds);
        Assert.Equal(2, plan.TotalCost);
    }

    [Fact]
    public void Ties_break_by_sorted_option_identifier_last()
    {
        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(
        [
            Unresolved("r",
            [
                Option("r:b", Action("second", 2)),
                Option("r:a", Action("first", 2)),
            ]),
        ]);

        Assert.Equal(["r:a"], plan.SelectedOptionIds);
    }

    [Fact]
    public void A_satisfied_contract_needs_no_plan()
    {
        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(
        [
            new RequirementResult(
                "r",
                "dependency",
                true,
                RequirementStatus.Satisfied,
                "r",
                JsonValue.Null,
                Array.Empty<AcquisitionOption>()),
        ]);

        Assert.Equal(AcquisitionPlanStatus.NotNeeded, plan.Status);
        Assert.Null(plan.Reason);
        Assert.Equal(0, plan.TotalCost);
        Assert.Empty(plan.Actions);
        Assert.Empty(plan.CoveredRequirementIds);
        Assert.Empty(plan.UnresolvedRequirementIds);
    }

    [Fact]
    public void Advisory_requirements_never_participate()
    {
        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(
        [
            new RequirementResult(
                "advisory",
                "value_equals",
                false,
                RequirementStatus.Unknown,
                "advisory",
                JsonValue.Null,
                [Option("advisory:only", Action("advisory", 9))]),
        ]);

        Assert.Equal(AcquisitionPlanStatus.NotNeeded, plan.Status);
    }

    [Fact]
    public void Requirements_without_options_are_reported_as_unresolved()
    {
        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(
        [
            Unresolved("covered", [Option("covered:only", Action("a", 4))]),
            Unresolved("bare", []),
        ]);

        Assert.Equal(AcquisitionPlanStatus.Incomplete, plan.Status);
        Assert.Equal("No acquisition option is available for: bare.", plan.Reason);
        Assert.Equal(["covered"], plan.CoveredRequirementIds);
        Assert.Equal(["bare"], plan.UnresolvedRequirementIds);
        Assert.Equal(4, plan.TotalCost);
        Assert.Equal(["a"], plan.Actions.Select(action => action.Id));
    }

    [Fact]
    public void The_unresolved_requirement_limit_is_exactly_sixty_four()
    {
        RequirementResult[] atLimit = Enumerate(WorldCutProtocol.MaxUnresolvedRequirements);
        RequirementResult[] beyondLimit = Enumerate(WorldCutProtocol.MaxUnresolvedRequirements + 1);

        Assert.Equal(AcquisitionPlanStatus.Available, AcquisitionPlanner.SelectPlan(atLimit).Status);

        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(beyondLimit);
        Assert.Equal(AcquisitionPlanStatus.Incomplete, plan.Status);
        Assert.Equal(
            "Acquisition planning supports at most 64 unresolved requirements.",
            plan.Reason);
        Assert.Empty(plan.Actions);
        Assert.Empty(plan.SelectedOptionIds);
        Assert.Equal(0, plan.TotalCost);
        Assert.Equal(
            WorldCutProtocol.MaxUnresolvedRequirements + 1,
            plan.UnresolvedRequirementIds.Count);
    }

    [Fact]
    public void The_combination_limit_is_exactly_sixty_five_thousand_five_hundred_and_thirty_six()
    {
        // 2^16 == 65536 combinations is accepted; 2^17 is not.
        Assert.Equal(AcquisitionPlanStatus.Available, AcquisitionPlanner.SelectPlan(Binary(16)).Status);

        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(Binary(17));

        Assert.Equal(AcquisitionPlanStatus.Incomplete, plan.Status);
        Assert.Equal("Acquisition search exceeds the 65536 combination limit.", plan.Reason);
        Assert.Empty(plan.Actions);
        Assert.Equal(17, plan.UnresolvedRequirementIds.Count);
    }

    [Fact]
    public void The_defensive_state_limit_matches_the_specification() =>
        Assert.Equal(4_259_840, WorldCutProtocol.MaxSearchStates);

    [Fact]
    public void An_action_cost_above_the_protocol_bound_is_rejected()
    {
        WorldCutException error = Assert.Throws<WorldCutException>(() => AcquisitionPlanner.SelectPlan(
        [
            Unresolved("r", [Option("r:only", Action("a", WorldCutProtocol.MaxAcquisitionCost + 1))]),
        ]));

        Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
    }

    [Fact]
    public void A_total_plan_cost_above_the_protocol_bound_is_rejected()
    {
        var results = new List<RequirementResult>();
        for (int index = 0; index < 65; index++)
        {
            results.Add(Unresolved(
                $"r{index:D2}",
                [Option($"r{index:D2}:only", Action($"a{index:D2}", WorldCutProtocol.MaxAcquisitionCost))]));
        }

        // 65 requirements exceeds the planning limit, so trim to 64 maximum-cost
        // actions and add one more option to the last requirement.
        results.RemoveAt(64);
        results[63] = Unresolved(
            "r63",
            [
                Option("r63:only", Action("a63", WorldCutProtocol.MaxAcquisitionCost)),
                Option(
                    "r63:pair",
                    Action("a63", WorldCutProtocol.MaxAcquisitionCost),
                    Action("a64", WorldCutProtocol.MaxAcquisitionCost)),
            ]);

        WorldCutException error = Assert.Throws<WorldCutException>(
            () => AcquisitionPlanner.SelectPlan(results));

        Assert.Equal(WorldCutErrorCode.InvalidInput, error.Code);
        Assert.Contains("64000000000", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Zero_cost_actions_are_accepted()
    {
        AcquisitionPlan plan = AcquisitionPlanner.SelectPlan(
        [
            Unresolved("r", [Option("r:free", Action("free", 0))]),
        ]);

        Assert.Equal(AcquisitionPlanStatus.Available, plan.Status);
        Assert.Equal(0, plan.TotalCost);
        Assert.Equal(["free"], plan.Actions.Select(action => action.Id));
    }

    private static RequirementResult[] Enumerate(int count)
    {
        var results = new RequirementResult[count];
        for (int index = 0; index < count; index++)
        {
            string id = $"r{index:D3}";
            results[index] = Unresolved(id, [Option($"{id}:only", Action(id, 1))]);
        }

        return results;
    }

    private static RequirementResult[] Binary(int count)
    {
        var results = new RequirementResult[count];
        for (int index = 0; index < count; index++)
        {
            string id = $"r{index:D3}";
            results[index] = Unresolved(
                id,
                [
                    Option($"{id}:a", Action($"{id}-a", 1)),
                    Option($"{id}:b", Action($"{id}-b", 1)),
                ]);
        }

        return results;
    }

    private static AcquisitionAction Action(string id, long cost) =>
        new(id, AcquisitionActionType.RefreshObservation, id, cost, id, null);

    private static AcquisitionOption Option(string id, params AcquisitionAction[] actions) =>
        new(id, id, actions);

    private static RequirementResult Unresolved(string id, AcquisitionOption[] options) =>
        new(id, "dependency", true, RequirementStatus.Unknown, id, JsonValue.Null, options);
}
