from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Literal, NotRequired, TypeAlias, TypedDict

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonPrimitive | list["JsonValue"] | dict[str, "JsonValue"]
FrozenJson: TypeAlias = (
    JsonPrimitive | tuple["FrozenJson", ...] | Mapping[str, "FrozenJson"]
)

Provenance: TypeAlias = Literal[
    "provider_asserted",
    "client_observed",
    "derived",
    "operator_supplied",
]
RequirementStatus: TypeAlias = Literal["SATISFIED", "VIOLATED", "UNKNOWN"]
ContractVerdict: TypeAlias = Literal[
    "CONTRACT_SATISFIED",
    "CONTRACT_VIOLATED",
    "INSUFFICIENT_EVIDENCE",
]
RequirementType: TypeAlias = Literal["dependency", "common_valid_time", "value_equals"]
AcquisitionActionType: TypeAlias = Literal[
    "REFRESH_OBSERVATION",
    "FETCH_REQUIRED_METADATA",
    "ACQUIRE_COMPATIBLE_EVIDENCE",
]


class AcquisitionAction(TypedDict):
    id: str
    type: AcquisitionActionType
    role: str
    cost: int
    description: str
    expected: JsonValue


class AcquisitionOption(TypedDict):
    id: str
    description: str
    actions: list[AcquisitionAction]


class RequirementResult(TypedDict):
    requirementId: str
    requirementType: RequirementType
    required: bool
    status: RequirementStatus
    summary: str
    details: JsonValue
    acquisitionOptions: list[AcquisitionOption]


class AcquisitionPlan(TypedDict):
    status: Literal["NOT_NEEDED", "AVAILABLE", "INCOMPLETE"]
    reason: str | None
    actions: list[AcquisitionAction]
    selectedOptionIds: list[str]
    totalCost: int
    coveredRequirementIds: list[str]
    unresolvedRequirementIds: list[str]


class VerificationCoverage(TypedDict):
    required: int
    satisfied: int
    violated: int
    unknown: int
    advisory: int


class VerificationResult(TypedDict):
    protocolVersion: Literal["0.1"]
    engineVersion: str
    canonicalization: Literal["worldcut-json-v1"]
    contractId: str
    contractVersion: str
    verdict: ContractVerdict
    coverage: VerificationCoverage
    requirementResults: list[RequirementResult]
    acquisitionPlan: AcquisitionPlan
    verificationRecordDigest: str


class ResourceInput(TypedDict):
    provider: str
    account: str
    kind: str
    key: str


class ValidityInput(TypedDict):
    from_: str
    until: str | None


class DependencyInput(TypedDict):
    name: str
    resource: ResourceInput
    relation: Literal["exact"]
    provenance: Provenance
    version: NotRequired[str]


@dataclass(frozen=True, slots=True)
class ResourceIdentity:
    provider: str
    account: str
    kind: str
    key: str


@dataclass(frozen=True, slots=True, order=True)
class NormalizedTimestamp:
    order: int
    text: str = field(compare=False)


@dataclass(frozen=True, slots=True)
class ValidityInterval:
    from_text: str
    until_text: str | None
    start: NormalizedTimestamp
    end: NormalizedTimestamp | None


@dataclass(frozen=True, slots=True)
class DependencyWitness:
    name: str
    resource: ResourceIdentity
    relation: Literal["exact"]
    version: str | None
    provenance: Provenance


@dataclass(frozen=True, slots=True)
class ObservationWitness:
    provenance: Provenance
    version: str | None
    validity: ValidityInterval | None
    dependencies: tuple[DependencyWitness, ...]


@dataclass(frozen=True, slots=True)
class Observation:
    id: str
    role: str
    resource: ResourceIdentity
    value: FrozenJson
    observed_at_text: str
    observed_at: NormalizedTimestamp
    acquisition_cost: int
    witness: ObservationWitness
    raw: Mapping[str, FrozenJson]


@dataclass(frozen=True, slots=True)
class RequirementBase:
    id: str
    description: str
    required: bool
    raw: Mapping[str, FrozenJson]


@dataclass(frozen=True, slots=True)
class DependencyRequirement(RequirementBase):
    type: Literal["dependency"]
    dependent_role: str
    target_role: str
    dependency_name: str


@dataclass(frozen=True, slots=True)
class CommonValidTimeRequirement(RequirementBase):
    type: Literal["common_valid_time"]
    roles: tuple[str, ...]
    within: ValidityInterval


@dataclass(frozen=True, slots=True)
class ValueEqualsRequirement(RequirementBase):
    type: Literal["value_equals"]
    role: str
    path: tuple[str, ...]
    expected: FrozenJson


Requirement: TypeAlias = (
    DependencyRequirement | CommonValidTimeRequirement | ValueEqualsRequirement
)


@dataclass(frozen=True, slots=True)
class Contract:
    id: str
    version: str
    decision_time_text: str
    decision_time: NormalizedTimestamp
    requirements: tuple[Requirement, ...]
    raw: Mapping[str, FrozenJson]


@dataclass(frozen=True, slots=True)
class _VerificationInput:
    protocol_version: Literal["0.1"]
    contract: Contract
    observations: tuple[Observation, ...]


_PARSED_INPUT_TOKEN = object()


class ParsedInput:
    """Opaque immutable handle returned by :func:`worldcut.parse_input`."""

    __slots__ = ("__value",)
    __value: _VerificationInput

    def __init__(self, value: _VerificationInput, token: object) -> None:
        if token is not _PARSED_INPUT_TOKEN:
            raise TypeError("ParsedInput must be produced by parse_input")
        object.__setattr__(self, "_ParsedInput__value", value)

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("ParsedInput is immutable")

    def _unwrap(self) -> _VerificationInput:
        return self.__value


def _new_parsed_input(value: _VerificationInput) -> ParsedInput:
    return ParsedInput(value, _PARSED_INPUT_TOKEN)


def _unwrap_parsed_input(value: ParsedInput) -> _VerificationInput:
    if not isinstance(value, ParsedInput):
        raise TypeError("verification input must be produced by parse_input")
    return value._unwrap()


def freeze_json(value: JsonValue) -> FrozenJson:
    if isinstance(value, dict):
        return MappingProxyType({key: freeze_json(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(freeze_json(item) for item in value)
    return value


def thaw_json(value: FrozenJson) -> JsonValue:
    if isinstance(value, Mapping):
        return {key: thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [thaw_json(item) for item in value]
    return value
