# Azure SRE Agent WorldCut tool

Azure SRE Agent custom Python tools accept a typed `main(...)` function and
must return JSON-serializable data. `worldcut_gate.py` follows that contract and
uses the stable `worldcut==1.0.0` PyPI package.

## Create the tool

In **Builder > Agent Canvas > Create > Tool > Python tool**, create:

- name: `worldcut_gate`
- inputs: `verification_input` (`str`) and `target_role` (`str`)
- pip dependency: `worldcut==1.0.0`
- code: paste `worldcut_gate.py`

Test with the contents of `../coherent-deployment.json` and target role `head`.
The result should have `allowed: true`, `contractVerdict:
CONTRACT_SATISFIED`, and `verifiedVersion: commit-B`.

The tool returns an exact version only when a satisfied required dependency
binds the requested `target_role`. A satisfied requirement about an unrelated
role cannot authorize the target.

Create a skill in **Builder > Skills**, attach the tool, and use `SKILL.md` as
the procedure. Start in Review mode and test it in the Agent Playground before
attaching scheduled or incident triggers.

## Enforcement boundary

Attaching a verification tool and a skill does not force the model to call it
before another write tool. Production enforcement therefore needs one of these
architectures:

1. the agent has no raw write tool and calls a compound effect endpoint that
   performs WorldCut verification internally; or
2. the target service requires the full verification record and exact resource
   versions before accepting an effect.

This example deliberately performs no Azure mutation and requires no
infrastructure changes.

## Local validation

```sh
python -m pip install --require-hashes -r requirements.txt
python -m unittest discover -v
```
