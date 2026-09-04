# WorldCut.Tool

The `worldcut-dotnet` command-line verifier for the **WorldCut**
decision-coherence protocol `0.1` and engine ruleset `0.1.2`.

It reads one verification input file and prints the complete verification
result as JSON, with stable exit codes suitable for deployment gates.

Targets **.NET 8** and **.NET 10**.

## Install

```sh
dotnet tool install --global WorldCut.Tool
```

## Use

```sh
worldcut-dotnet verification.json
worldcut-dotnet --require-satisfied verification.json
worldcut-dotnet --help
```

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | The input was verified; or `--help` was requested; or `--require-satisfied` received a satisfied contract |
| `1` | Argument, file, input, or runtime failure |
| `2` | `--require-satisfied` received a non-satisfied verdict |

Failures are written to standard error as a stable JSON envelope:

```json
{"error":{"code":"WORLDCUT_INVALID_INPUT","message":"..."}}
```

The error codes are `WORLDCUT_INVALID_ARGUMENT`, `WORLDCUT_FILE_READ_FAILED`,
`WORLDCUT_INVALID_INPUT`, and `WORLDCUT_RUNTIME_ERROR`.

## Library

The verifier itself is published as the dependency-free
[`WorldCut`](https://www.nuget.org/packages/WorldCut) package.

## More

* Protocol specifications:
  <https://github.com/Jason-Doyle/WorldCut/tree/main/spec/0.1>
* Port documentation:
  <https://github.com/Jason-Doyle/WorldCut/tree/main/ports/dotnet>
* Third-party notices: `THIRD-PARTY-NOTICES.md` in this package.

Licensed under the Apache License 2.0.
