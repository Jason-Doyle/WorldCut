package main

import (
	"encoding/json"
	"fmt"
	"os"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
)

func writeError(code, message string) {
	encoded, err := json.Marshal(map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, `{"error":{"code":"WORLDCUT_RUNTIME_ERROR","message":"unable to encode error"}}`)
		return
	}
	fmt.Fprintln(os.Stderr, string(encoded))
}

func run() int {
	requireSatisfied := false
	positional := []string{}
	for _, argument := range os.Args[1:] {
		switch {
		case argument == "--require-satisfied":
			requireSatisfied = true
		case len(argument) > 0 && argument[0] == '-':
			writeError("WORLDCUT_INVALID_ARGUMENT", "unknown option: "+argument)
			return 1
		default:
			positional = append(positional, argument)
		}
	}
	if len(positional) != 1 {
		writeError("WORLDCUT_INVALID_ARGUMENT", "exactly one verification JSON file is required")
		return 1
	}
	source, err := os.ReadFile(positional[0])
	if err != nil {
		writeError("WORLDCUT_FILE_READ_FAILED", err.Error())
		return 1
	}
	result, err := worldcut.VerifyJSON(source)
	if err != nil {
		code := worldcut.ErrorCode(err)
		if code == "" {
			code = "WORLDCUT_RUNTIME_ERROR"
		}
		writeError(code, err.Error())
		return 1
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(result); err != nil {
		writeError("WORLDCUT_RUNTIME_ERROR", err.Error())
		return 1
	}
	if requireSatisfied && result.Verdict != "CONTRACT_SATISFIED" {
		return 2
	}
	return 0
}

func main() {
	os.Exit(run())
}
