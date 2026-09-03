from __future__ import annotations

import json
import math
from contextlib import suppress
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from worldcut import WorldCutError, canonical_json, sha256_digest, verify_json

json_scalars = (
    st.none()
    | st.booleans()
    | st.text()
    | st.integers(min_value=-(2**53) + 1, max_value=2**53 - 1)
    | st.floats(allow_nan=False, allow_infinity=False)
)
json_values = st.recursive(
    json_scalars,
    lambda children: (
        st.lists(children, max_size=6)
        | st.dictionaries(st.text(), children, max_size=6)
    ),
    max_leaves=25,
)


@given(json_values)
@settings(max_examples=250)
def test_canonicalization_is_deterministic(value: Any) -> None:
    try:
        first = canonical_json(value)
    except TypeError:
        return
    assert first == canonical_json(value)
    assert len(sha256_digest(value)) == 64


@given(st.binary(max_size=1024))
@settings(max_examples=500)
def test_arbitrary_transport_bytes_never_escape_as_unstructured_errors(
    source: bytes,
) -> None:
    with suppress(WorldCutError):
        verify_json(source)


def test_excessive_json_nesting_is_a_structured_input_error() -> None:
    source = "[" * 2000 + "0" + "]" * 2000
    try:
        verify_json(source)
    except WorldCutError:
        return
    raise AssertionError("excessively nested JSON unexpectedly verified")


@given(st.text(max_size=512))
@settings(max_examples=300)
def test_json_values_without_protocol_shape_are_rejected(source: str) -> None:
    try:
        parsed: Any = json.loads(source)
    except (json.JSONDecodeError, ValueError):
        return
    if (
        isinstance(parsed, dict)
        and parsed.get("protocolVersion") == "0.1"
        and "contract" in parsed
        and "observations" in parsed
    ):
        return
    try:
        verify_json(source)
    except WorldCutError:
        return
    raise AssertionError("non-protocol JSON unexpectedly verified")


@given(st.floats(allow_nan=True, allow_infinity=True))
def test_non_finite_values_are_not_canonicalizable(value: float) -> None:
    if math.isfinite(value):
        canonical_json(value)
    else:
        try:
            canonical_json(value)
        except TypeError:
            return
        raise AssertionError("non-finite value unexpectedly canonicalized")
