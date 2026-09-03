from __future__ import annotations

import hashlib
import math

import rfc8785

from .models import JsonValue

_MAX_SAFE_INTEGER = 9_007_199_254_740_991


def _assert_valid_unicode(value: str, field: str) -> None:
    for character in value:
        code_point = ord(character)
        if 0xD800 <= code_point <= 0xDFFF:
            raise TypeError(f"{field} contains an unpaired surrogate")


def _snapshot_json(value: object, field: str, ancestors: set[int]) -> JsonValue:
    if value is None or isinstance(value, (str, bool)):
        if isinstance(value, str):
            _assert_valid_unicode(value, field)
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > _MAX_SAFE_INTEGER:
            raise TypeError(f"{field} contains an integer outside the safe domain")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise TypeError(f"{field} contains a non-finite number")
        return value
    if type(value) is list:
        identity = id(value)
        if identity in ancestors:
            raise TypeError(f"{field} must not contain cycles")
        ancestors.add(identity)
        array_result = [
            _snapshot_json(item, f"{field}[{index}]", ancestors)
            for index, item in enumerate(value)
        ]
        ancestors.remove(identity)
        return array_result
    if type(value) is dict:
        identity = id(value)
        if identity in ancestors:
            raise TypeError(f"{field} must not contain cycles")
        ancestors.add(identity)
        object_result: dict[str, JsonValue] = {}
        for raw_key, item in value.items():
            if not isinstance(raw_key, str):
                raise TypeError(f"{field} must use string object keys")
            _assert_valid_unicode(raw_key, f"{field} key")
            object_result[raw_key] = _snapshot_json(
                item, f"{field}.{raw_key}", ancestors
            )
        ancestors.remove(identity)
        return object_result
    raise TypeError(f"{field} contains unsupported {type(value).__name__} data")


def canonical_json(value: JsonValue) -> str:
    """Return the worldcut-json-v1 canonical representation of JSON data."""

    snapshot = _snapshot_json(value, "value", set())
    try:
        return rfc8785.dumps(snapshot).decode("utf-8")
    except (rfc8785.CanonicalizationError, UnicodeError) as error:
        raise TypeError(f"cannot canonicalize JSON data: {error}") from error


def sha256_digest(value: JsonValue) -> str:
    """Return the lowercase SHA-256 digest of canonical JSON data."""

    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def utf16_sort_key(value: str) -> bytes:
    """Produce the protocol's raw UTF-16 code-unit ordering key."""

    _assert_valid_unicode(value, "text")
    return value.encode("utf-16-be")
