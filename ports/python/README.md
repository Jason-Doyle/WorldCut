# WorldCut Python

Independent Python implementation of WorldCut protocol **0.1**, engine
**0.1.2**, and canonicalization **worldcut-json-v1**. Python 3.11 or newer is
required.

## Install

Install from PyPI:

```sh
python -m pip install worldcut==0.1.1
```

When a source install is preferred, use the protected tag:

```sh
python -m pip install "worldcut @ git+https://github.com/Jason-Doyle/WorldCut.git@ports/python/v0.1.1#subdirectory=ports/python"
```

## Library

```python
from pathlib import Path

from worldcut import parse_input, verify

parsed = parse_input(Path("verification.json").read_bytes())
result = verify(parsed)
print(result["verdict"])
print(result["verificationRecordDigest"])
```

`ParsedInput` is an immutable validated snapshot. Every verification returns a
fresh result, so mutating one result cannot affect later verification.

## CLI

```sh
worldcut-py verification.json
worldcut-py --require-satisfied verification.json
```

The second form exits with status 2 unless the verdict is
`CONTRACT_SATISFIED`.

## Validate

```sh
python -m pip install -e ".[dev]"
ruff format --check .
ruff check .
mypy src
pytest
python -m build
twine check dist/*
```

The source distribution includes the complete mirrored conformance corpus and
can run its tests without files from the parent repository. This port includes
the verifier and CLI only; integrations are intentionally not included yet.
