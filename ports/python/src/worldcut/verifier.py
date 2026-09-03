from __future__ import annotations

from typing import Literal, cast

from .canonicalization import sha256_digest, utf16_sort_key
from .errors import WorldCutInputError
from .models import (
    CommonValidTimeRequirement,
    ContractVerdict,
    DependencyRequirement,
    JsonValue,
    ParsedInput,
    RequirementResult,
    ValueEqualsRequirement,
    VerificationCoverage,
    VerificationResult,
    _unwrap_parsed_input,
    thaw_json,
)
from .planning import select_acquisition_plan
from .requirements import (
    evaluate_common_valid_time,
    evaluate_dependency,
    evaluate_value_equals,
)
from .validation import parse_input

ENGINE_VERSION = "0.1.2"
CANONICALIZATION: Literal["worldcut-json-v1"] = "worldcut-json-v1"


def verify(parsed_input: ParsedInput) -> VerificationResult:
    """Verify a parsed WorldCut input and return a fresh mutable result."""

    try:
        value = _unwrap_parsed_input(parsed_input)
    except TypeError as error:
        raise WorldCutInputError(str(error)) from error
    observations = {observation.role: observation for observation in value.observations}
    requirements = sorted(
        value.contract.requirements, key=lambda item: utf16_sort_key(item.id)
    )
    results: list[RequirementResult] = []
    for requirement in requirements:
        if isinstance(requirement, DependencyRequirement):
            results.append(evaluate_dependency(requirement, observations))
        elif isinstance(requirement, CommonValidTimeRequirement):
            results.append(evaluate_common_valid_time(requirement, observations))
        elif isinstance(requirement, ValueEqualsRequirement):
            results.append(evaluate_value_equals(requirement, observations))

    coverage: VerificationCoverage = {
        "required": 0,
        "satisfied": 0,
        "violated": 0,
        "unknown": 0,
        "advisory": 0,
    }
    for result in results:
        if not result["required"]:
            coverage["advisory"] += 1
            continue
        coverage["required"] += 1
        if result["status"] == "SATISFIED":
            coverage["satisfied"] += 1
        elif result["status"] == "VIOLATED":
            coverage["violated"] += 1
        else:
            coverage["unknown"] += 1

    verdict: ContractVerdict
    if coverage["violated"]:
        verdict = "CONTRACT_VIOLATED"
    elif coverage["unknown"]:
        verdict = "INSUFFICIENT_EVIDENCE"
    else:
        verdict = "CONTRACT_SATISFIED"
    plan = select_acquisition_plan(results)

    contract = cast(dict[str, JsonValue], thaw_json(value.contract.raw))
    contract["requirements"] = [
        thaw_json(requirement.raw) for requirement in requirements
    ]
    record: JsonValue = {
        "protocolVersion": value.protocol_version,
        "engineVersion": ENGINE_VERSION,
        "canonicalization": CANONICALIZATION,
        "contract": contract,
        "observations": [
            thaw_json(observation.raw)
            for observation in sorted(
                value.observations, key=lambda item: utf16_sort_key(item.role)
            )
        ],
        "verdict": verdict,
        "requirementResults": cast(list[JsonValue], results),
        "acquisitionPlan": cast(JsonValue, plan),
    }
    return {
        "protocolVersion": value.protocol_version,
        "engineVersion": ENGINE_VERSION,
        "canonicalization": CANONICALIZATION,
        "contractId": value.contract.id,
        "contractVersion": value.contract.version,
        "verdict": verdict,
        "coverage": coverage,
        "requirementResults": results,
        "acquisitionPlan": plan,
        "verificationRecordDigest": sha256_digest(record),
    }


def verify_json(source: str | bytes | bytearray) -> VerificationResult:
    """Parse and verify one WorldCut JSON document."""

    return verify(parse_input(source))
