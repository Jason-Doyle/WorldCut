package adapters

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
)

// GitHeadOptions describes one exact local branch head to capture.
type GitHeadOptions struct {
	// RepositoryPath is the local working tree or repository directory.
	RepositoryPath string
	// RepositoryID names the repository inside the observation value and key.
	RepositoryID string
	// Branch is an exact local branch name. Revision expressions are rejected.
	Branch string
	// Role binds the observation to a contract role.
	Role string
	// Account defaults to "local".
	Account string
	// AcquisitionCost defaults to 1.
	AcquisitionCost *int64
	// GitExecutable defaults to "git" resolved through PATH.
	GitExecutable string
	// Clock defaults to time.Now.
	Clock func() time.Time
	// NewID defaults to a random version 4 UUID.
	NewID func() (string, error)
}

var gitCommitPattern = regexp.MustCompile(`^[0-9a-fA-F]{40,64}$`)

// CaptureGitHead resolves an exact local branch head and records its commit
// SHA as an exact version witness.
//
// The branch name is validated with git check-ref-format --branch and then
// resolved only through refs/heads/<branch>^{commit}, so revision expressions
// such as main~1 and missing refs are rejected instead of silently resolving
// to another commit.
func CaptureGitHead(ctx context.Context, options GitHeadOptions) (worldcut.Observation, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	fields := []struct {
		name  string
		value string
	}{
		{"repositoryPath", options.RepositoryPath},
		{"repositoryId", options.RepositoryID},
		{"branch", options.Branch},
		{"role", options.Role},
	}
	for _, field := range fields {
		if err := requireText(field.value, field.name); err != nil {
			return worldcut.Observation{}, err
		}
	}
	if strings.HasPrefix(options.Branch, "-") {
		return worldcut.Observation{}, errors.New("branch must not start with a dash")
	}
	if strings.ContainsAny(options.Branch, "\x00\n") {
		return worldcut.Observation{}, errors.New("branch must not contain control characters")
	}
	cost, err := acquisitionCost(options.AcquisitionCost)
	if err != nil {
		return worldcut.Observation{}, err
	}

	executable := options.GitExecutable
	if executable == "" {
		executable = "git"
	}
	if _, err := runGit(ctx, executable, options.RepositoryPath, "check-ref-format", "--branch", options.Branch); err != nil {
		return worldcut.Observation{}, err
	}
	stdout, err := runGit(
		ctx,
		executable,
		options.RepositoryPath,
		"rev-parse",
		"--verify",
		"refs/heads/"+options.Branch+"^{commit}",
	)
	if err != nil {
		return worldcut.Observation{}, err
	}
	commit := strings.TrimSpace(stdout)
	if !gitCommitPattern.MatchString(commit) {
		return worldcut.Observation{}, errors.New("git returned an invalid commit identifier")
	}

	id, err := observationID("git", options.NewID)
	if err != nil {
		return worldcut.Observation{}, err
	}
	account := options.Account
	if account == "" {
		account = "local"
	}
	version := commit
	return worldcut.Observation{
		ID:   id,
		Role: options.Role,
		Resource: worldcut.ResourceIdentity{
			Provider: "git",
			Account:  account,
			Kind:     "branch_head",
			Key:      options.RepositoryID + "/" + options.Branch,
		},
		Value: map[string]any{
			"repository": options.RepositoryID,
			"branch":     options.Branch,
			"commit":     commit,
		},
		ObservedAt:      observedAt(options.Clock),
		AcquisitionCost: cost,
		Witness: worldcut.ObservationWitness{
			Provenance: "client_observed",
			Version:    &version,
		},
	}, nil
}

func runGit(ctx context.Context, executable, repositoryPath string, arguments ...string) (string, error) {
	command := exec.CommandContext(
		ctx,
		executable,
		append([]string{"-C", repositoryPath}, arguments...)...,
	)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("git %s was cancelled: %w", arguments[0], ctx.Err())
		}
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			return "", fmt.Errorf("git %s failed: %w", arguments[0], err)
		}
		return "", fmt.Errorf("git %s failed: %s: %w", arguments[0], detail, err)
	}
	return stdout.String(), nil
}
