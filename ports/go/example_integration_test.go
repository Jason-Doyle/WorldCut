package worldcut_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	"github.com/Jason-Doyle/WorldCut/ports/go/adapters"
	adk "github.com/Jason-Doyle/WorldCut/ports/go/integrations/agenticdatakernel"
	"github.com/Jason-Doyle/WorldCut/ports/go/integrations/githubactions"
)

const releaseSHA = "cccccccccccccccccccccccccccccccccccccccc"

// Example_captureAndVerify captures provider metadata with the bundled
// adapters and verifies a decision contract built from the captured
// observations, without assembling protocol JSON by hand.
func Example_captureAndVerify() {
	decisionTime := time.Date(2026, 9, 4, 18, 0, 0, 0, time.UTC)
	clock := func() time.Time { return decisionTime }

	deployment, err := adapters.CaptureKubernetesObservation(adapters.KubernetesObservationOptions{
		Cluster: "eu-west",
		Account: "acme",
		Role:    "deployment",
		Object: adapters.KubernetesObject{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
			Metadata: adapters.KubernetesObjectMetadata{
				Name:            "payments",
				Namespace:       "production",
				ResourceVersion: "9812",
			},
		},
		Value: map[string]any{
			"image": "registry.example/payments@sha256:" + releaseSHA,
		},
		Clock: clock,
	})
	if err != nil {
		fmt.Println("capture failed:", err)
		return
	}

	release, err := adk.ObservationFromResolution(adk.Resolution{
		Status:   "known",
		ValidAt:  "2026-09-04T18:00:00.000Z",
		SystemAt: "2026-09-04T18:00:00.000Z",
		Selected: &adk.Assertion{
			TenantID:    "acme",
			AssertionID: "release-2041",
			Object: map[string]any{
				"image": "registry.example/payments@sha256:" + releaseSHA,
			},
			ValidFrom:  "2026-09-04T17:00:00.000Z",
			SystemFrom: "2026-09-04T17:30:00.000Z",
			Status:     "active",
			Basis: map[string]any{
				"worldcut": map[string]any{
					"protocolVersion": "0.1",
					"role":            "release",
					"resource": map[string]any{
						"provider": "agentic-data-kernel",
						"account":  "acme",
						"kind":     "release",
						"key":      "payments/2041",
					},
					"provenance": "provider_asserted",
					"version":    "2041",
				},
			},
		},
	}, adk.Options{})
	if err != nil {
		fmt.Println("adapt failed:", err)
		return
	}

	result, err := worldcut.VerifyDecisionContract(worldcut.VerificationInput{
		Contract: worldcut.Contract{
			ID:           "deploy-approved-release",
			Version:      "1",
			DecisionTime: worldcut.FormatTimestamp(decisionTime),
			Requirements: []worldcut.Requirement{
				worldcut.NewValueEqualsRequirement(
					"deployment-runs-approved-image",
					"The running deployment uses the approved release image",
					"deployment",
					[]string{"image"},
					"registry.example/payments@sha256:"+releaseSHA,
				),
				worldcut.NewValueEqualsRequirement(
					"release-is-approved-image",
					"The kernel selected the approved release image",
					"release",
					[]string{"image"},
					"registry.example/payments@sha256:"+releaseSHA,
				),
			},
		},
		Observations: []worldcut.Observation{deployment, release},
	})
	if err != nil {
		fmt.Println("verification failed:", err)
		return
	}

	fmt.Println(result.Verdict)
	fmt.Println(result.Coverage.Required, result.Coverage.Satisfied)
	// Output:
	// CONTRACT_SATISFIED
	// 2 2
}

// Example_gitHubDeploymentGate verifies that the latest completed push run of
// one workflow tested the current branch head and returns the immutable SHA
// that deployment code must consume.
func Example_gitHubDeploymentGate() {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload any
		if strings.Contains(request.URL.Path, "/actions/workflows/") {
			payload = map[string]any{"workflow_runs": []any{map[string]any{
				"id":              2041,
				"workflow_id":     42,
				"head_sha":        releaseSHA,
				"head_branch":     "main",
				"event":           "push",
				"status":          "completed",
				"conclusion":      "success",
				"html_url":        "https://github.com/acme/payments/actions/runs/2041",
				"head_repository": map[string]any{"full_name": "acme/payments"},
			}}}
		} else {
			payload = map[string]any{"commit": map[string]any{"sha": releaseSHA}}
		}
		encoded, _ := json.Marshal(payload)
		_, _ = writer.Write(encoded)
	}))
	defer server.Close()

	verification, err := githubactions.VerifyLatestWorkflow(context.Background(), githubactions.Options{
		Repository: "acme/payments",
		Branch:     "main",
		Workflow:   "ci.yml",
		APIBaseURL: server.URL,
	})
	if err != nil {
		fmt.Println("gate failed:", err)
		return
	}
	fmt.Println(verification.Result.Verdict)
	if verification.VerifiedSHA != nil {
		fmt.Println("deploy", *verification.VerifiedSHA)
	}
	// Output:
	// CONTRACT_SATISFIED
	// deploy cccccccccccccccccccccccccccccccccccccccc
}

// TestCapturedObservationsShareNoStateWithCallers proves that observations
// returned by the integrations can be combined and reverified without the
// caller's original data influencing the outcome.
func TestCapturedObservationsShareNoStateWithCallers(t *testing.T) {
	custom := map[string]any{"image": "registry.example/payments:1"}
	observation, err := adapters.CaptureKubernetesObservation(adapters.KubernetesObservationOptions{
		Cluster: "eu-west",
		Account: "acme",
		Role:    "deployment",
		Object: adapters.KubernetesObject{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
			Metadata:   adapters.KubernetesObjectMetadata{Name: "payments"},
		},
		Value: custom,
		Clock: func() time.Time { return time.Date(2026, 9, 4, 18, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	custom["image"] = "registry.example/payments:2"

	input := worldcut.VerificationInput{
		Contract: worldcut.Contract{
			ID:           "image-pinned",
			Version:      "1",
			DecisionTime: "2026-09-04T18:00:00.000Z",
			Requirements: []worldcut.Requirement{
				worldcut.NewValueEqualsRequirement(
					"image-is-pinned",
					"The deployment runs the pinned image",
					"deployment",
					[]string{"image"},
					"registry.example/payments:1",
				),
			},
		},
		Observations: []worldcut.Observation{observation},
	}
	first, err := worldcut.VerifyDecisionContract(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", first.Verdict)
	}

	parsed, err := worldcut.ParseVerificationInput(input)
	if err != nil {
		t.Fatal(err)
	}
	observation.Value.(map[string]any)["image"] = "registry.example/payments:3"
	second, err := worldcut.Verify(parsed)
	if err != nil {
		t.Fatal(err)
	}
	if second.VerificationRecordDigest != first.VerificationRecordDigest {
		t.Fatal("mutating a captured observation changed a parsed snapshot")
	}
}
