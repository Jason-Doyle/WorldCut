from __future__ import annotations

from typing import Literal, TypeAlias

WorldCutErrorCode: TypeAlias = Literal[
    "WORLDCUT_INVALID_INPUT",
    "WORLDCUT_INVALID_ARGUMENT",
    "WORLDCUT_FILE_READ_FAILED",
    "WORLDCUT_RUNTIME_ERROR",
]


class WorldCutError(Exception):
    """Base exception carrying a stable WorldCut error code."""

    code: WorldCutErrorCode

    def __init__(self, code: WorldCutErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


class WorldCutInputError(WorldCutError):
    """Raised when transport data violates the WorldCut protocol."""

    def __init__(self, message: str) -> None:
        super().__init__("WORLDCUT_INVALID_INPUT", message)
