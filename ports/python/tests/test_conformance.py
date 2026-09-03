from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from worldcut import (
    WorldCutError,
    canonical_json,
    parse_input,
    sha256_digest,
    verify,
    verify_json,
)

DATA = Path(__file__).parent / "data" / "conformance" / "0.1"


def _vectors(name: str) -> dict[str, Any]:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    "case",
    _vectors("verification-vectors.json")["cases"],
    ids=lambda case: str(case["name"]),
)
def test_verification_vectors(case: dict[str, Any]) -> None:
    source = json.dumps(
        case["input"], ensure_ascii=False, separators=(",", ":")
    ).encode()
    assert verify_json(source) == case["expected"]


@pytest.mark.parametrize(
    "case",
    _vectors("invalid-vectors.json")["cases"],
    ids=lambda case: str(case["name"]),
)
def test_invalid_vectors(case: dict[str, Any]) -> None:
    source = json.dumps(
        case["input"], ensure_ascii=False, separators=(",", ":")
    ).encode()
    with pytest.raises(WorldCutError) as caught:
        verify_json(source)
    assert caught.value.code == case["expectedErrorCode"]


@pytest.mark.parametrize(
    "case",
    _vectors("canonicalization-vectors.json")["cases"],
    ids=lambda case: str(case["name"]),
)
def test_canonicalization_vectors(case: dict[str, Any]) -> None:
    assert canonical_json(case["value"]) == case["expectedCanonicalJson"]
    assert sha256_digest(case["value"]) == case["expectedSha256"]


@pytest.mark.parametrize(
    "case",
    _vectors("raw-vectors.json")["cases"],
    ids=lambda case: str(case["name"]),
)
def test_raw_vectors(case: dict[str, Any]) -> None:
    source = (DATA / Path(case["file"])).read_bytes()
    with pytest.raises(WorldCutError) as caught:
        verify_json(source)
    assert caught.value.code in case["acceptedOutcomes"]


def test_manifest_hashes_and_counts() -> None:
    manifest = _vectors("manifest.json")
    for name, metadata in manifest["files"].items():
        source = (DATA / Path(name)).read_bytes()
        assert hashlib.sha256(source).hexdigest() == metadata["sha256"]
        if "cases" in metadata:
            assert len(_vectors(name)["cases"]) == metadata["cases"]
        if "bytes" in metadata:
            assert len(source) == metadata["bytes"]


def test_result_mutation_cannot_affect_later_verification() -> None:
    case = _vectors("verification-vectors.json")["cases"][0]
    parsed = parse_input(json.dumps(case["input"]).encode())
    first = verify(parsed)
    first["requirementResults"][0]["details"] = {"mutated": True}
    first["acquisitionPlan"]["actions"].append(
        {
            "id": "mutated",
            "type": "REFRESH_OBSERVATION",
            "role": "mutated",
            "cost": 1,
            "description": "mutated",
            "expected": None,
        }
    )
    second = verify(parsed)
    assert second == case["expected"]


def test_normalized_year_zero_timestamps_match_reference_domain() -> None:
    case = _vectors("verification-vectors.json")["cases"][0]
    source = json.dumps(case["input"]).replace("2026-", "0000-")
    assert verify_json(source)["verdict"] == "CONTRACT_SATISFIED"
