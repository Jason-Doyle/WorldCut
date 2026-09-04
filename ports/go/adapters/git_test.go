package adapters_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	"github.com/Jason-Doyle/WorldCut/ports/go/adapters"
)

var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

func fixtureRepository(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not available on PATH")
	}
	directory := t.TempDir()
	commands := [][]string{
		{"init", "--quiet", "--initial-branch=main", directory},
		{"-C", directory, "config", "user.email", "worldcut@example.invalid"},
		{"-C", directory, "config", "user.name", "WorldCut Test"},
		{"-C", directory, "config", "commit.gpgsign", "false"},
		{"-C", directory, "config", "core.autocrlf", "false"},
	}
	for _, arguments := range commands {
		if output, err := exec.Command("git", arguments...).CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", arguments, err, output)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "sample.txt"), []byte("sample\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, arguments := range [][]string{
		{"-C", directory, "add", "sample.txt"},
		{"-C", directory, "commit", "--quiet", "-m", "init"},
	} {
		if output, err := exec.Command("git", arguments...).CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v: %s", arguments, err, output)
		}
	}
	return directory
}

func TestCaptureGitHeadRecordsAnImmutableCommit(t *testing.T) {
	directory := fixtureRepository(t)
	observation, err := adapters.CaptureGitHead(context.Background(), adapters.GitHeadOptions{
		RepositoryPath: directory,
		RepositoryID:   "fixture",
		Branch:         "main",
		Role:           "head",
	})
	if err != nil {
		t.Fatal(err)
	}
	if observation.Witness.Version == nil || !commitPattern.MatchString(*observation.Witness.Version) {
		t.Fatalf("version = %v", observation.Witness.Version)
	}
	if observation.Witness.Provenance != "client_observed" {
		t.Fatalf("provenance = %s", observation.Witness.Provenance)
	}
	if observation.Witness.Validity != nil {
		t.Fatal("the Git adapter must not invent a validity interval")
	}
	if observation.Resource.Account != "local" || observation.Resource.Kind != "branch_head" {
		t.Fatalf("resource = %+v", observation.Resource)
	}
	if observation.Resource.Key != "fixture/main" {
		t.Fatalf("resource key = %s", observation.Resource.Key)
	}
	if observation.AcquisitionCost != 1 {
		t.Fatalf("acquisitionCost = %d", observation.AcquisitionCost)
	}
	value, ok := observation.Value.(map[string]any)
	if !ok || value["commit"] != *observation.Witness.Version {
		t.Fatalf("value = %#v", observation.Value)
	}

	second, err := adapters.CaptureGitHead(context.Background(), adapters.GitHeadOptions{
		RepositoryPath: directory,
		RepositoryID:   "fixture",
		Branch:         "main",
		Role:           "second-head",
	})
	if err != nil {
		t.Fatal(err)
	}
	if observation.ID == second.ID {
		t.Fatal("two captures produced the same observation identifier")
	}
}

func TestCaptureGitHeadRejectsRevisionExpressionsAndMissingRefs(t *testing.T) {
	directory := fixtureRepository(t)
	for name, branch := range map[string]string{
		"revision expression": "main~1",
		"reflog expression":   "main@{1}",
		"missing branch":      "does-not-exist",
		"tag namespace":       "refs/tags/v1",
		"dash option":         "-C",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := adapters.CaptureGitHead(context.Background(), adapters.GitHeadOptions{
				RepositoryPath: directory,
				RepositoryID:   "fixture",
				Branch:         branch,
				Role:           "head",
			})
			if err == nil {
				t.Fatalf("branch %q was accepted", branch)
			}
		})
	}
}

func TestCaptureGitHeadValidatesOptions(t *testing.T) {
	cases := map[string]adapters.GitHeadOptions{
		"missing path":       {RepositoryID: "fixture", Branch: "main", Role: "head"},
		"missing repository": {RepositoryPath: ".", Branch: "main", Role: "head"},
		"missing branch":     {RepositoryPath: ".", RepositoryID: "fixture", Role: "head"},
		"missing role":       {RepositoryPath: ".", RepositoryID: "fixture", Branch: "main"},
	}
	for name, options := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := adapters.CaptureGitHead(context.Background(), options); err == nil {
				t.Fatal("expected a rejection")
			}
		})
	}

	cost := worldcut.MaxAcquisitionCost + 1
	_, err := adapters.CaptureGitHead(context.Background(), adapters.GitHeadOptions{
		RepositoryPath:  ".",
		RepositoryID:    "fixture",
		Branch:          "main",
		Role:            "head",
		AcquisitionCost: &cost,
	})
	if err == nil || !strings.Contains(err.Error(), "acquisitionCost") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCaptureGitHeadHonorsContextCancellation(t *testing.T) {
	directory := fixtureRepository(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := adapters.CaptureGitHead(ctx, adapters.GitHeadOptions{
		RepositoryPath: directory,
		RepositoryID:   "fixture",
		Branch:         "main",
		Role:           "head",
	})
	if err == nil || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCaptureGitHeadReportsMissingExecutable(t *testing.T) {
	_, err := adapters.CaptureGitHead(context.Background(), adapters.GitHeadOptions{
		RepositoryPath: t.TempDir(),
		RepositoryID:   "fixture",
		Branch:         "main",
		Role:           "head",
		GitExecutable:  "worldcut-missing-git-executable",
	})
	if err == nil || !strings.Contains(err.Error(), "git check-ref-format failed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCaptureGitHeadObservationVerifies(t *testing.T) {
	directory := fixtureRepository(t)
	clock := func() time.Time {
		return time.Date(2026, 9, 4, 18, 0, 0, 0, time.UTC)
	}
	observation, err := adapters.CaptureGitHead(context.Background(), adapters.GitHeadOptions{
		RepositoryPath: directory,
		RepositoryID:   "fixture",
		Branch:         "main",
		Role:           "head",
		Clock:          clock,
		NewID:          func() (string, error) { return "fixed", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	if observation.ID != "git-fixed" {
		t.Fatalf("identifier = %s", observation.ID)
	}
	if observation.ObservedAt != "2026-09-04T18:00:00.000Z" {
		t.Fatalf("observedAt = %s", observation.ObservedAt)
	}
	result, err := worldcut.VerifyDecisionContract(worldcut.VerificationInput{
		Contract: worldcut.Contract{
			ID:           "git-head",
			Version:      "1",
			DecisionTime: "2026-09-04T18:00:00.000Z",
			Requirements: []worldcut.Requirement{
				worldcut.NewValueEqualsRequirement(
					"branch-is-main",
					"The captured branch is main",
					"head",
					[]string{"branch"},
					"main",
				),
			},
		},
		Observations: []worldcut.Observation{observation},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", result.Verdict)
	}
}
