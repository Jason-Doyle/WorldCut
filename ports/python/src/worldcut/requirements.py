from __future__ import annotations

import re
from collections.abc import Mapping
from typing import cast

from .canonicalization import canonical_json, sha256_digest
from .models import (
    AcquisitionAction,
    AcquisitionActionType,
    AcquisitionOption,
    CommonValidTimeRequirement,
    DependencyRequirement,
    FrozenJson,
    JsonValue,
    NormalizedTimestamp,
    Observation,
    Requirement,
    RequirementResult,
    ResourceIdentity,
    ValidityInterval,
    ValueEqualsRequirement,
    thaw_json,
)

_CANONICAL_ARRAY_INDEX = re.compile(r"^(0|[1-9][0-9]*)$")


def _resource_json(resource: ResourceIdentity) -> JsonValue:
    return {
        "provider": resource.provider,
        "account": resource.account,
        "kind": resource.kind,
        "key": resource.key,
    }


def _interval_json(interval: ValidityInterval) -> JsonValue:
    return {"from": interval.from_text, "until": interval.until_text}


def _action(
    action_type: AcquisitionActionType,
    observation: Observation | None,
    role: str,
    description: str,
    expected: JsonValue,
) -> AcquisitionAction:
    if observation is None:
        cost = 1
    elif action_type == "FETCH_REQUIRED_METADATA":
        cost = max(1, (observation.acquisition_cost + 3) // 4)
    else:
        cost = observation.acquisition_cost
    expected_digest = "none" if expected is None else sha256_digest(expected)[:12]
    return {
        "id": f"{action_type.lower()}:{role}:{expected_digest}",
        "type": action_type,
        "role": role,
        "cost": cost,
        "description": description,
        "expected": expected,
    }


def _option(
    requirement_id: str,
    suffix: str,
    description: str,
    actions: list[AcquisitionAction],
) -> AcquisitionOption:
    return {
        "id": f"{requirement_id}:{suffix}",
        "description": description,
        "actions": actions,
    }


def _missing_roles_result(
    requirement: Requirement, roles: list[str]
) -> RequirementResult:
    actions = [
        _action(
            "REFRESH_OBSERVATION",
            None,
            role,
            f"Acquire an observation for role {role}.",
            None,
        )
        for role in roles
    ]
    return {
        "requirementId": requirement.id,
        "requirementType": requirement.type,
        "required": requirement.required,
        "status": "UNKNOWN",
        "summary": (
            f"No observations are bound to required role(s): {', '.join(roles)}."
        ),
        "details": {"missingRoles": cast(list[JsonValue], roles)},
        "acquisitionOptions": [
            _option(
                requirement.id,
                "acquire-missing-roles",
                "Acquire every missing role required to evaluate this requirement.",
                actions,
            )
        ],
    }


def evaluate_dependency(
    requirement: DependencyRequirement,
    observations: Mapping[str, Observation],
) -> RequirementResult:
    missing_roles = [
        role
        for role in (requirement.dependent_role, requirement.target_role)
        if role not in observations
    ]
    if missing_roles:
        return _missing_roles_result(requirement, missing_roles)
    dependent = observations[requirement.dependent_role]
    target = observations[requirement.target_role]
    dependency = next(
        (
            candidate
            for candidate in dependent.witness.dependencies
            if candidate.name == requirement.dependency_name
        ),
        None,
    )
    if dependency is None:
        actions = [
            _action(
                "FETCH_REQUIRED_METADATA",
                dependent,
                dependent.role,
                f"Fetch dependency metadata for {dependent.role}.",
                {
                    "dependencyName": requirement.dependency_name,
                    "targetResource": _resource_json(target.resource),
                },
            )
        ]
        if target.witness.version is None:
            actions.append(
                _action(
                    "FETCH_REQUIRED_METADATA",
                    target,
                    target.role,
                    f"Fetch the resource version for {target.role}.",
                    None,
                )
            )
        return {
            "requirementId": requirement.id,
            "requirementType": requirement.type,
            "required": requirement.required,
            "status": "UNKNOWN",
            "summary": (
                f"{dependent.role} does not expose dependency "
                f"{requirement.dependency_name}."
            ),
            "details": {
                "dependentRole": dependent.role,
                "targetRole": target.role,
                "missingDependency": requirement.dependency_name,
            },
            "acquisitionOptions": [
                _option(
                    requirement.id,
                    "fetch-dependency-metadata",
                    "Fetch all metadata required to compare the dependency.",
                    actions,
                )
            ],
        }
    if dependency.resource != target.resource:
        return {
            "requirementId": requirement.id,
            "requirementType": requirement.type,
            "required": requirement.required,
            "status": "VIOLATED",
            "summary": (
                f"{dependent.role} is bound to a different resource than {target.role}."
            ),
            "details": {
                "dependentResource": _resource_json(dependency.resource),
                "targetResource": _resource_json(target.resource),
            },
            "acquisitionOptions": [
                _option(
                    requirement.id,
                    "acquire-compatible-resource",
                    (
                        "Acquire dependent evidence bound to the selected "
                        "target resource."
                    ),
                    [
                        _action(
                            "ACQUIRE_COMPATIBLE_EVIDENCE",
                            dependent,
                            dependent.role,
                            (
                                f"Acquire {dependent.role} evidence for the "
                                f"selected {target.role} resource."
                            ),
                            {"targetResource": _resource_json(target.resource)},
                        )
                    ],
                )
            ],
        }
    if dependency.version is None or target.witness.version is None:
        actions = []
        if dependency.version is None:
            actions.append(
                _action(
                    "FETCH_REQUIRED_METADATA",
                    dependent,
                    dependent.role,
                    f"Fetch the dependency version for {dependent.role}.",
                    {"dependencyName": requirement.dependency_name},
                )
            )
        if target.witness.version is None:
            actions.append(
                _action(
                    "FETCH_REQUIRED_METADATA",
                    target,
                    target.role,
                    f"Fetch the resource version for {target.role}.",
                    None,
                )
            )
        return {
            "requirementId": requirement.id,
            "requirementType": requirement.type,
            "required": requirement.required,
            "status": "UNKNOWN",
            "summary": (
                f"Version evidence is incomplete for {requirement.description}."
            ),
            "details": {
                "dependencyVersion": dependency.version,
                "targetVersion": target.witness.version,
            },
            "acquisitionOptions": [
                _option(
                    requirement.id,
                    "fetch-all-version-metadata",
                    "Fetch every missing version needed for this comparison.",
                    actions,
                )
            ],
        }
    dependency_version = dependency.version
    target_version = target.witness.version
    if dependency_version != target_version:
        return {
            "requirementId": requirement.id,
            "requirementType": requirement.type,
            "required": requirement.required,
            "status": "VIOLATED",
            "summary": (
                f"{requirement.description}: {dependency_version} does not equal "
                f"{target_version}."
            ),
            "details": {
                "dependentRole": dependent.role,
                "dependencyVersion": dependency_version,
                "targetRole": target.role,
                "targetVersion": target_version,
                "relation": dependency.relation,
            },
            "acquisitionOptions": [
                _option(
                    requirement.id,
                    "acquire-compatible-dependent",
                    (
                        "Acquire dependent evidence bound to the selected "
                        "target version."
                    ),
                    [
                        _action(
                            "ACQUIRE_COMPATIBLE_EVIDENCE",
                            dependent,
                            dependent.role,
                            (
                                f"Acquire {dependent.role} evidence bound to "
                                f"{target_version}."
                            ),
                            {
                                "targetRole": target.role,
                                "targetVersion": target_version,
                            },
                        )
                    ],
                ),
                _option(
                    requirement.id,
                    "refresh-target",
                    "Refresh the target before selecting compatible evidence.",
                    [
                        _action(
                            "REFRESH_OBSERVATION",
                            target,
                            target.role,
                            (
                                f"Refresh {target.role} before selecting "
                                "compatible evidence."
                            ),
                            {
                                "dependentRole": dependent.role,
                                "dependentVersion": dependency_version,
                            },
                        )
                    ],
                ),
            ],
        }
    return {
        "requirementId": requirement.id,
        "requirementType": requirement.type,
        "required": requirement.required,
        "status": "SATISFIED",
        "summary": (
            f"{requirement.description}: both roles are bound to {dependency_version}."
        ),
        "details": {
            "dependentRole": dependent.role,
            "targetRole": target.role,
            "version": dependency_version,
        },
        "acquisitionOptions": [],
    }


def evaluate_common_valid_time(
    requirement: CommonValidTimeRequirement,
    observations_by_role: Mapping[str, Observation],
) -> RequirementResult:
    missing_roles = [
        role for role in requirement.roles if role not in observations_by_role
    ]
    observations = [
        observations_by_role[role]
        for role in requirement.roles
        if role in observations_by_role
    ]
    missing_validity = [
        observation
        for observation in observations
        if observation.witness.validity is None
    ]
    prerequisite_actions = [
        _action(
            "REFRESH_OBSERVATION",
            None,
            role,
            f"Acquire an observation for role {role}.",
            None,
        )
        for role in missing_roles
    ]
    prerequisite_actions.extend(
        _action(
            "FETCH_REQUIRED_METADATA",
            observation,
            observation.role,
            f"Fetch validity metadata for {observation.role}.",
            {"within": _interval_json(requirement.within)},
        )
        for observation in missing_validity
    )

    latest_start = requirement.within.start
    earliest_end = requirement.within.end
    for observation in observations:
        validity = observation.witness.validity
        if validity is None:
            continue
        latest_start = max(latest_start, validity.start)
        if validity.end is not None:
            earliest_end = (
                validity.end
                if earliest_end is None
                else min(earliest_end, validity.end)
            )

    missing_validity_roles = [observation.role for observation in missing_validity]
    if earliest_end is not None and latest_start >= earliest_end:
        options = []
        for observation in observations:
            refresh = _action(
                "REFRESH_OBSERVATION",
                observation,
                observation.role,
                (f"Refresh {observation.role} to seek a compatible validity window."),
                {"within": _interval_json(requirement.within)},
            )
            options.append(
                _option(
                    requirement.id,
                    f"refresh-{observation.role}",
                    (
                        f"Refresh {observation.role} and acquire every other "
                        "missing prerequisite."
                    ),
                    [refresh, *prerequisite_actions],
                )
            )
        return {
            "requirementId": requirement.id,
            "requirementType": requirement.type,
            "required": requirement.required,
            "status": "VIOLATED",
            "summary": (
                f"{requirement.description}: the known validity intervals "
                "do not overlap."
            ),
            "details": {
                "roles": cast(list[JsonValue], list(requirement.roles)),
                "latestStart": _format_timestamp(latest_start),
                "earliestEnd": _format_timestamp(earliest_end),
                "missingRoles": cast(list[JsonValue], missing_roles),
                "missingValidityRoles": cast(list[JsonValue], missing_validity_roles),
            },
            "acquisitionOptions": options,
        }

    end_text = _format_timestamp(earliest_end) if earliest_end is not None else None
    if missing_roles or missing_validity:
        return {
            "requirementId": requirement.id,
            "requirementType": requirement.type,
            "required": requirement.required,
            "status": "UNKNOWN",
            "summary": f"{requirement.description}: validity evidence is incomplete.",
            "details": {
                "roles": cast(list[JsonValue], list(requirement.roles)),
                "missingRoles": cast(list[JsonValue], missing_roles),
                "missingValidityRoles": cast(list[JsonValue], missing_validity_roles),
                "possibleKnownWindow": {
                    "from": _format_timestamp(latest_start),
                    "until": end_text,
                },
            },
            "acquisitionOptions": [
                _option(
                    requirement.id,
                    "acquire-all-validity-prerequisites",
                    "Acquire every missing observation and validity witness.",
                    prerequisite_actions,
                )
            ],
        }
    return {
        "requirementId": requirement.id,
        "requirementType": requirement.type,
        "required": requirement.required,
        "status": "SATISFIED",
        "summary": f"{requirement.description}: a common valid time exists.",
        "details": {
            "roles": list(requirement.roles),
            "commonWindow": {
                "from": _format_timestamp(latest_start),
                "until": end_text,
            },
        },
        "acquisitionOptions": [],
    }


def _format_timestamp(value: NormalizedTimestamp) -> str:
    return value.text


def _value_at_path(value: FrozenJson, path: tuple[str, ...]) -> tuple[bool, FrozenJson]:
    current = value
    for segment in path:
        if isinstance(current, tuple):
            if _CANONICAL_ARRAY_INDEX.fullmatch(segment) is None:
                return False, None
            index = int(segment)
            if index >= len(current):
                return False, None
            current = current[index]
        elif isinstance(current, Mapping):
            if segment not in current:
                return False, None
            current = current[segment]
        else:
            return False, None
    return True, current


def evaluate_value_equals(
    requirement: ValueEqualsRequirement,
    observations: Mapping[str, Observation],
) -> RequirementResult:
    if requirement.role not in observations:
        return _missing_roles_result(requirement, [requirement.role])
    observation = observations[requirement.role]
    display_path = ".".join(requirement.path)
    found, frozen_actual = _value_at_path(observation.value, requirement.path)
    expected = thaw_json(requirement.expected)
    if not found:
        return {
            "requirementId": requirement.id,
            "requirementType": requirement.type,
            "required": requirement.required,
            "status": "UNKNOWN",
            "summary": (
                f"{requirement.description}: value path {display_path} is missing."
            ),
            "details": {
                "role": requirement.role,
                "path": list(requirement.path),
                "expected": expected,
            },
            "acquisitionOptions": [
                _option(
                    requirement.id,
                    "acquire-value",
                    "Acquire evidence containing the required value path.",
                    [
                        _action(
                            "ACQUIRE_COMPATIBLE_EVIDENCE",
                            observation,
                            observation.role,
                            (
                                f"Acquire {observation.role} evidence containing "
                                f"{display_path}."
                            ),
                            {
                                "path": list(requirement.path),
                                "expected": thaw_json(requirement.expected),
                            },
                        )
                    ],
                )
            ],
        }
    actual = thaw_json(frozen_actual)
    if canonical_json(actual) != canonical_json(expected):
        return {
            "requirementId": requirement.id,
            "requirementType": requirement.type,
            "required": requirement.required,
            "status": "VIOLATED",
            "summary": (
                f"{requirement.description}: observed value does not equal "
                "the required value."
            ),
            "details": {
                "role": requirement.role,
                "path": list(requirement.path),
                "expected": expected,
                "actual": actual,
            },
            "acquisitionOptions": [
                _option(
                    requirement.id,
                    "refresh-value",
                    "Refresh the observation before evaluating the value again.",
                    [
                        _action(
                            "REFRESH_OBSERVATION",
                            observation,
                            observation.role,
                            (
                                f"Refresh {observation.role} before evaluating "
                                f"{display_path}."
                            ),
                            {
                                "path": list(requirement.path),
                                "expected": thaw_json(requirement.expected),
                            },
                        )
                    ],
                )
            ],
        }
    return {
        "requirementId": requirement.id,
        "requirementType": requirement.type,
        "required": requirement.required,
        "status": "SATISFIED",
        "summary": (
            f"{requirement.description}: observed value matches the requirement."
        ),
        "details": {
            "role": requirement.role,
            "path": list(requirement.path),
            "expected": expected,
        },
        "acquisitionOptions": [],
    }
