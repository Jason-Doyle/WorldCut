from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from typing import Any

import pytest

from worldcut.cli import run

DATA = Path(__file__).parent / "data" / "conformance" / "0.1"


def _case_with_verdict(verdict: str) -> dict[str, Any]:
    vectors = json.loads(
        (DATA / "verification-vectors.json").read_text(encoding="utf-8")
    )
    return next(
        case for case in vectors["cases"] if case["expected"]["verdict"] == verdict
    )


def _write_case(tmp_path: Path, verdict: str) -> tuple[Path, dict[str, Any]]:
    case = _case_with_verdict(verdict)
    path = tmp_path / f"{verdict.lower()}.json"
    path.write_text(json.dumps(case["input"]), encoding="utf-8")
    return path, case["expected"]


def test_cli_prints_the_complete_verification_result(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path, expected = _write_case(tmp_path, "CONTRACT_SATISFIED")

    assert run([str(path)]) == 0
    assert json.loads(capsys.readouterr().out) == expected


def test_cli_can_require_a_satisfied_contract(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path, expected = _write_case(tmp_path, "CONTRACT_VIOLATED")

    assert run(["--require-satisfied", str(path)]) == 2
    assert json.loads(capsys.readouterr().out) == expected


def test_cli_escapes_unicode_for_legacy_console_encodings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _case_with_verdict("CONTRACT_SATISFIED")
    case["input"]["contract"]["requirements"][0]["id"] = "requirement-\U0001f40d"
    path = tmp_path / "unicode.json"
    path.write_text(json.dumps(case["input"]), encoding="utf-8")
    output = io.BytesIO()
    stream = io.TextIOWrapper(output, encoding="ascii")
    monkeypatch.setattr(sys, "stdout", stream)

    assert run([str(path)]) == 0
    stream.flush()
    result = json.loads(output.getvalue().decode("ascii"))
    requirement_ids = {item["requirementId"] for item in result["requirementResults"]}
    assert "requirement-\U0001f40d" in requirement_ids


@pytest.mark.parametrize("arguments", [[], ["--unknown"]])
def test_cli_rejects_invalid_arguments(
    arguments: list[str], capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(arguments) == 1
    error = json.loads(capsys.readouterr().err)
    assert error["error"]["code"] == "WORLDCUT_INVALID_ARGUMENT"


def test_cli_reports_file_read_failures(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run([str(tmp_path / "missing.json")]) == 1
    error = json.loads(capsys.readouterr().err)
    assert error["error"]["code"] == "WORLDCUT_FILE_READ_FAILED"


def test_cli_reports_invalid_protocol_input(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "invalid.json"
    path.write_bytes(b"not json")

    assert run([str(path)]) == 1
    error = json.loads(capsys.readouterr().err)
    assert error["error"]["code"] == "WORLDCUT_INVALID_INPUT"
