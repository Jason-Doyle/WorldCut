from __future__ import annotations

from dataclasses import dataclass

from .canonicalization import utf16_sort_key
from .errors import WorldCutInputError
from .models import AcquisitionAction, AcquisitionPlan, RequirementResult

MAX_UNRESOLVED_REQUIREMENTS = 64
MAX_OPTION_COMBINATIONS = 65_536
MAX_SEARCH_STATES = (MAX_UNRESOLVED_REQUIREMENTS + 1) * MAX_OPTION_COMBINATIONS
MAX_ACQUISITION_COST = 1_000_000_000
MAX_PLAN_TOTAL_COST = 64_000_000_000


@dataclass(slots=True)
class _SearchState:
    index: int
    option_ids: list[str]
    actions: dict[str, AcquisitionAction]
    cost: int


@dataclass(slots=True)
class _Candidate:
    option_ids: list[str]
    actions: list[AcquisitionAction]
    cost: int


def _candidate_key(candidate: _Candidate) -> tuple[int, int, bytes]:
    return (
        candidate.cost,
        len(candidate.actions),
        utf16_sort_key("\0".join(candidate.option_ids)),
    )


def _incomplete(reason: str, unresolved: list[RequirementResult]) -> AcquisitionPlan:
    return {
        "status": "INCOMPLETE",
        "reason": reason,
        "actions": [],
        "selectedOptionIds": [],
        "totalCost": 0,
        "coveredRequirementIds": [],
        "unresolvedRequirementIds": [result["requirementId"] for result in unresolved],
    }


def _add_option(
    state: _SearchState, option_id: str, option_actions: list[AcquisitionAction]
) -> _SearchState:
    actions = dict(state.actions)
    cost = state.cost
    for action in option_actions:
        action_cost = action["cost"]
        if action_cost < 0 or action_cost > MAX_ACQUISITION_COST:
            raise WorldCutInputError(
                f"Acquisition action {action['id']} cost must be between 0 and "
                f"{MAX_ACQUISITION_COST}"
            )
        existing = actions.get(action["id"])
        if existing is not None:
            if existing["cost"] != action_cost:
                raise RuntimeError(
                    f"Acquisition action {action['id']} has conflicting declared costs"
                )
            continue
        if cost > MAX_PLAN_TOTAL_COST - action_cost:
            raise WorldCutInputError(
                f"Acquisition plan cost exceeds {MAX_PLAN_TOTAL_COST}"
            )
        actions[action["id"]] = action
        cost += action_cost
    return _SearchState(
        index=state.index + 1,
        option_ids=[*state.option_ids, option_id],
        actions=actions,
        cost=cost,
    )


def select_acquisition_plan(
    requirement_results: list[RequirementResult],
) -> AcquisitionPlan:
    """Select the exact minimum-cost acquisition plan within protocol limits."""

    unresolved = sorted(
        (
            result
            for result in requirement_results
            if result["required"] and result["status"] != "SATISFIED"
        ),
        key=lambda result: utf16_sort_key(result["requirementId"]),
    )
    if not unresolved:
        return {
            "status": "NOT_NEEDED",
            "reason": None,
            "actions": [],
            "selectedOptionIds": [],
            "totalCost": 0,
            "coveredRequirementIds": [],
            "unresolvedRequirementIds": [],
        }
    if len(unresolved) > MAX_UNRESOLVED_REQUIREMENTS:
        return _incomplete(
            "Acquisition planning supports at most 64 unresolved requirements.",
            unresolved,
        )

    coverable: list[RequirementResult] = []
    impossible: list[str] = []
    combinations = 1
    for result in unresolved:
        options = result["acquisitionOptions"]
        if not options:
            impossible.append(result["requirementId"])
            continue
        if combinations > MAX_OPTION_COMBINATIONS // len(options):
            return _incomplete(
                "Acquisition search exceeds the 65536 combination limit.",
                unresolved,
            )
        combinations *= len(options)
        coverable.append(result)

    stack = [_SearchState(index=0, option_ids=[], actions={}, cost=0)]
    best: _Candidate | None = None
    visited = 0
    while stack:
        visited += 1
        if visited > MAX_SEARCH_STATES:
            return _incomplete(
                "Acquisition search exceeds the 4259840 state limit.",
                unresolved,
            )
        state = stack.pop()
        if best is not None and state.cost > best.cost:
            continue
        if state.index >= len(coverable):
            candidate = _Candidate(
                option_ids=sorted(state.option_ids, key=utf16_sort_key),
                actions=sorted(
                    state.actions.values(),
                    key=lambda action: utf16_sort_key(action["id"]),
                ),
                cost=state.cost,
            )
            if best is None or _candidate_key(candidate) < _candidate_key(best):
                best = candidate
            continue
        options = sorted(
            coverable[state.index]["acquisitionOptions"],
            key=lambda option: utf16_sort_key(option["id"]),
        )
        for option in reversed(options):
            next_state = _add_option(state, option["id"], option["actions"])
            if best is None or next_state.cost <= best.cost:
                stack.append(next_state)

    if best is None:
        return _incomplete(
            "Acquisition search completed without a valid option set.",
            unresolved,
        )
    impossible.sort(key=utf16_sort_key)
    return {
        "status": "AVAILABLE" if not impossible else "INCOMPLETE",
        "reason": (
            None
            if not impossible
            else (f"No acquisition option is available for: {', '.join(impossible)}.")
        ),
        "actions": best.actions,
        "selectedOptionIds": best.option_ids,
        "totalCost": best.cost,
        "coveredRequirementIds": [result["requirementId"] for result in coverable],
        "unresolvedRequirementIds": impossible,
    }
