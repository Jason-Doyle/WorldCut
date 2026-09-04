from __future__ import annotations

from importlib.resources import files

import pytest

import worldcut
from worldcut import ParsedInput
from worldcut.cli import run


def test_type_marker_is_installed() -> None:
    assert files("worldcut").joinpath("py.typed").is_file()


def test_parsed_input_cannot_be_constructed_or_mutated() -> None:
    with pytest.raises(TypeError):
        ParsedInput(object(), object())  # type: ignore[arg-type]


def test_cli_help(capsys: pytest.CaptureFixture[str]) -> None:
    assert run(["--help"]) == 0
    assert "worldcut-py" in capsys.readouterr().out


def test_public_versions() -> None:
    assert worldcut.__version__ == "0.1.1"
    assert worldcut.PROTOCOL_VERSION == "0.1"
    assert worldcut.ENGINE_VERSION == "0.1.2"
    assert worldcut.CANONICALIZATION == "worldcut-json-v1"
