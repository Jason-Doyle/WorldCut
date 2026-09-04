// Command worldcut-github-ci-go gates a deployment on the latest completed
// GitHub Actions push run for one exact workflow and branch.
//
// It exits with status 2 unless the decision contract is satisfied, writes
// verified_sha and workflow_run_id to GITHUB_OUTPUT on success, and reports
// failures as a stable JSON error envelope on stderr.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	"github.com/Jason-Doyle/WorldCut/ports/go/integrations/githubactions"
)

const usage = `Usage: worldcut-github-ci-go --repository owner/name --workflow ci.yml [options]

Options:
  --branch <name>       Branch to verify (default: main)
  --token-env <name>    Environment variable containing a GitHub token
  --full                Include verification input and full result
  --help                Show this help`

type dependencies struct {
	getenv     func(string) string
	stdout     io.Writer
	stderr     io.Writer
	apiBaseURL string
	client     githubactions.HTTPDoer
}

type requirementSummary struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Summary string `json:"summary"`
}

type gateSummary struct {
	Repository               string                             `json:"repository"`
	Branch                   string                             `json:"branch"`
	Workflow                 string                             `json:"workflow"`
	BranchSHA                string                             `json:"branchSha"`
	VerifiedSHA              *string                            `json:"verifiedSha"`
	WorkflowRun              *githubactions.WorkflowRunEvidence `json:"workflowRun"`
	Verdict                  string                             `json:"verdict"`
	Requirements             []requirementSummary               `json:"requirements"`
	VerificationRecordDigest string                             `json:"verificationRecordDigest"`
}

func writeError(stderr io.Writer, code, message string) {
	encoded, err := json.Marshal(map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
	if err != nil {
		fmt.Fprintln(stderr, `{"error":{"code":"WORLDCUT_RUNTIME_ERROR","message":"unable to encode error"}}`)
		return
	}
	fmt.Fprintln(stderr, string(encoded))
}

func run(ctx context.Context, arguments []string, deps dependencies) int {
	flags := flag.NewFlagSet("worldcut-github-ci-go", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.Usage = func() {}
	repository := flags.String("repository", "", "repository in owner/name form")
	branch := flags.String("branch", "main", "branch to verify")
	workflow := flags.String("workflow", "", "numeric workflow ID or workflow filename")
	tokenEnvironment := flags.String("token-env", "", "environment variable holding a GitHub token")
	tokenEnvironmentAlias := flags.String("tokenEnv", "", "alias for --token-env")
	full := flags.Bool("full", false, "include verification input and full result")
	help := flags.Bool("help", false, "show help")
	if err := flags.Parse(arguments); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(deps.stdout, usage)
			return 0
		}
		writeError(deps.stderr, "WORLDCUT_INVALID_ARGUMENT", err.Error())
		return 1
	}
	if *help {
		fmt.Fprintln(deps.stdout, usage)
		return 0
	}
	if flags.NArg() != 0 {
		writeError(
			deps.stderr,
			"WORLDCUT_INVALID_ARGUMENT",
			"unexpected positional argument: "+flags.Arg(0),
		)
		return 1
	}
	if *repository == "" || *workflow == "" {
		writeError(
			deps.stderr,
			"WORLDCUT_INVALID_ARGUMENT",
			"--repository and --workflow are required",
		)
		return 1
	}
	if *tokenEnvironment != "" && *tokenEnvironmentAlias != "" && *tokenEnvironment != *tokenEnvironmentAlias {
		writeError(
			deps.stderr,
			"WORLDCUT_INVALID_ARGUMENT",
			"--token-env and --tokenEnv must not disagree",
		)
		return 1
	}
	tokenVariable := *tokenEnvironment
	if tokenVariable == "" {
		tokenVariable = *tokenEnvironmentAlias
	}

	token := ""
	if tokenVariable != "" {
		token = deps.getenv(tokenVariable)
	} else if value := deps.getenv("GITHUB_TOKEN"); value != "" {
		token = value
	} else {
		token = deps.getenv("GH_TOKEN")
	}

	verification, err := githubactions.VerifyLatestWorkflow(ctx, githubactions.Options{
		Repository: *repository,
		Branch:     *branch,
		Workflow:   *workflow,
		Token:      token,
		APIBaseURL: deps.apiBaseURL,
		Client:     deps.client,
	})
	if err != nil {
		code := worldcut.ErrorCode(err)
		if code == "" {
			code = "WORLDCUT_RUNTIME_ERROR"
		}
		writeError(deps.stderr, code, err.Error())
		return 1
	}

	var payload any = verification
	if !*full {
		requirements := make([]requirementSummary, 0, len(verification.Result.RequirementResults))
		for _, requirement := range verification.Result.RequirementResults {
			requirements = append(requirements, requirementSummary{
				ID:      requirement.RequirementID,
				Status:  requirement.Status,
				Summary: requirement.Summary,
			})
		}
		payload = gateSummary{
			Repository:               verification.Repository,
			Branch:                   verification.Branch,
			Workflow:                 verification.Workflow,
			BranchSHA:                verification.BranchSHA,
			VerifiedSHA:              verification.VerifiedSHA,
			WorkflowRun:              verification.WorkflowRun,
			Verdict:                  verification.Result.Verdict,
			Requirements:             requirements,
			VerificationRecordDigest: verification.Result.VerificationRecordDigest,
		}
	}
	encoder := json.NewEncoder(deps.stdout)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil {
		writeError(deps.stderr, "WORLDCUT_RUNTIME_ERROR", err.Error())
		return 1
	}

	if verification.VerifiedSHA != nil {
		if outputPath := deps.getenv("GITHUB_OUTPUT"); outputPath != "" {
			runID := ""
			if verification.WorkflowRun != nil {
				runID = strconv.FormatInt(verification.WorkflowRun.ID, 10)
			}
			if err := appendOutput(outputPath, *verification.VerifiedSHA, runID); err != nil {
				writeError(deps.stderr, "WORLDCUT_RUNTIME_ERROR", err.Error())
				return 1
			}
		}
	}
	if verification.Result.Verdict != "CONTRACT_SATISFIED" {
		return 2
	}
	return 0
}

func appendOutput(path, verifiedSHA, runID string) error {
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer func() {
		_ = file.Close()
	}()
	_, err = fmt.Fprintf(file, "verified_sha=%s\nworkflow_run_id=%s\n", verifiedSHA, runID)
	return err
}

func main() {
	os.Exit(run(context.Background(), os.Args[1:], dependencies{
		getenv: os.Getenv,
		stdout: os.Stdout,
		stderr: os.Stderr,
	}))
}
