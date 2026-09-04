package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const currentSHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

type gate struct {
	conclusion string
	headSHA    string
	empty      bool
	status     int
	requests   []*http.Request
}

func (g *gate) server(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		g.requests = append(g.requests, request)
		if g.status != 0 {
			writer.WriteHeader(g.status)
			_, _ = writer.Write([]byte("failure"))
			return
		}
		conclusion := g.conclusion
		if conclusion == "" {
			conclusion = "success"
		}
		headSHA := g.headSHA
		if headSHA == "" {
			headSHA = currentSHA
		}
		var payload any
		switch {
		case strings.Contains(request.URL.Path, "/actions/workflows/"):
			branch := request.URL.Query().Get("branch")
			runs := []any{}
			if !g.empty {
				runs = append(runs, map[string]any{
					"id":              81,
					"workflow_id":     42,
					"head_sha":        headSHA,
					"head_branch":     branch,
					"event":           "push",
					"status":          "completed",
					"conclusion":      conclusion,
					"html_url":        "https://github.com/acme/service/actions/runs/81",
					"head_repository": map[string]any{"full_name": "acme/service"},
				})
			}
			payload = map[string]any{"workflow_runs": runs}
		case strings.Contains(request.URL.Path, "/branches/"):
			payload = map[string]any{"commit": map[string]any{"sha": currentSHA}}
		default:
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Error(err)
			return
		}
		_, _ = writer.Write(encoded)
	}))
	t.Cleanup(server.Close)
	return server
}

func execute(t *testing.T, arguments []string, environment map[string]string, baseURL string) (int, string, string) {
	t.Helper()
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	code := run(context.Background(), arguments, dependencies{
		getenv:     func(name string) string { return environment[name] },
		stdout:     stdout,
		stderr:     stderr,
		apiBaseURL: baseURL,
	})
	return code, stdout.String(), stderr.String()
}

func TestCLIReportsSatisfiedGate(t *testing.T) {
	state := &gate{}
	server := state.server(t)
	code, stdout, stderr := execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml"},
		nil,
		server.URL,
	)
	if code != 0 {
		t.Fatalf("exit code = %d (%s)", code, stderr)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["verdict"] != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %v", payload["verdict"])
	}
	if payload["verifiedSha"] != currentSHA {
		t.Fatalf("verifiedSha = %v", payload["verifiedSha"])
	}
	if payload["branch"] != "main" {
		t.Fatalf("branch = %v", payload["branch"])
	}
	if _, present := payload["input"]; present {
		t.Fatal("the summary output must not include the verification input")
	}
	requirements, ok := payload["requirements"].([]any)
	if !ok || len(requirements) != 2 {
		t.Fatalf("requirements = %#v", payload["requirements"])
	}
	if payload["verificationRecordDigest"] == "" {
		t.Fatal("the summary must include the verification record digest")
	}
}

func TestCLIFullOutputIncludesInputAndResult(t *testing.T) {
	state := &gate{}
	code, stdout, stderr := execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml", "--full"},
		nil,
		state.server(t).URL,
	)
	if code != 0 {
		t.Fatalf("exit code = %d (%s)", code, stderr)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
		t.Fatal(err)
	}
	input, ok := payload["input"].(map[string]any)
	if !ok || input["protocolVersion"] != "0.1" {
		t.Fatalf("input = %#v", payload["input"])
	}
	result, ok := payload["result"].(map[string]any)
	if !ok || result["verdict"] != "CONTRACT_SATISFIED" {
		t.Fatalf("result = %#v", payload["result"])
	}
}

func TestCLIExitsWithTwoUnlessSatisfied(t *testing.T) {
	for name, state := range map[string]*gate{
		"failed run":        {conclusion: "failure"},
		"stale head":        {headSHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		"no completed run":  {empty: true},
		"failure and stale": {conclusion: "failure", headSHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
	} {
		t.Run(name, func(t *testing.T) {
			code, stdout, _ := execute(
				t,
				[]string{"--repository", "acme/service", "--workflow", "ci.yml"},
				nil,
				state.server(t).URL,
			)
			if code != 2 {
				t.Fatalf("exit code = %d", code)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["verifiedSha"] != nil {
				t.Fatalf("verifiedSha = %v", payload["verifiedSha"])
			}
		})
	}
}

func TestCLIWritesGitHubOutputOnlyWhenVerified(t *testing.T) {
	outputPath := filepath.Join(t.TempDir(), "github-output")
	state := &gate{}
	code, _, stderr := execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml"},
		map[string]string{"GITHUB_OUTPUT": outputPath},
		state.server(t).URL,
	)
	if code != 0 {
		t.Fatalf("exit code = %d (%s)", code, stderr)
	}
	contents, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	expected := "verified_sha=" + currentSHA + "\nworkflow_run_id=81\n"
	if string(contents) != expected {
		t.Fatalf("GITHUB_OUTPUT = %q", string(contents))
	}

	failedPath := filepath.Join(t.TempDir(), "github-output")
	failed := &gate{conclusion: "failure"}
	code, _, _ = execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml"},
		map[string]string{"GITHUB_OUTPUT": failedPath},
		failed.server(t).URL,
	)
	if code != 2 {
		t.Fatalf("exit code = %d", code)
	}
	if _, err := os.Stat(failedPath); !os.IsNotExist(err) {
		t.Fatalf("a violated gate wrote GITHUB_OUTPUT: %v", err)
	}
}

func TestCLIReportsErrorsAsStableJSON(t *testing.T) {
	cases := map[string]struct {
		arguments   []string
		state       *gate
		expectedKey string
	}{
		"missing required flags": {
			arguments:   []string{"--repository", "acme/service"},
			state:       &gate{},
			expectedKey: "WORLDCUT_INVALID_ARGUMENT",
		},
		"unknown flag": {
			arguments:   []string{"--repository", "acme/service", "--workflow", "ci.yml", "--nope"},
			state:       &gate{},
			expectedKey: "WORLDCUT_INVALID_ARGUMENT",
		},
		"positional argument": {
			arguments:   []string{"--repository", "acme/service", "--workflow", "ci.yml", "extra"},
			state:       &gate{},
			expectedKey: "WORLDCUT_INVALID_ARGUMENT",
		},
		"invalid repository": {
			arguments:   []string{"--repository", "acme", "--workflow", "ci.yml"},
			state:       &gate{},
			expectedKey: "WORLDCUT_GITHUB_RESPONSE_INVALID",
		},
		"api failure": {
			arguments:   []string{"--repository", "acme/service", "--workflow", "ci.yml"},
			state:       &gate{status: http.StatusForbidden},
			expectedKey: "WORLDCUT_GITHUB_API_ERROR",
		},
	}
	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			code, stdout, stderr := execute(
				t,
				testCase.arguments,
				nil,
				testCase.state.server(t).URL,
			)
			if code != 1 {
				t.Fatalf("exit code = %d", code)
			}
			if stdout != "" {
				t.Fatalf("stdout = %q", stdout)
			}
			var envelope struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal([]byte(stderr), &envelope); err != nil {
				t.Fatalf("stderr is not a JSON envelope: %q", stderr)
			}
			if envelope.Error.Code != testCase.expectedKey {
				t.Fatalf("error code = %s (%s)", envelope.Error.Code, envelope.Error.Message)
			}
			if envelope.Error.Message == "" {
				t.Fatal("the error envelope has no message")
			}
		})
	}
}

func TestCLIHelpExitsZero(t *testing.T) {
	for _, argument := range []string{"--help", "-h"} {
		code, stdout, stderr := execute(t, []string{argument}, nil, "")
		if code != 0 {
			t.Fatalf("%s exit code = %d (%s)", argument, code, stderr)
		}
		if !strings.Contains(stdout, "Usage: worldcut-github-ci-go") {
			t.Fatalf("%s output = %q", argument, stdout)
		}
	}
}

func TestCLIResolvesTokenEnvironment(t *testing.T) {
	state := &gate{}
	server := state.server(t)
	execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml", "--token-env", "CUSTOM_TOKEN"},
		map[string]string{"CUSTOM_TOKEN": "custom", "GITHUB_TOKEN": "default"},
		server.URL,
	)
	if authorization := state.requests[0].Header.Get("Authorization"); authorization != "Bearer custom" {
		t.Fatalf("Authorization = %q", authorization)
	}

	fallback := &gate{}
	fallbackServer := fallback.server(t)
	execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml"},
		map[string]string{"GH_TOKEN": "gh"},
		fallbackServer.URL,
	)
	if authorization := fallback.requests[0].Header.Get("Authorization"); authorization != "Bearer gh" {
		t.Fatalf("Authorization = %q", authorization)
	}

	anonymous := &gate{}
	anonymousServer := anonymous.server(t)
	execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml"},
		nil,
		anonymousServer.URL,
	)
	if authorization := anonymous.requests[0].Header.Get("Authorization"); authorization != "" {
		t.Fatalf("Authorization = %q", authorization)
	}
}

func TestCLIAcceptsCamelCaseTokenEnvironmentAlias(t *testing.T) {
	state := &gate{}
	server := state.server(t)
	code, _, stderr := execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml", "--tokenEnv", "CUSTOM_TOKEN"},
		map[string]string{"CUSTOM_TOKEN": "custom"},
		server.URL,
	)
	if code != 0 {
		t.Fatalf("exit code = %d (%s)", code, stderr)
	}
	if authorization := state.requests[0].Header.Get("Authorization"); authorization != "Bearer custom" {
		t.Fatalf("Authorization = %q", authorization)
	}
}

func TestCLIUsesExplicitBranch(t *testing.T) {
	state := &gate{}
	server := state.server(t)
	code, _, _ := execute(
		t,
		[]string{"--repository", "acme/service", "--workflow", "ci.yml", "--branch", "release"},
		nil,
		server.URL,
	)
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if !strings.Contains(state.requests[0].URL.RawQuery, "branch=release") {
		t.Fatalf("query = %s", state.requests[0].URL.RawQuery)
	}
}
