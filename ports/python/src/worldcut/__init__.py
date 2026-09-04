"""Independent Python implementation of the WorldCut 0.1 verifier."""

from .canonicalization import canonical_json, sha256_digest
from .errors import WorldCutError, WorldCutErrorCode, WorldCutInputError
from .models import ParsedInput, VerificationResult
from .validation import PROTOCOL_VERSION, parse_input
from .verifier import (
    CANONICALIZATION,
    ENGINE_VERSION,
    verify,
    verify_json,
)

__all__ = [
    "CANONICALIZATION",
    "ENGINE_VERSION",
    "PROTOCOL_VERSION",
    "ParsedInput",
    "VerificationResult",
    "WorldCutError",
    "WorldCutErrorCode",
    "WorldCutInputError",
    "canonical_json",
    "parse_input",
    "sha256_digest",
    "verify",
    "verify_json",
]

__version__ = "0.1.1"
