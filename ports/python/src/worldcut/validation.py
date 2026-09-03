from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping
from typing import Literal, cast

from .errors import WorldCutInputError
from .models import (
    CommonValidTimeRequirement,
    Contract,
    DependencyRequirement,
    DependencyWitness,
    FrozenJson,
    JsonValue,
    NormalizedTimestamp,
    Observation,
    ObservationWitness,
    ParsedInput,
    Provenance,
    Requirement,
    ResourceIdentity,
    ValidityInterval,
    ValueEqualsRequirement,
    _new_parsed_input,
    _VerificationInput,
    freeze_json,
)

PROTOCOL_VERSION: Literal["0.1"] = "0.1"
MAX_ACQUISITION_COST = 1_000_000_000
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_TIMESTAMP = re.compile(
    r"^(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})T"
    r"(?P<hour>\d{2}):(?P<minute>\d{2}):(?P<second>\d{2})\."
    r"(?P<millisecond>\d{3})Z$"
)
_PROVENANCE = {
    "provider_asserted",
    "client_observed",
    "derived",
    "operator_supplied",
}


def _validate_raw_unicode(source: bytes) -> str:
    try:
        text = source.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ValueError("input is not valid UTF-8") from error

    in_string = False
    index = 0
    while index < len(text):
        character = text[index]
        if not in_string:
            if character == '"':
                in_string = True
            index += 1
            continue
        if character == '"':
            in_string = False
            index += 1
            continue
        if character != "\\":
            if 0xD800 <= ord(character) <= 0xDFFF:
                raise ValueError("input contains an unpaired surrogate")
            index += 1
            continue
        index += 1
        if index >= len(text):
            raise ValueError("unterminated JSON escape")
        if text[index] != "u":
            index += 1
            continue
        escape_start = index + 1
        escape_end = escape_start + 4
        if escape_end > len(text):
            raise ValueError("incomplete Unicode escape")
        try:
            code_unit = int(text[escape_start:escape_end], 16)
        except ValueError as error:
            raise ValueError("invalid Unicode escape") from error
        index = escape_end
        if 0xD800 <= code_unit <= 0xDBFF:
            if text[index : index + 2] != "\\u" or index + 6 > len(text):
                raise ValueError("unpaired high surrogate")
            try:
                low = int(text[index + 2 : index + 6], 16)
            except ValueError as error:
                raise ValueError("unpaired high surrogate") from error
            if not 0xDC00 <= low <= 0xDFFF:
                raise ValueError("unpaired high surrogate")
            index += 6
        elif 0xDC00 <= code_unit <= 0xDFFF:
            raise ValueError("unpaired low surrogate")
    return text


def _parse_number(text: str) -> int | float:
    number = float(text)
    if not math.isfinite(number):
        raise ValueError(f"invalid JSON number {text!r}")
    if number.is_integer() and abs(number) <= _MAX_SAFE_INTEGER:
        return int(number)
    return number


def _reject_constant(text: str) -> JsonValue:
    raise ValueError(f"invalid JSON constant {text}")


def _decode_json(source: bytes) -> JsonValue:
    text = _validate_raw_unicode(source)
    value = json.loads(
        text,
        parse_int=_parse_number,
        parse_float=_parse_number,
        parse_constant=_reject_constant,
    )
    return cast(JsonValue, value)


def _record(value: JsonValue, field: str) -> dict[str, JsonValue]:
    if type(value) is not dict:
        raise ValueError(f"{field} must be a plain object")
    return value


def _array(value: JsonValue, field: str) -> list[JsonValue]:
    if type(value) is not list:
        raise ValueError(f"{field} must be an array")
    return value


def _exact_keys(record: Mapping[str, JsonValue], allowed: set[str], field: str) -> None:
    unknown = [key for key in record if key not in allowed]
    if unknown:
        raise ValueError(f"{field} contains unsupported field(s): {', '.join(unknown)}")


def _required_keys(
    record: Mapping[str, JsonValue], required: tuple[str, ...], field: str
) -> None:
    missing = [key for key in required if key not in record]
    if missing:
        raise ValueError(f"{field} is missing required field(s): {', '.join(missing)}")


def _non_empty_string(value: JsonValue, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must not be empty")
    return value


def _timestamp(value: JsonValue, field: str) -> tuple[str, NormalizedTimestamp]:
    text = _non_empty_string(value, field)
    match = _TIMESTAMP.fullmatch(text)
    if match is None:
        raise ValueError(
            f"{field} must use normalized ISO-8601 UTC form with milliseconds"
        )
    parts = {name: int(raw) for name, raw in match.groupdict().items()}
    year = parts["year"]
    month = parts["month"]
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    month_lengths = (31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    if (
        month < 1
        or month > 12
        or parts["day"] < 1
        or parts["day"] > month_lengths[month - 1]
        or parts["hour"] > 23
        or parts["minute"] > 59
        or parts["second"] > 59
    ):
        raise ValueError(
            f"{field} must use normalized ISO-8601 UTC form with milliseconds"
        )
    order = year
    for component, radix in (
        (month, 13),
        (parts["day"], 32),
        (parts["hour"], 24),
        (parts["minute"], 60),
        (parts["second"], 60),
        (parts["millisecond"], 1000),
    ):
        order = order * radix + component
    return text, NormalizedTimestamp(order=order, text=text)


def _resource(value: JsonValue, field: str) -> ResourceIdentity:
    record = _record(value, field)
    keys = {"provider", "account", "kind", "key"}
    _exact_keys(record, keys, field)
    _required_keys(record, ("provider", "account", "kind", "key"), field)
    return ResourceIdentity(
        provider=_non_empty_string(record["provider"], f"{field}.provider"),
        account=_non_empty_string(record["account"], f"{field}.account"),
        kind=_non_empty_string(record["kind"], f"{field}.kind"),
        key=_non_empty_string(record["key"], f"{field}.key"),
    )


def _interval(value: JsonValue, field: str) -> ValidityInterval:
    record = _record(value, field)
    _exact_keys(record, {"from", "until"}, field)
    _required_keys(record, ("from", "until"), field)
    from_text, start = _timestamp(record["from"], f"{field}.from")
    until_value = record["until"]
    if until_value is None:
        return ValidityInterval(from_text, None, start, None)
    until_text, end = _timestamp(until_value, f"{field}.until")
    if end <= start:
        raise ValueError(f"{field} must be a non-empty half-open interval")
    return ValidityInterval(from_text, until_text, start, end)


def _provenance(value: JsonValue, field: str) -> Provenance:
    text = _non_empty_string(value, field)
    if text not in _PROVENANCE:
        raise ValueError(f"{field} is not a supported provenance category")
    return cast(Provenance, text)


def _dependency(value: JsonValue, role: str) -> DependencyWitness:
    field = f"{role}.dependency"
    record = _record(value, field)
    _exact_keys(
        record, {"name", "resource", "relation", "version", "provenance"}, field
    )
    _required_keys(record, ("name", "resource", "relation", "provenance"), field)
    name = _non_empty_string(record["name"], "dependency.name")
    relation = _non_empty_string(
        record["relation"], f"{role}.dependency.{name}.relation"
    )
    if relation != "exact":
        raise ValueError(f"{role}.dependency.{name}.relation is unsupported")
    version = (
        _non_empty_string(record["version"], f"{role}.dependency.{name}.version")
        if "version" in record
        else None
    )
    return DependencyWitness(
        name=name,
        resource=_resource(record["resource"], f"{role}.dependency.{name}.resource"),
        relation="exact",
        version=version,
        provenance=_provenance(
            record["provenance"], f"{role}.dependency.{name}.provenance"
        ),
    )


def _witness(value: JsonValue, role: str) -> ObservationWitness:
    field = f"{role}.witness"
    record = _record(value, field)
    _exact_keys(record, {"provenance", "version", "validity", "dependencies"}, field)
    _required_keys(record, ("provenance",), field)
    version = (
        _non_empty_string(record["version"], f"{field}.version")
        if "version" in record
        else None
    )
    validity = (
        _interval(record["validity"], f"{field}.validity")
        if "validity" in record
        else None
    )
    dependencies: list[DependencyWitness] = []
    names: set[str] = set()
    if "dependencies" in record:
        for raw_dependency in _array(record["dependencies"], f"{field}.dependencies"):
            dependency = _dependency(raw_dependency, role)
            if dependency.name in names:
                raise ValueError(
                    f"Duplicate dependency {dependency.name} on role {role}"
                )
            names.add(dependency.name)
            dependencies.append(dependency)
    return ObservationWitness(
        provenance=_provenance(record["provenance"], f"{field}.provenance"),
        version=version,
        validity=validity,
        dependencies=tuple(dependencies),
    )


def _observation(value: JsonValue) -> Observation:
    record = _record(value, "observation")
    allowed = {
        "id",
        "role",
        "resource",
        "value",
        "observedAt",
        "acquisitionCost",
        "witness",
    }
    _exact_keys(record, allowed, "observation")
    _required_keys(record, tuple(sorted(allowed)), "observation")
    identifier = _non_empty_string(record["id"], "observation.id")
    role = _non_empty_string(record["role"], "observation.role")
    observed_at_text, observed_at = _timestamp(
        record["observedAt"], f"{role}.observedAt"
    )
    cost = record["acquisitionCost"]
    if isinstance(cost, bool) or not isinstance(cost, int):
        raise ValueError(
            f"{role}.acquisitionCost must be between 0 and {MAX_ACQUISITION_COST}"
        )
    if cost < 0 or cost > MAX_ACQUISITION_COST:
        raise ValueError(
            f"{role}.acquisitionCost must be between 0 and {MAX_ACQUISITION_COST}"
        )
    return Observation(
        id=identifier,
        role=role,
        resource=_resource(record["resource"], f"{role}.resource"),
        value=freeze_json(record["value"]),
        observed_at_text=observed_at_text,
        observed_at=observed_at,
        acquisition_cost=cost,
        witness=_witness(record["witness"], role),
        raw=cast(Mapping[str, FrozenJson], freeze_json(record)),
    )


def _required_flag(record: Mapping[str, JsonValue], identifier: str) -> bool:
    if "required" not in record:
        return True
    required = record["required"]
    if not isinstance(required, bool):
        raise ValueError(f"{identifier}.required must be boolean")
    return required


def _requirement(value: JsonValue) -> Requirement:
    record = _record(value, "requirement")
    _required_keys(record, ("id", "description", "type"), "requirement")
    identifier = _non_empty_string(record["id"], "requirement.id")
    description = _non_empty_string(record["description"], f"{identifier}.description")
    requirement_type = _non_empty_string(record["type"], f"{identifier}.type")
    required = _required_flag(record, identifier)
    frozen_raw = cast(Mapping[str, FrozenJson], freeze_json(record))
    if requirement_type == "dependency":
        _exact_keys(
            record,
            {
                "id",
                "description",
                "required",
                "type",
                "dependentRole",
                "targetRole",
                "dependencyName",
            },
            identifier,
        )
        _required_keys(
            record, ("dependentRole", "targetRole", "dependencyName"), identifier
        )
        return DependencyRequirement(
            id=identifier,
            description=description,
            required=required,
            raw=frozen_raw,
            type="dependency",
            dependent_role=_non_empty_string(
                record["dependentRole"], f"{identifier}.dependentRole"
            ),
            target_role=_non_empty_string(
                record["targetRole"], f"{identifier}.targetRole"
            ),
            dependency_name=_non_empty_string(
                record["dependencyName"], f"{identifier}.dependencyName"
            ),
        )
    if requirement_type == "common_valid_time":
        _exact_keys(
            record,
            {"id", "description", "required", "type", "roles", "within"},
            identifier,
        )
        _required_keys(record, ("roles", "within"), identifier)
        role_values = _array(record["roles"], f"{identifier}.roles")
        if len(role_values) < 2:
            raise ValueError(f"{identifier} must reference at least two roles")
        roles: list[str] = []
        seen: set[str] = set()
        for raw_role in role_values:
            role = _non_empty_string(raw_role, f"{identifier}.role")
            if role in seen:
                raise ValueError(f"{identifier} contains duplicate role {role}")
            seen.add(role)
            roles.append(role)
        return CommonValidTimeRequirement(
            id=identifier,
            description=description,
            required=required,
            raw=frozen_raw,
            type="common_valid_time",
            roles=tuple(roles),
            within=_interval(record["within"], f"{identifier}.within"),
        )
    if requirement_type == "value_equals":
        _exact_keys(
            record,
            {"id", "description", "required", "type", "role", "path", "expected"},
            identifier,
        )
        _required_keys(record, ("role", "path", "expected"), identifier)
        path_values = _array(record["path"], f"{identifier}.path")
        if not path_values:
            raise ValueError(f"{identifier}.path must contain at least one segment")
        path = tuple(
            _non_empty_string(segment, f"{identifier}.path segment")
            for segment in path_values
        )
        return ValueEqualsRequirement(
            id=identifier,
            description=description,
            required=required,
            raw=frozen_raw,
            type="value_equals",
            role=_non_empty_string(record["role"], f"{identifier}.role"),
            path=path,
            expected=freeze_json(record["expected"]),
        )
    raise ValueError(f"Unsupported requirement type: {requirement_type}")


def _contract(value: JsonValue) -> Contract:
    record = _record(value, "contract")
    allowed = {"id", "version", "decisionTime", "assumptions", "requirements"}
    _exact_keys(record, allowed, "contract")
    _required_keys(record, tuple(sorted(allowed)), "contract")
    identifier = _non_empty_string(record["id"], "contract.id")
    version = _non_empty_string(record["version"], "contract.version")
    decision_time_text, decision_time = _timestamp(
        record["decisionTime"], "contract.decisionTime"
    )
    assumptions = _record(record["assumptions"], "contract.assumptions")
    assumption_keys = {"clockModel", "intervalModel", "metadataModel"}
    _exact_keys(assumptions, assumption_keys, "contract.assumptions")
    _required_keys(assumptions, tuple(sorted(assumption_keys)), "contract.assumptions")
    if (
        assumptions["clockModel"] != "trusted_normalized"
        or assumptions["intervalModel"] != "half_open"
        or assumptions["metadataModel"] != "honest_but_possibly_incomplete"
    ):
        raise ValueError("contract assumptions are not supported by this engine")
    requirements: list[Requirement] = []
    identifiers: set[str] = set()
    required_count = 0
    for raw_requirement in _array(record["requirements"], "contract.requirements"):
        requirement = _requirement(raw_requirement)
        if requirement.id in identifiers:
            raise ValueError(f"Duplicate requirement id: {requirement.id}")
        identifiers.add(requirement.id)
        required_count += int(requirement.required)
        requirements.append(requirement)
    if required_count == 0:
        raise ValueError(
            "A decision contract must contain at least one required requirement"
        )
    return Contract(
        id=identifier,
        version=version,
        decision_time_text=decision_time_text,
        decision_time=decision_time,
        requirements=tuple(requirements),
        raw=cast(Mapping[str, FrozenJson], freeze_json(record)),
    )


def _validate_input(value: JsonValue) -> _VerificationInput:
    root = _record(value, "input")
    allowed = {"protocolVersion", "contract", "observations"}
    _exact_keys(root, allowed, "input")
    _required_keys(root, tuple(sorted(allowed)), "input")
    if root["protocolVersion"] != PROTOCOL_VERSION:
        raise ValueError("input.protocolVersion must equal 0.1")
    contract = _contract(root["contract"])
    observations: list[Observation] = []
    identifiers: set[str] = set()
    roles: set[str] = set()
    for raw_observation in _array(root["observations"], "observations"):
        observation = _observation(raw_observation)
        if observation.id in identifiers:
            raise ValueError(f"Duplicate observation id: {observation.id}")
        if observation.role in roles:
            raise ValueError(f"Duplicate observation role: {observation.role}")
        if observation.observed_at > contract.decision_time:
            raise ValueError(
                f"{observation.role}.observedAt must not be after contract.decisionTime"
            )
        identifiers.add(observation.id)
        roles.add(observation.role)
        observations.append(observation)
    return _VerificationInput(
        protocol_version="0.1",
        contract=contract,
        observations=tuple(observations),
    )


def parse_input(source: str | bytes | bytearray) -> ParsedInput:
    """Parse, validate, and immutably snapshot one WorldCut verification input."""

    if isinstance(source, str):
        raw = source.encode("utf-8", errors="surrogatepass")
    elif isinstance(source, bytes):
        raw = source
    elif isinstance(source, bytearray):
        raw = bytes(source)
    else:
        raise TypeError("source must be str, bytes, or bytearray")
    try:
        return _new_parsed_input(_validate_input(_decode_json(raw)))
    except (ValueError, json.JSONDecodeError, RecursionError) as error:
        raise WorldCutInputError(str(error)) from error
