# WorldCut Go

Independent Go implementation of WorldCut protocol **0.1** and engine ruleset
**0.1.2**. It implements `worldcut-json-v1`, the complete verifier, exact
acquisition planning, and verification-record digests without invoking Node.js
or using generated TypeScript output.

The module requires Go 1.23 or newer.

## Install

```sh
go get github.com/Jason-Doyle/WorldCut/ports/go
go install github.com/Jason-Doyle/WorldCut/ports/go/cmd/worldcut-go@latest
```

From a repository checkout:

```sh
cd ports/go
go build ./cmd/worldcut-go
```

## Library use

```go
source, err := os.ReadFile("verification.json")
if err != nil {
	log.Fatal(err)
}

result, err := worldcut.VerifyJSON(source)
if err != nil {
	log.Fatal(err)
}

fmt.Println(result.Verdict)
fmt.Println(result.VerificationRecordDigest)
```

Import the module as:

```go
import worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
```

## CLI

The CLI reads one verification input and prints the complete verification
result as JSON:

```sh
worldcut-go verification.json
```

For decision gates, exit with status 2 unless the verdict is
`CONTRACT_SATISFIED`:

```sh
worldcut-go --require-satisfied verification.json
```

Invalid JSON and invalid protocol input produce a JSON error with code
`WORLDCUT_INVALID_INPUT` on stderr and exit status 1.

## Validate

Run from `ports/go`:

```sh
gofmt -w .
go test ./...
go test -race ./...
go vet ./...
```

The tests consume every shared vector under `conformance/0.1`, including raw
Unicode rejection and exact canonical bytes and digests. This port currently
contains no cloud adapters, GitHub integration, or Agentic Data Kernel
integration.
