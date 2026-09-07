from __future__ import annotations

import json
from typing import Any

from worldcut import VerificationResult, WorldCutError, verify_json


def main(verification_input: str, target_role: str) -> dict[str, Any]:
    """Verify one WorldCut decision input for an Azure SRE Agent workflow."""

    if not isinstance(verification_input, str):
        return _denied(
            target_role if isinstance(target_role, str) else "",
            "WORLDCUT_INVALID_ARGUMENT",
            "verification_input must be a string",
        )
    if not isinstance(target_role, str) or not target_role:
        return _denied(
            "",
            "WORLDCUT_INVALID_ARGUMENT",
            "target_role must be a non-empty string",
        )

    try:
        source = verification_input.encode("utf-8")
        result = verify_json(source)
        document = json.loads(verification_input)
    except WorldCutError as error:
        return _denied(target_role, error.code, str(error))
    except (UnicodeError, json.JSONDecodeError) as error:
        return _denied(target_role, "WORLDCUT_INVALID_INPUT", str(error))

    allowed = result["verdict"] == "CONTRACT_SATISFIED"
    versions: dict[str, str] = {
        observation["role"]: observation["witness"]["version"]
        for observation in document["observations"]
        if "version" in observation["witness"]
    }
    target_version = versions.get(target_role)
    if allowed and not _target_role_is_bound(document, result, target_role):
        return _denied(
            target_role,
            "WORLDCUT_TARGET_ROLE_UNBOUND",
            f"no satisfied required dependency binds target role {target_role}",
            result,
        )
    if allowed and target_version is None:
        return _denied(
            target_role,
            "WORLDCUT_REQUIRED_VERSION_MISSING",
            f"the satisfied contract has no exact version for role {target_role}",
            result,
        )

    return {
        "allowed": allowed,
        "contractVerdict": result["verdict"],
        "verificationRecordDigest": result["verificationRecordDigest"],
        "targetRole": target_role,
        "verifiedVersion": target_version if allowed else None,
        "result": result,
    }


def _target_role_is_bound(
    document: dict[str, Any],
    result: VerificationResult,
    target_role: str,
) -> bool:
    statuses = {item["requirementId"]: item for item in result["requirementResults"]}
    for requirement in document["contract"]["requirements"]:
        if (
            requirement["type"] == "dependency"
            and requirement.get("required", True)
            and requirement["targetRole"] == target_role
        ):
            outcome = statuses.get(requirement["id"])
            if (
                outcome is not None
                and outcome["required"] is True
                and outcome["status"] == "SATISFIED"
            ):
                return True
    return False


def _denied(
    target_role: str,
    code: str,
    message: str,
    result: VerificationResult | None = None,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "allowed": False,
        "targetRole": target_role,
        "verifiedVersion": None,
        "error": {"code": code, "message": message},
    }
    if result is not None:
        response["contractVerdict"] = result["verdict"]
        response["verificationRecordDigest"] = result["verificationRecordDigest"]
        response["result"] = result
    return response
