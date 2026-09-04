// Package githubactions verifies that the latest completed push run of an
// exact GitHub Actions workflow tested the current branch head.
//
// It uses only the standard library. The HTTP client, API base URL, clock,
// and observation identifier source are injectable so the gate can be tested
// deterministically without network access.
package githubactions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	"github.com/Jason-Doyle/WorldCut/ports/go/internal/idgen"
)

// DefaultAPIBaseURL is the public GitHub REST API root.
const DefaultAPIBaseURL = "https://api.github.com"

// maxResponseBytes bounds every response body this package reads.
const maxResponseBytes = 8 << 20

// maxSafeInteger matches the JavaScript safe-integer bound the reference
// implementation enforces on GitHub identifiers.
const maxSafeInteger = int64(9007199254740991)

// HTTPDoer performs a single HTTP request. *http.Client satisfies it.
type HTTPDoer interface {
	Do(request *http.Request) (*http.Response, error)
}

// Options selects the workflow gate target and its injectable dependencies.
type Options struct {
	// Repository is an owner/name pair.
	Repository string
	// Branch is the branch whose head must have been tested.
	Branch string
	// Workflow is a numeric workflow ID or a .yml/.yaml workflow filename.
	Workflow string
	// Token is an optional GitHub token. It is never included in an error.
	Token string
	// APIBaseURL defaults to DefaultAPIBaseURL.
	APIBaseURL string
	// Client defaults to a client that refuses to follow redirects.
	Client HTTPDoer
	// Clock defaults to time.Now.
	Clock func() time.Time
	// NewID defaults to a random version 4 UUID.
	NewID func() (string, error)
}

// WorkflowRunEvidence is the validated subset of a workflow run WorldCut uses.
type WorkflowRunEvidence struct {
	ID         int64  `json:"id"`
	WorkflowID int64  `json:"workflowId"`
	HeadSHA    string `json:"headSha"`
	HeadBranch string `json:"headBranch"`
	Event      string `json:"event"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	URL        string `json:"url"`
}

// Verification is the complete result of one deployment gate evaluation.
type Verification struct {
	Repository string `json:"repository"`
	Branch     string `json:"branch"`
	Workflow   string `json:"workflow"`
	// BranchSHA is the branch head observed after the run lookup.
	BranchSHA string `json:"branchSha"`
	// VerifiedSHA is non-nil only when the contract is satisfied. Deployments
	// must consume this exact SHA, never the branch name.
	VerifiedSHA *string                      `json:"verifiedSha"`
	WorkflowRun *WorkflowRunEvidence         `json:"workflowRun"`
	Input       worldcut.VerificationInput   `json:"input"`
	Result      *worldcut.VerificationResult `json:"result"`
}

// EvidenceCoverage summarizes how much of the required evidence GitHub
// actually exposes across recent completed push runs.
type EvidenceCoverage struct {
	Repository                  string         `json:"repository"`
	Branch                      string         `json:"branch"`
	Workflow                    string         `json:"workflow"`
	InspectedRuns               int            `json:"inspectedRuns"`
	DependencyEvidenceAvailable int            `json:"dependencyEvidenceAvailable"`
	ConclusionEvidenceAvailable int            `json:"conclusionEvidenceAvailable"`
	CompleteEvidenceRuns        int            `json:"completeEvidenceRuns"`
	EvidenceCoverage            float64        `json:"evidenceCoverage"`
	Conclusions                 map[string]int `json:"conclusions"`
}

var (
	repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	workflowIDPattern = regexp.MustCompile(`^[0-9]+$`)
	workflowFile      = regexp.MustCompile(`(?i)^[A-Za-z0-9_.-]+\.ya?ml$`)
	shaPattern        = regexp.MustCompile(`^[0-9a-fA-F]{40}$`)
)

// ErrRedirectNotFollowed reports that the GitHub API redirected. WorldCut
// never follows a redirect while collecting evidence.
var ErrRedirectNotFollowed = errors.New("GitHub API redirects are not followed")

func responseInvalid(format string, arguments ...any) error {
	return worldcut.NewError(
		worldcut.GitHubResponseInvalidCode,
		fmt.Sprintf(format, arguments...),
	)
}

func apiError(message string, cause error) error {
	if cause == nil {
		return worldcut.NewError(worldcut.GitHubAPIErrorCode, message)
	}
	return worldcut.WrapError(worldcut.GitHubAPIErrorCode, message, cause)
}

type client struct {
	repository     string
	repositoryPath string
	branch         string
	workflow       string
	token          string
	apiBaseURL     string
	http           HTTPDoer
	clock          func() time.Time
	newID          func() (string, error)
}

func (options Options) resolve() (*client, error) {
	if !repositoryPattern.MatchString(options.Repository) {
		return nil, responseInvalid("repository must use owner/name form")
	}
	if strings.TrimSpace(options.Branch) == "" {
		return nil, responseInvalid("branch must not be empty")
	}
	if !workflowIDPattern.MatchString(options.Workflow) && !workflowFile.MatchString(options.Workflow) {
		return nil, responseInvalid("workflow must be a numeric workflow ID or workflow filename")
	}
	owner, name, found := strings.Cut(options.Repository, "/")
	if !found || owner == "" || name == "" {
		return nil, responseInvalid("repository must use owner/name form")
	}
	apiBaseURL := options.APIBaseURL
	if apiBaseURL == "" {
		apiBaseURL = DefaultAPIBaseURL
	}
	apiBaseURL = strings.TrimRight(apiBaseURL, "/")
	if apiBaseURL == "" {
		return nil, responseInvalid("apiBaseUrl must not be empty")
	}
	parsedBaseURL, err := url.Parse(apiBaseURL)
	if err != nil ||
		(parsedBaseURL.Scheme != "http" && parsedBaseURL.Scheme != "https") ||
		parsedBaseURL.Host == "" ||
		parsedBaseURL.User != nil ||
		parsedBaseURL.RawQuery != "" ||
		parsedBaseURL.Fragment != "" {
		return nil, responseInvalid(
			"apiBaseUrl must be an absolute HTTP(S) URL without user information, query, or fragment",
		)
	}
	httpClient := options.Client
	if standardClient, ok := httpClient.(*http.Client); ok {
		cloned := *standardClient
		cloned.CheckRedirect = func(*http.Request, []*http.Request) error {
			return ErrRedirectNotFollowed
		}
		httpClient = &cloned
	} else if httpClient == nil {
		httpClient = &http.Client{
			Timeout: 30 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return ErrRedirectNotFollowed
			},
		}
	}
	clock := options.Clock
	if clock == nil {
		clock = time.Now
	}
	newID := options.NewID
	if newID == nil {
		newID = idgen.UUIDv4
	}
	return &client{
		repository:     options.Repository,
		repositoryPath: url.PathEscape(owner) + "/" + url.PathEscape(name),
		branch:         options.Branch,
		workflow:       options.Workflow,
		token:          options.Token,
		apiBaseURL:     apiBaseURL,
		http:           httpClient,
		clock:          clock,
		newID:          newID,
	}, nil
}

func (c *client) now() string {
	return worldcut.FormatTimestamp(c.clock())
}

func (c *client) observationID(prefix string) (string, error) {
	value, err := c.newID()
	if err != nil {
		return "", responseInvalid("generate observation identifier: %v", err)
	}
	if value == "" {
		return "", responseInvalid("observation identifier source returned an empty value")
	}
	return prefix + "-" + value, nil
}

func (c *client) workflowRunsURL(perPage int) string {
	query := url.Values{}
	query.Set("branch", c.branch)
	query.Set("event", "push")
	query.Set("status", "completed")
	query.Set("exclude_pull_requests", "true")
	query.Set("per_page", strconv.Itoa(perPage))
	return c.apiBaseURL + "/repos/" + c.repositoryPath + "/actions/workflows/" +
		url.PathEscape(c.workflow) + "/runs?" + query.Encode()
}

func (c *client) branchURL() string {
	return c.apiBaseURL + "/repos/" + c.repositoryPath + "/branches/" + url.PathEscape(c.branch)
}

func (c *client) getJSON(ctx context.Context, target string) (any, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, apiError("GitHub request could not be built for "+target, err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "worldcut")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.token != "" {
		request.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		return nil, apiError("GitHub request failed for "+target, err)
	}
	if response == nil {
		return nil, apiError("GitHub client returned no response for "+target, nil)
	}
	if response.Request != nil &&
		response.Request.URL != nil &&
		response.Request.URL.String() != request.URL.String() {
		if response.Body != nil {
			_ = response.Body.Close()
		}
		return nil, apiError(
			"GitHub request changed resource URL for "+target,
			ErrRedirectNotFollowed,
		)
	}
	var body []byte
	if response.Body != nil {
		defer func() {
			_ = response.Body.Close()
		}()
		body, err = io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
		if err != nil {
			return nil, apiError("GitHub response could not be read for "+target, err)
		}
		if len(body) > maxResponseBytes {
			return nil, responseInvalid(
				"GitHub response for %s exceeded %d bytes",
				target,
				maxResponseBytes,
			)
		}
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, apiError(fmt.Sprintf(
			"GitHub request returned %d: %s",
			response.StatusCode,
			truncate(string(body), 500),
		), nil)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, worldcut.WrapError(
			worldcut.GitHubResponseInvalidCode,
			"GitHub returned invalid JSON for "+target,
			err,
		)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, responseInvalid("GitHub returned trailing content for %s", target)
	}
	return value, nil
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func requireRecord(value any, field string) (map[string]any, error) {
	record, ok := value.(map[string]any)
	if !ok {
		return nil, responseInvalid("%s must be an object", field)
	}
	return record, nil
}

func requireString(record map[string]any, field string) (string, error) {
	value, ok := record[field].(string)
	if !ok || value == "" {
		return "", responseInvalid("GitHub response field %s must be a non-empty string", field)
	}
	return value, nil
}

func requireSafeInteger(record map[string]any, field string) (int64, error) {
	number, ok := record[field].(json.Number)
	if !ok {
		return 0, responseInvalid("GitHub response field %s must be a safe integer", field)
	}
	value, err := number.Int64()
	if err != nil {
		float, floatErr := number.Float64()
		if floatErr != nil || float != float64(int64(float)) {
			return 0, responseInvalid("GitHub response field %s must be a safe integer", field)
		}
		value = int64(float)
	}
	if value > maxSafeInteger || value < -maxSafeInteger {
		return 0, responseInvalid("GitHub response field %s must be a safe integer", field)
	}
	return value, nil
}

func requireSHA(value, field string) (string, error) {
	if !shaPattern.MatchString(value) {
		return "", responseInvalid("%s must be a full Git commit SHA", field)
	}
	return value, nil
}

func workflowRunFromResponse(value any, repository, branch string) (*WorkflowRunEvidence, error) {
	run, err := requireRecord(value, "workflow run")
	if err != nil {
		return nil, err
	}
	headRepository, err := requireRecord(run["head_repository"], "workflow run head_repository")
	if err != nil {
		return nil, err
	}
	fullName, err := requireString(headRepository, "full_name")
	if err != nil {
		return nil, err
	}
	headBranch, err := requireString(run, "head_branch")
	if err != nil {
		return nil, err
	}
	event, err := requireString(run, "event")
	if err != nil {
		return nil, err
	}
	status, err := requireString(run, "status")
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(fullName, repository) {
		return nil, responseInvalid("workflow run belongs to %s, not %s", fullName, repository)
	}
	if headBranch != branch || event != "push" || status != "completed" {
		return nil, responseInvalid(
			"workflow run does not match the requested branch, push event, and completed status",
		)
	}
	id, err := requireSafeInteger(run, "id")
	if err != nil {
		return nil, err
	}
	workflowID, err := requireSafeInteger(run, "workflow_id")
	if err != nil {
		return nil, err
	}
	rawHeadSHA, err := requireString(run, "head_sha")
	if err != nil {
		return nil, err
	}
	headSHA, err := requireSHA(rawHeadSHA, "workflow head_sha")
	if err != nil {
		return nil, err
	}
	conclusion, err := requireString(run, "conclusion")
	if err != nil {
		return nil, err
	}
	runURL, err := requireString(run, "html_url")
	if err != nil {
		return nil, err
	}
	return &WorkflowRunEvidence{
		ID:         id,
		WorkflowID: workflowID,
		HeadSHA:    headSHA,
		HeadBranch: headBranch,
		Event:      "push",
		Status:     "completed",
		Conclusion: conclusion,
		URL:        runURL,
	}, nil
}

func workflowRuns(payload any) ([]any, error) {
	record, err := requireRecord(payload, "workflow runs response")
	if err != nil {
		return nil, err
	}
	runs, ok := record["workflow_runs"].([]any)
	if !ok {
		return nil, responseInvalid("GitHub workflow_runs must be an array")
	}
	return runs, nil
}

func branchSHAFromResponse(payload any) (string, error) {
	branch, err := requireRecord(payload, "branch")
	if err != nil {
		return "", err
	}
	commit, err := requireRecord(branch["commit"], "branch commit")
	if err != nil {
		return "", err
	}
	sha, err := requireString(commit, "sha")
	if err != nil {
		return "", err
	}
	return requireSHA(sha, "branch commit sha")
}

// VerifyLatestWorkflow gates a deployment on the latest completed push run of
// one exact workflow.
//
// It deliberately selects the latest completed run rather than the latest
// successful run, so a newer failure is a known violation instead of being
// hidden by an older success. It returns a verified SHA only when the
// contract is satisfied.
func VerifyLatestWorkflow(ctx context.Context, options Options) (*Verification, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	gate, err := options.resolve()
	if err != nil {
		return nil, err
	}

	payload, err := gate.getJSON(ctx, gate.workflowRunsURL(1))
	if err != nil {
		return nil, err
	}
	runs, err := workflowRuns(payload)
	if err != nil {
		return nil, err
	}
	var run *WorkflowRunEvidence
	if len(runs) > 0 {
		run, err = workflowRunFromResponse(runs[0], gate.repository, gate.branch)
		if err != nil {
			return nil, err
		}
	}
	runObservedAt := gate.now()

	branchPayload, err := gate.getJSON(ctx, gate.branchURL())
	if err != nil {
		return nil, err
	}
	branchSHA, err := branchSHAFromResponse(branchPayload)
	if err != nil {
		return nil, err
	}
	branchObservedAt := gate.now()
	decisionTime := gate.now()

	branchResource := worldcut.ResourceIdentity{
		Provider: "github",
		Account:  gate.repository,
		Kind:     "branch_head",
		Key:      gate.branch,
	}
	headID, err := gate.observationID("github-head")
	if err != nil {
		return nil, err
	}
	headVersion := branchSHA
	observations := []worldcut.Observation{{
		ID:       headID,
		Role:     "head",
		Resource: branchResource,
		Value: map[string]any{
			"repository": gate.repository,
			"branch":     gate.branch,
			"sha":        branchSHA,
		},
		ObservedAt:      branchObservedAt,
		AcquisitionCost: 1,
		Witness: worldcut.ObservationWitness{
			Provenance: "provider_asserted",
			Version:    &headVersion,
		},
	}}
	if run != nil {
		runID, err := gate.observationID("github-run")
		if err != nil {
			return nil, err
		}
		runVersion := strconv.FormatInt(run.ID, 10)
		testedHead := run.HeadSHA
		observations = append(observations, worldcut.Observation{
			ID:   runID,
			Role: "ci",
			Resource: worldcut.ResourceIdentity{
				Provider: "github-actions",
				Account:  gate.repository,
				Kind:     "workflow_run",
				Key:      gate.workflow + "/" + runVersion,
			},
			Value: map[string]any{
				"conclusion": run.Conclusion,
				"event":      run.Event,
				"headSha":    run.HeadSHA,
				"runId":      run.ID,
				"status":     run.Status,
				"url":        run.URL,
				"workflowId": run.WorkflowID,
			},
			ObservedAt:      runObservedAt,
			AcquisitionCost: 2,
			Witness: worldcut.ObservationWitness{
				Provenance: "provider_asserted",
				Version:    &runVersion,
				Dependencies: []worldcut.DependencyWitness{{
					Name:       "tested_head",
					Resource:   branchResource,
					Relation:   "exact",
					Version:    &testedHead,
					Provenance: "provider_asserted",
				}},
			},
		})
	}

	input := worldcut.VerificationInput{
		ProtocolVersion: worldcut.ProtocolVersion,
		Contract: worldcut.Contract{
			ID:           "github-latest-completed-push",
			Version:      "1",
			DecisionTime: decisionTime,
			Assumptions:  worldcut.SupportedAssumptions(),
			Requirements: []worldcut.Requirement{
				worldcut.NewValueEqualsRequirement(
					"workflow-conclusion-success",
					"The latest completed push workflow concluded successfully",
					"ci",
					[]string{"conclusion"},
					"success",
				),
				worldcut.NewDependencyRequirement(
					"workflow-tested-current-head",
					"The workflow run tested the selected branch head",
					"ci",
					"head",
					"tested_head",
				),
			},
		},
		Observations: observations,
	}
	result, err := worldcut.VerifyDecisionContract(input)
	if err != nil {
		return nil, worldcut.WrapError(
			worldcut.GitHubResponseInvalidCode,
			"GitHub evidence did not form a valid WorldCut verification input",
			err,
		)
	}
	verification := &Verification{
		Repository:  gate.repository,
		Branch:      gate.branch,
		Workflow:    gate.workflow,
		BranchSHA:   branchSHA,
		WorkflowRun: run,
		Input:       input,
		Result:      result,
	}
	if result.Verdict == "CONTRACT_SATISFIED" {
		verified := branchSHA
		verification.VerifiedSHA = &verified
	}
	return verification, nil
}

// InspectWorkflowEvidence reports how consistently GitHub exposes the
// dependency and conclusion evidence the gate requires, over the latest
// completed push runs. The limit must be between 1 and 100.
func InspectWorkflowEvidence(ctx context.Context, options Options, limit int) (*EvidenceCoverage, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	gate, err := options.resolve()
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, responseInvalid("history limit must be an integer from 1 through 100")
	}
	payload, err := gate.getJSON(ctx, gate.workflowRunsURL(limit))
	if err != nil {
		return nil, err
	}
	rawRuns, err := workflowRuns(payload)
	if err != nil {
		return nil, err
	}
	conclusions := map[string]int{}
	completeEvidenceRuns := 0
	for _, rawRun := range rawRuns {
		run, err := workflowRunFromResponse(rawRun, gate.repository, gate.branch)
		if err != nil {
			return nil, err
		}
		conclusions[run.Conclusion]++
		if len(run.HeadSHA) == 40 && run.Conclusion != "" {
			completeEvidenceRuns++
		}
	}
	coverage := 0.0
	if len(rawRuns) > 0 {
		coverage = float64(completeEvidenceRuns) / float64(len(rawRuns))
	}
	return &EvidenceCoverage{
		Repository:                  gate.repository,
		Branch:                      gate.branch,
		Workflow:                    gate.workflow,
		InspectedRuns:               len(rawRuns),
		DependencyEvidenceAvailable: len(rawRuns),
		ConclusionEvidenceAvailable: len(rawRuns),
		CompleteEvidenceRuns:        completeEvidenceRuns,
		EvidenceCoverage:            coverage,
		Conclusions:                 conclusions,
	}, nil
}
