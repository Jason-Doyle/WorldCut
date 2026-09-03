import { compareCanonicalText } from "./canonical.js";
import { WorldCutInputError } from "./errors.js";
import {
  MAX_ACQUISITION_COST,
  MAX_PLAN_TOTAL_COST,
} from "./limits.js";
import type {
  AcquisitionAction,
  AcquisitionOption,
  AcquisitionPlan,
  RequirementResult,
} from "./types.js";

interface CandidateSolution {
  optionIds: string[];
  actions: AcquisitionAction[];
  cost: number;
}

interface SearchState {
  index: number;
  optionIds: string[];
  actions: Map<string, AcquisitionAction>;
  cost: number;
}

const MAX_UNRESOLVED_REQUIREMENTS = 64;
const MAX_OPTION_COMBINATIONS = 65_536;
const MAX_SEARCH_STATES = 1_000_000;

function compareSolutions(
  left: CandidateSolution,
  right: CandidateSolution,
): number {
  if (left.cost !== right.cost) {
    return left.cost - right.cost;
  }
  if (left.actions.length !== right.actions.length) {
    return left.actions.length - right.actions.length;
  }
  return compareCanonicalText(
    left.optionIds.join("\u0000"),
    right.optionIds.join("\u0000"),
  );
}

function sortedActions(
  actions: Map<string, AcquisitionAction>,
): AcquisitionAction[] {
  return [...actions.values()].sort((left, right) =>
    compareCanonicalText(left.id, right.id),
  );
}

function addOption(
  state: SearchState,
  option: AcquisitionOption,
): SearchState {
  const actions = new Map(state.actions);
  let cost = state.cost;

  for (const action of option.actions) {
    if (
      !Number.isFinite(action.cost) ||
      action.cost < 0 ||
      action.cost > MAX_ACQUISITION_COST
    ) {
      throw new WorldCutInputError(
        `Acquisition action ${action.id} cost must be between 0 and ${MAX_ACQUISITION_COST}`,
      );
    }
    const existing = actions.get(action.id);
    if (existing && existing.cost !== action.cost) {
      throw new Error(
        `Acquisition action ${action.id} has conflicting declared costs`,
      );
    }
    if (!existing) {
      actions.set(action.id, action);
      if (cost > MAX_PLAN_TOTAL_COST - action.cost) {
        throw new WorldCutInputError(
          `Acquisition plan cost exceeds ${MAX_PLAN_TOTAL_COST}`,
        );
      }
      cost += action.cost;
    }
  }

  return {
    index: state.index + 1,
    optionIds: [...state.optionIds, option.id],
    actions,
    cost,
  };
}

function incompletePlan(
  reason: string,
  unresolvedResults: RequirementResult[],
): AcquisitionPlan {
  return {
    status: "INCOMPLETE",
    reason,
    actions: [],
    selectedOptionIds: [],
    totalCost: 0,
    coveredRequirementIds: [],
    unresolvedRequirementIds: unresolvedResults.map(
      (result) => result.requirementId,
    ),
  };
}

export function selectAcquisitionPlan(
  requirementResults: RequirementResult[],
): AcquisitionPlan {
  const unresolvedResults = requirementResults
    .filter((result) => result.required && result.status !== "SATISFIED")
    .sort((left, right) =>
      compareCanonicalText(left.requirementId, right.requirementId),
    );
  if (unresolvedResults.length === 0) {
    return {
      status: "NOT_NEEDED",
      reason: null,
      actions: [],
      selectedOptionIds: [],
      totalCost: 0,
      coveredRequirementIds: [],
      unresolvedRequirementIds: [],
    };
  }
  if (unresolvedResults.length > MAX_UNRESOLVED_REQUIREMENTS) {
    return incompletePlan(
      `Acquisition planning supports at most ${MAX_UNRESOLVED_REQUIREMENTS} unresolved requirements.`,
      unresolvedResults,
    );
  }

  const coverable = unresolvedResults.filter(
    (result) => result.acquisitionOptions.length > 0,
  );
  const impossible = unresolvedResults
    .filter((result) => result.acquisitionOptions.length === 0)
    .map((result) => result.requirementId);
  let optionCombinations = 1;
  for (const result of coverable) {
    const optionCount = result.acquisitionOptions.length;
    if (
      optionCombinations >
      Math.floor(MAX_OPTION_COMBINATIONS / optionCount)
    ) {
      return incompletePlan(
        `Acquisition search exceeds the ${MAX_OPTION_COMBINATIONS} combination limit.`,
        unresolvedResults,
      );
    }
    optionCombinations *= optionCount;
  }

  let best: CandidateSolution | null = null;
  let visitedStates = 0;
  const stack: SearchState[] = [
    {
      index: 0,
      optionIds: [],
      actions: new Map(),
      cost: 0,
    },
  ];

  while (stack.length > 0) {
    visitedStates += 1;
    if (visitedStates > MAX_SEARCH_STATES) {
      return incompletePlan(
        `Acquisition search exceeds the ${MAX_SEARCH_STATES} state limit.`,
        unresolvedResults,
      );
    }

    const state = stack.pop();
    if (!state) {
      throw new Error("Acquisition search stack became inconsistent");
    }
    if (best && state.cost > best.cost) {
      continue;
    }
    if (state.index >= coverable.length) {
      const candidate: CandidateSolution = {
        optionIds: [...state.optionIds].sort(compareCanonicalText),
        actions: sortedActions(state.actions),
        cost: state.cost,
      };
      if (!best || compareSolutions(candidate, best) < 0) {
        best = candidate;
      }
      continue;
    }

    const result = coverable[state.index];
    if (!result) {
      throw new Error("Acquisition planner lost a requirement");
    }
    const options = [...result.acquisitionOptions].sort((left, right) =>
      compareCanonicalText(left.id, right.id),
    );
    for (let index = options.length - 1; index >= 0; index -= 1) {
      const option = options[index];
      if (!option) {
        continue;
      }
      const next = addOption(state, option);
      if (!best || next.cost <= best.cost) {
        stack.push(next);
      }
    }
  }

  if (!best) {
    return incompletePlan(
      "Acquisition search completed without a valid option set.",
      unresolvedResults,
    );
  }

  const coveredRequirementIds = coverable.map(
    (result) => result.requirementId,
  );
  const unresolvedRequirementIds = [...impossible].sort(compareCanonicalText);

  return {
    status:
      unresolvedRequirementIds.length === 0 ? "AVAILABLE" : "INCOMPLETE",
    reason:
      unresolvedRequirementIds.length === 0
        ? null
        : `No acquisition option is available for: ${unresolvedRequirementIds.join(", ")}.`,
    actions: best.actions,
    selectedOptionIds: best.optionIds,
    totalCost: best.cost,
    coveredRequirementIds,
    unresolvedRequirementIds,
  };
}
