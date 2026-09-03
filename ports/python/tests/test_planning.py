from __future__ import annotations

from worldcut.models import AcquisitionAction, AcquisitionOption, RequirementResult
from worldcut.planning import select_acquisition_plan


def _action(identifier: str, cost: int) -> AcquisitionAction:
    return {
        "id": identifier,
        "type": "REFRESH_OBSERVATION",
        "role": identifier,
        "cost": cost,
        "description": identifier,
        "expected": None,
    }


def _option(identifier: str, actions: list[AcquisitionAction]) -> AcquisitionOption:
    return {"id": identifier, "description": identifier, "actions": actions}


def _unresolved(identifier: str, options: list[AcquisitionOption]) -> RequirementResult:
    return {
        "requirementId": identifier,
        "requirementType": "dependency",
        "required": True,
        "status": "UNKNOWN",
        "summary": identifier,
        "details": None,
        "acquisitionOptions": options,
    }


def test_planner_deduplicates_shared_actions() -> None:
    shared = _action("shared", 3)
    plan = select_acquisition_plan(
        [
            _unresolved(
                "r1",
                [
                    _option("r1-shared", [shared]),
                    _option("r1-only", [_action("r1", 2)]),
                ],
            ),
            _unresolved(
                "r2",
                [
                    _option("r2-shared", [shared]),
                    _option("r2-only", [_action("r2", 2)]),
                ],
            ),
        ]
    )
    assert plan["status"] == "AVAILABLE"
    assert plan["totalCost"] == 3
    assert [action["id"] for action in plan["actions"]] == ["shared"]


def test_planner_tie_breaks_by_action_count_then_option_id() -> None:
    plan = select_acquisition_plan(
        [
            _unresolved(
                "r",
                [
                    _option("r:b", [_action("one", 2)]),
                    _option("r:a", [_action("left", 1), _action("right", 1)]),
                ],
            )
        ]
    )
    assert plan["selectedOptionIds"] == ["r:b"]
