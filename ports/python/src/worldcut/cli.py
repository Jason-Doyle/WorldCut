from __future__ import annotations

import json
import sys
from pathlib import Path

from .errors import WorldCutError
from .verifier import verify_json


def _usage() -> str:
    return "\n".join(
        [
            "Usage: worldcut-py [--require-satisfied] <verification.json>",
            "",
            "Options:",
            "  --require-satisfied  Exit with code 2 unless the contract is satisfied",
            "  --help               Show this help",
        ]
    )


def _write_error(code: str, message: str) -> None:
    print(
        json.dumps({"error": {"code": code, "message": message}}),
        file=sys.stderr,
    )


def run(arguments: list[str] | None = None) -> int:
    """Run the WorldCut CLI and return its process exit status."""

    arguments = list(sys.argv[1:] if arguments is None else arguments)
    if "--help" in arguments:
        print(_usage())
        return 0
    require_satisfied = False
    positional: list[str] = []
    for argument in arguments:
        if argument == "--require-satisfied":
            require_satisfied = True
        elif argument.startswith("-"):
            _write_error("WORLDCUT_INVALID_ARGUMENT", f"Unknown option: {argument}")
            return 1
        else:
            positional.append(argument)
    if len(positional) != 1:
        _write_error(
            "WORLDCUT_INVALID_ARGUMENT",
            "Exactly one verification JSON file is required",
        )
        return 1
    path = Path(positional[0]).resolve()
    try:
        source = path.read_bytes()
    except OSError:
        _write_error("WORLDCUT_FILE_READ_FAILED", f"Unable to read {path}")
        return 1
    try:
        result = verify_json(source)
    except WorldCutError as error:
        _write_error(error.code, str(error))
        return 1
    print(json.dumps(result, indent=2))
    if require_satisfied and result["verdict"] != "CONTRACT_SATISFIED":
        return 2
    return 0


def main() -> None:
    """Console-script entry point."""

    raise SystemExit(run())


if __name__ == "__main__":
    main()
