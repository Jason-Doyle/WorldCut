using WorldCut.Json;

namespace WorldCut.Engine;

/// <summary>
/// Selects the minimum declared-cost union of acquisition actions inside the
/// bounded search defined by <c>spec/0.1/PROTOCOL.md</c>.
/// </summary>
/// <remarks>
/// Tie-breaking is, in order: lower total cost, fewer distinct actions, then
/// the lexicographically smaller sorted option-identifier sequence compared by
/// UTF-16 code units. When exact optimality cannot be established inside the
/// documented limits the plan is <c>INCOMPLETE</c> and empty.
/// </remarks>
internal static class AcquisitionPlanner
{
    internal static AcquisitionPlan SelectPlan(IReadOnlyList<RequirementResult> requirementResults)
    {
        var unresolved = new List<RequirementResult>();
        foreach (RequirementResult result in requirementResults)
        {
            if (result.Required && result.Status != RequirementStatus.Satisfied)
            {
                unresolved.Add(result);
            }
        }

        unresolved.Sort(static (left, right) => Utf16.Compare(left.RequirementId, right.RequirementId));

        if (unresolved.Count == 0)
        {
            return new AcquisitionPlan(
                AcquisitionPlanStatus.NotNeeded,
                null,
                Array.Empty<AcquisitionAction>(),
                Array.Empty<string>(),
                0,
                Array.Empty<string>(),
                Array.Empty<string>());
        }

        if (unresolved.Count > WorldCutProtocol.MaxUnresolvedRequirements)
        {
            return IncompletePlan(
                $"Acquisition planning supports at most {WorldCutProtocol.MaxUnresolvedRequirements} unresolved requirements.",
                unresolved);
        }

        var coverable = new List<RequirementResult>();
        var impossible = new List<string>();
        int combinations = 1;

        foreach (RequirementResult result in unresolved)
        {
            int optionCount = result.AcquisitionOptions.Count;
            if (optionCount == 0)
            {
                impossible.Add(result.RequirementId);
                continue;
            }

            if (combinations > WorldCutProtocol.MaxOptionCombinations / optionCount)
            {
                return IncompletePlan(
                    $"Acquisition search exceeds the {WorldCutProtocol.MaxOptionCombinations} combination limit.",
                    unresolved);
            }

            combinations *= optionCount;
            coverable.Add(result);
        }

        var sortedOptions = new List<AcquisitionOption[]>(coverable.Count);
        foreach (RequirementResult result in coverable)
        {
            var options = result.AcquisitionOptions.ToArray();
            Array.Sort(options, static (left, right) => Utf16.Compare(left.Id, right.Id));
            sortedOptions.Add(options);
        }

        Candidate? best = null;
        int visitedStates = 0;
        var stack = new Stack<SearchState>();
        stack.Push(SearchState.Initial);

        while (stack.Count > 0)
        {
            visitedStates++;
            if (visitedStates > WorldCutProtocol.MaxSearchStates)
            {
                return IncompletePlan(
                    $"Acquisition search exceeds the {WorldCutProtocol.MaxSearchStates} state limit.",
                    unresolved);
            }

            SearchState state = stack.Pop();
            if (best is not null && state.Cost > best.Cost)
            {
                continue;
            }

            if (state.Index >= coverable.Count)
            {
                Candidate candidate = state.ToCandidate();
                if (best is null || Compare(candidate, best) < 0)
                {
                    best = candidate;
                }

                continue;
            }

            AcquisitionOption[] options = sortedOptions[state.Index];
            for (int index = options.Length - 1; index >= 0; index--)
            {
                SearchState next = state.WithOption(options[index]);
                if (best is null || next.Cost <= best.Cost)
                {
                    stack.Push(next);
                }
            }
        }

        if (best is null)
        {
            return IncompletePlan("Acquisition search completed without a valid option set.", unresolved);
        }

        var covered = new string[coverable.Count];
        for (int index = 0; index < coverable.Count; index++)
        {
            covered[index] = coverable[index].RequirementId;
        }

        impossible.Sort(Utf16.Compare);

        return new AcquisitionPlan(
            impossible.Count == 0 ? AcquisitionPlanStatus.Available : AcquisitionPlanStatus.Incomplete,
            impossible.Count == 0
                ? null
                : $"No acquisition option is available for: {string.Join(", ", impossible)}.",
            best.Actions,
            best.OptionIds,
            best.Cost,
            covered,
            impossible.ToArray());
    }

    private static AcquisitionPlan IncompletePlan(string reason, List<RequirementResult> unresolved)
    {
        var identifiers = new string[unresolved.Count];
        for (int index = 0; index < unresolved.Count; index++)
        {
            identifiers[index] = unresolved[index].RequirementId;
        }

        return new AcquisitionPlan(
            AcquisitionPlanStatus.Incomplete,
            reason,
            Array.Empty<AcquisitionAction>(),
            Array.Empty<string>(),
            0,
            Array.Empty<string>(),
            identifiers);
    }

    private static int Compare(Candidate left, Candidate right)
    {
        if (left.Cost != right.Cost)
        {
            return left.Cost < right.Cost ? -1 : 1;
        }

        if (left.Actions.Length != right.Actions.Length)
        {
            return left.Actions.Length < right.Actions.Length ? -1 : 1;
        }

        return Utf16.Compare(
            string.Join('\0', left.OptionIds),
            string.Join('\0', right.OptionIds));
    }

    private sealed class Candidate
    {
        internal Candidate(string[] optionIds, AcquisitionAction[] actions, long cost)
        {
            OptionIds = optionIds;
            Actions = actions;
            Cost = cost;
        }

        internal string[] OptionIds { get; }

        internal AcquisitionAction[] Actions { get; }

        internal long Cost { get; }
    }

    private sealed class SearchState
    {
        private static readonly Dictionary<string, AcquisitionAction> NoActions =
            new(StringComparer.Ordinal);

        private readonly Dictionary<string, AcquisitionAction> _actions;
        private readonly List<string> _optionIds;

        private SearchState(int index, List<string> optionIds, Dictionary<string, AcquisitionAction> actions, long cost)
        {
            Index = index;
            _optionIds = optionIds;
            _actions = actions;
            Cost = cost;
        }

        internal static SearchState Initial { get; } = new(0, [], NoActions, 0);

        internal int Index { get; }

        internal long Cost { get; }

        internal SearchState WithOption(AcquisitionOption option)
        {
            var actions = new Dictionary<string, AcquisitionAction>(_actions, StringComparer.Ordinal);
            long cost = Cost;

            foreach (AcquisitionAction action in option.Actions)
            {
                if (action.Cost < 0 || action.Cost > WorldCutProtocol.MaxAcquisitionCost)
                {
                    throw WorldCutException.InvalidInput(
                        $"Acquisition action {action.Id} cost must be between 0 and {WorldCutProtocol.MaxAcquisitionCost}");
                }

                if (actions.TryGetValue(action.Id, out AcquisitionAction? existing))
                {
                    if (existing.Cost != action.Cost)
                    {
                        throw new WorldCutException(
                            WorldCutErrorCode.RuntimeError,
                            $"Acquisition action {action.Id} has conflicting declared costs");
                    }

                    continue;
                }

                if (cost > WorldCutProtocol.MaxPlanTotalCost - action.Cost)
                {
                    throw WorldCutException.InvalidInput(
                        $"Acquisition plan cost exceeds {WorldCutProtocol.MaxPlanTotalCost}");
                }

                actions.Add(action.Id, action);
                cost += action.Cost;
            }

            var optionIds = new List<string>(_optionIds.Count + 1);
            optionIds.AddRange(_optionIds);
            optionIds.Add(option.Id);

            return new SearchState(Index + 1, optionIds, actions, cost);
        }

        internal Candidate ToCandidate()
        {
            var optionIds = _optionIds.ToArray();
            Array.Sort(optionIds, Utf16.Compare);

            var actions = _actions.Values.ToArray();
            Array.Sort(actions, static (left, right) => Utf16.Compare(left.Id, right.Id));

            return new Candidate(optionIds, actions, Cost);
        }
    }
}
