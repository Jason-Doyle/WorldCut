package githubactions_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	"github.com/Jason-Doyle/WorldCut/ports/go/integrations/githubactions"
)

const (
	currentSHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	staleSHA   = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
)

type recordedRequest struct {
	method        string
	path          string
	escapedPath   string
	query         string
	authorization string
	accept        string
	userAgent     string
	apiVersion    string
}

type responseErrorClient struct {
	response *http.Response
	err      error
}

func (c responseErrorClient) Do(*http.Request) (*http.Response, error) {
	return c.response, c.err
}

type trackedBody struct {
	closed bool
}

func (b *trackedBody) Read([]byte) (int, error) {
	return 0, io.EOF
}

func (b *trackedBody) Close() error {
	b.closed = true
	return nil
}

type fixture struct {
	status        int
	responseBody  string
	runs          []any
	runsOverride  any
	branchPayload any
	oversized     bool
	requests      []recordedRequest
}

func run(overrides map[string]any, removed ...string) map[string]any {
	value := map[string]any{
		"id":              81,
		"workflow_id":     42,
		"head_sha":        currentSHA,
		"head_branch":     "main",
		"event":           "push",
		"status":          "completed",
		"conclusion":      "success",
		"html_url":        "https://github.com/acme/service/actions/runs/81",
		"head_repository": map[string]any{"full_name": "acme/service"},
	}
	for key, override := range overrides {
		value[key] = override
	}
	for _, key := range removed {
		delete(value, key)
	}
	return value
}

func (f *fixture) server(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		f.requests = append(f.requests, recordedRequest{
			method:        request.Method,
			path:          request.URL.Path,
			escapedPath:   request.URL.EscapedPath(),
			query:         request.URL.RawQuery,
			authorization: request.Header.Get("Authorization"),
			accept:        request.Header.Get("Accept"),
			userAgent:     request.Header.Get("User-Agent"),
			apiVersion:    request.Header.Get("X-GitHub-Api-Version"),
		})
		if f.status != 0 {
			writer.WriteHeader(f.status)
			body := f.responseBody
			if body == "" {
				body = "failure"
			}
			_, _ = writer.Write([]byte(body))
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/actions/workflows/"):
			if f.oversized {
				_, _ = writer.Write([]byte(`"` + strings.Repeat("a", 9<<20) + `"`))
				return
			}
			var payload any = map[string]any{"workflow_runs": f.runs}
			if f.runsOverride != nil {
				payload = f.runsOverride
			}
			if f.runs == nil && f.runsOverride == nil {
				payload = map[string]any{"workflow_runs": []any{run(nil)}}
			}
			writeJSON(t, writer, payload)
		case strings.Contains(request.URL.Path, "/branches/"):
			payload := f.branchPayload
			if payload == nil {
				payload = map[string]any{"commit": map[string]any{"sha": currentSHA}}
			}
			writeJSON(t, writer, payload)
		default:
			t.Errorf("unexpected GitHub path: %s", request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func writeJSON(t *testing.T, writer http.ResponseWriter, payload any) {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = writer.Write(encoded)
}

func options(server *httptest.Server) githubactions.Options {
	return githubactions.Options{
		Repository: "acme/service",
		Branch:     "main",
		Workflow:   "ci.yml",
		APIBaseURL: server.URL,
	}
}

func TestGateReturnsImmutableSHAForCurrentSuccessfulRun(t *testing.T) {
	state := &fixture{}
	server := state.server(t)
	verification, err := githubactions.VerifyLatestWorkflow(context.Background(), options(server))
	if err != nil {
		t.Fatal(err)
	}
	if verification.Result.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", verification.Result.Verdict)
	}
	if verification.VerifiedSHA == nil || *verification.VerifiedSHA != currentSHA {
		t.Fatalf("verifiedSha = %v", verification.VerifiedSHA)
	}
	if verification.WorkflowRun == nil || verification.WorkflowRun.HeadSHA != currentSHA {
		t.Fatalf("workflowRun = %+v", verification.WorkflowRun)
	}
	if verification.WorkflowRun.ID != 81 || verification.WorkflowRun.WorkflowID != 42 {
		t.Fatalf("workflowRun identifiers = %+v", verification.WorkflowRun)
	}
	if len(verification.Input.Observations) != 2 {
		t.Fatalf("observations = %d", len(verification.Input.Observations))
	}
	if verification.Input.Observations[0].ID == verification.Input.Observations[1].ID {
		t.Fatal("observation identifiers are not unique")
	}

	if len(state.requests) != 2 {
		t.Fatalf("requests = %d", len(state.requests))
	}
	runsRequest := state.requests[0]
	for _, expected := range []string{
		"branch=main",
		"event=push",
		"status=completed",
		"exclude_pull_requests=true",
		"per_page=1",
	} {
		if !strings.Contains(runsRequest.query, expected) {
			t.Fatalf("query %q is missing %q", runsRequest.query, expected)
		}
	}
	if runsRequest.accept != "application/vnd.github+json" ||
		runsRequest.userAgent != "worldcut" ||
		runsRequest.apiVersion != "2022-11-28" {
		t.Fatalf("request headers = %+v", runsRequest)
	}
	if runsRequest.authorization != "" {
		t.Fatalf("unauthenticated request sent an Authorization header: %q", runsRequest.authorization)
	}
	if !strings.HasSuffix(state.requests[1].path, "/branches/main") {
		t.Fatalf("branch path = %s", state.requests[1].path)
	}
}

func TestGateRejectsRunForOlderBranchHead(t *testing.T) {
	state := &fixture{runs: []any{run(map[string]any{"head_sha": staleSHA})}}
	verification, err := githubactions.VerifyLatestWorkflow(context.Background(), options(state.server(t)))
	if err != nil {
		t.Fatal(err)
	}
	if verification.Result.Verdict != "CONTRACT_VIOLATED" {
		t.Fatalf("verdict = %s", verification.Result.Verdict)
	}
	if verification.VerifiedSHA != nil {
		t.Fatalf("verifiedSha = %v", *verification.VerifiedSHA)
	}
}

func TestGateRejectsLatestCompletedFailedRun(t *testing.T) {
	state := &fixture{runs: []any{run(map[string]any{"conclusion": "failure"})}}
	verification, err := githubactions.VerifyLatestWorkflow(context.Background(), options(state.server(t)))
	if err != nil {
		t.Fatal(err)
	}
	if verification.Result.Verdict != "CONTRACT_VIOLATED" {
		t.Fatalf("verdict = %s", verification.Result.Verdict)
	}
	found := false
	for _, requirement := range verification.Result.RequirementResults {
		if requirement.RequirementID == "workflow-conclusion-success" {
			found = true
			if requirement.Status != "VIOLATED" {
				t.Fatalf("conclusion requirement status = %s", requirement.Status)
			}
		}
	}
	if !found {
		t.Fatal("the conclusion requirement was not evaluated")
	}
}

func TestGateTreatsNoCompletedPushRunAsInsufficientEvidence(t *testing.T) {
	state := &fixture{runsOverride: map[string]any{"workflow_runs": []any{}}}
	verification, err := githubactions.VerifyLatestWorkflow(context.Background(), options(state.server(t)))
	if err != nil {
		t.Fatal(err)
	}
	if verification.Result.Verdict != "INSUFFICIENT_EVIDENCE" {
		t.Fatalf("verdict = %s", verification.Result.Verdict)
	}
	if verification.WorkflowRun != nil {
		t.Fatalf("workflowRun = %+v", verification.WorkflowRun)
	}
	if verification.VerifiedSHA != nil {
		t.Fatal("insufficient evidence produced a verified SHA")
	}
}

func TestGateReportsAPIErrors(t *testing.T) {
	state := &fixture{status: http.StatusForbidden, responseBody: "rate limited"}
	_, err := githubactions.VerifyLatestWorkflow(context.Background(), options(state.server(t)))
	if worldcut.ErrorCode(err) != worldcut.GitHubAPIErrorCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
	if !strings.Contains(err.Error(), "403") || !strings.Contains(err.Error(), "rate limited") {
		t.Fatalf("error message = %s", err.Error())
	}
}

func TestGateNeverLeaksTheToken(t *testing.T) {
	const token = "ghp_supersecrettokenvalue"
	state := &fixture{status: http.StatusUnauthorized, responseBody: "bad credentials"}
	server := state.server(t)
	gateOptions := options(server)
	gateOptions.Token = token
	_, err := githubactions.VerifyLatestWorkflow(context.Background(), gateOptions)
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Contains(err.Error(), token) {
		t.Fatalf("token leaked into the error: %s", err.Error())
	}
	if state.requests[0].authorization != "Bearer "+token {
		t.Fatalf("Authorization header = %q", state.requests[0].authorization)
	}
}

func TestGateRejectsAdversarialResponses(t *testing.T) {
	cases := map[string]*fixture{
		"foreign repository": {runs: []any{run(map[string]any{
			"head_repository": map[string]any{"full_name": "fork/service"},
		})}},
		"missing head repository": {runs: []any{run(nil, "head_repository")}},
		"wrong branch":            {runs: []any{run(map[string]any{"head_branch": "release"})}},
		"wrong event":             {runs: []any{run(map[string]any{"event": "schedule"})}},
		"incomplete status":       {runs: []any{run(map[string]any{"status": "in_progress"})}},
		"short head sha":          {runs: []any{run(map[string]any{"head_sha": "abc123"})}},
		"non-hex head sha": {runs: []any{run(map[string]any{
			"head_sha": strings.Repeat("z", 40),
		})}},
		"unsafe run id":      {runs: []any{run(map[string]any{"id": json.Number("9007199254740992")})}},
		"fractional run id":  {runs: []any{run(map[string]any{"id": 1.5})}},
		"string run id":      {runs: []any{run(map[string]any{"id": "81"})}},
		"missing conclusion": {runs: []any{run(nil, "conclusion")}},
		"empty html url":     {runs: []any{run(map[string]any{"html_url": ""})}},
		"run is not an object": {runsOverride: map[string]any{
			"workflow_runs": []any{"not-a-run"},
		}},
		"workflow runs is not an array": {runsOverride: map[string]any{"workflow_runs": 5}},
		"response is not an object":     {runsOverride: []any{}},
		"branch is not an object":       {branchPayload: "not-a-branch"},
		"branch commit missing":         {branchPayload: map[string]any{}},
		"branch sha is short": {branchPayload: map[string]any{
			"commit": map[string]any{"sha": "abc"},
		}},
	}
	for name, state := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := githubactions.VerifyLatestWorkflow(context.Background(), options(state.server(t)))
			if worldcut.ErrorCode(err) != worldcut.GitHubResponseInvalidCode {
				t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
			}
		})
	}
}

func TestGateRejectsInvalidJSON(t *testing.T) {
	for name, body := range map[string]string{
		"truncated object": "{not json",
		"trailing content": `{"workflow_runs":[]} {"workflow_runs":[]}`,
		"empty body":       "",
		"html error page":  "<html>rate limited</html>",
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				_, _ = writer.Write([]byte(body))
			}))
			defer server.Close()
			_, err := githubactions.VerifyLatestWorkflow(context.Background(), options(server))
			if worldcut.ErrorCode(err) != worldcut.GitHubResponseInvalidCode {
				t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
			}
		})
	}
}

func TestGateBoundsResponseBodies(t *testing.T) {
	state := &fixture{oversized: true}
	_, err := githubactions.VerifyLatestWorkflow(context.Background(), options(state.server(t)))
	if worldcut.ErrorCode(err) != worldcut.GitHubResponseInvalidCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
	if !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("error message = %s", err.Error())
	}
}

func TestGateValidatesOptions(t *testing.T) {
	cases := map[string]githubactions.Options{
		"empty repository":      {Repository: "", Branch: "main", Workflow: "ci.yml"},
		"repository path":       {Repository: "acme/service/extra", Branch: "main", Workflow: "ci.yml"},
		"repository space":      {Repository: "acme /service", Branch: "main", Workflow: "ci.yml"},
		"empty branch":          {Repository: "acme/service", Branch: "  ", Workflow: "ci.yml"},
		"display name":          {Repository: "acme/service", Branch: "main", Workflow: "CI"},
		"workflow path":         {Repository: "acme/service", Branch: "main", Workflow: "../ci.yml"},
		"empty workflow":        {Repository: "acme/service", Branch: "main", Workflow: ""},
		"empty api base url":    {Repository: "acme/service", Branch: "main", Workflow: "ci.yml", APIBaseURL: "///"},
		"relative api base url": {Repository: "acme/service", Branch: "main", Workflow: "ci.yml", APIBaseURL: "/api/v3"},
		"api base user info":    {Repository: "acme/service", Branch: "main", Workflow: "ci.yml", APIBaseURL: "https://user:secret@example.invalid"},
		"api base query":        {Repository: "acme/service", Branch: "main", Workflow: "ci.yml", APIBaseURL: "https://example.invalid?token=secret"},
		"non-numeric workflow":  {Repository: "acme/service", Branch: "main", Workflow: "12a"},
	}
	for name, gateOptions := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := githubactions.VerifyLatestWorkflow(context.Background(), gateOptions)
			if worldcut.ErrorCode(err) != worldcut.GitHubResponseInvalidCode {
				t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
			}
		})
	}
}

func TestGateAcceptsNumericWorkflowIdentifiers(t *testing.T) {
	state := &fixture{}
	server := state.server(t)
	gateOptions := options(server)
	gateOptions.Workflow = "42"
	verification, err := githubactions.VerifyLatestWorkflow(context.Background(), gateOptions)
	if err != nil {
		t.Fatal(err)
	}
	if verification.Result.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", verification.Result.Verdict)
	}
	if !strings.Contains(state.requests[0].path, "/actions/workflows/42/runs") {
		t.Fatalf("path = %s", state.requests[0].path)
	}
}

func TestGateEscapesBranchNames(t *testing.T) {
	state := &fixture{
		runs:          []any{run(map[string]any{"head_branch": "release/1.0"})},
		branchPayload: map[string]any{"commit": map[string]any{"sha": currentSHA}},
	}
	server := state.server(t)
	gateOptions := options(server)
	gateOptions.Branch = "release/1.0"
	verification, err := githubactions.VerifyLatestWorkflow(context.Background(), gateOptions)
	if err != nil {
		t.Fatal(err)
	}
	if verification.Result.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", verification.Result.Verdict)
	}
	if !strings.Contains(state.requests[0].query, "branch=release%2F1.0") {
		t.Fatalf("query = %s", state.requests[0].query)
	}
	if state.requests[1].escapedPath != "/repos/acme/service/branches/release%2F1.0" {
		t.Fatalf("branch path = %s", state.requests[1].escapedPath)
	}
}

func TestGateHonorsContextCancellation(t *testing.T) {
	state := &fixture{}
	server := state.server(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := githubactions.VerifyLatestWorkflow(ctx, options(server))
	if worldcut.ErrorCode(err) != worldcut.GitHubAPIErrorCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation was not preserved: %v", err)
	}
}

func TestGateRefusesRedirects(t *testing.T) {
	state := &fixture{}
	target := state.server(t)
	redirect := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL+request.URL.Path, http.StatusFound)
	}))
	defer redirect.Close()
	_, err := githubactions.VerifyLatestWorkflow(context.Background(), options(redirect))
	if worldcut.ErrorCode(err) != worldcut.GitHubAPIErrorCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
	if !errors.Is(err, githubactions.ErrRedirectNotFollowed) {
		t.Fatalf("redirect error was not preserved: %v", err)
	}
}

func TestGateRefusesRedirectsWithInjectedClient(t *testing.T) {
	state := &fixture{}
	target := state.server(t)
	redirect := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL+request.URL.Path, http.StatusFound)
	}))
	defer redirect.Close()
	gateOptions := options(redirect)
	gateOptions.Client = &http.Client{}
	_, err := githubactions.VerifyLatestWorkflow(context.Background(), gateOptions)
	if worldcut.ErrorCode(err) != worldcut.GitHubAPIErrorCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
	if !errors.Is(err, githubactions.ErrRedirectNotFollowed) {
		t.Fatalf("redirect error was not preserved: %v", err)
	}
}

func TestGateClosesResponseReturnedWithError(t *testing.T) {
	body := &trackedBody{}
	gateOptions := githubactions.Options{
		Repository: "acme/service",
		Branch:     "main",
		Workflow:   "ci.yml",
		Client: responseErrorClient{
			response: &http.Response{
				StatusCode: http.StatusTemporaryRedirect,
				Header:     http.Header{},
				Body:       body,
			},
			err: errors.New("redirect refused"),
		},
	}
	_, err := githubactions.VerifyLatestWorkflow(context.Background(), gateOptions)
	if worldcut.ErrorCode(err) != worldcut.GitHubAPIErrorCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
	if !body.closed {
		t.Fatal("response body returned with an error was not closed")
	}
}

func TestGateRejectsAChangedResponseURL(t *testing.T) {
	body := &trackedBody{}
	finalRequest, err := http.NewRequest(
		http.MethodGet,
		"https://other.example.invalid/runs",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	gateOptions := githubactions.Options{
		Repository: "acme/service",
		Branch:     "main",
		Workflow:   "ci.yml",
		Client: responseErrorClient{
			response: &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{},
				Body:       body,
				Request:    finalRequest,
			},
		},
	}
	_, err = githubactions.VerifyLatestWorkflow(context.Background(), gateOptions)
	if worldcut.ErrorCode(err) != worldcut.GitHubAPIErrorCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
	if !errors.Is(err, githubactions.ErrRedirectNotFollowed) {
		t.Fatalf("redirect error was not preserved: %v", err)
	}
	if !body.closed {
		t.Fatal("redirected response body was not closed")
	}
}

func TestGateUsesInjectedClockAndIdentifiers(t *testing.T) {
	state := &fixture{}
	server := state.server(t)
	gateOptions := options(server)
	instant := time.Date(2026, 9, 4, 18, 0, 0, 0, time.UTC)
	gateOptions.Clock = func() time.Time { return instant }
	counter := 0
	gateOptions.NewID = func() (string, error) {
		counter++
		return "fixed-" + string(rune('0'+counter)), nil
	}
	verification, err := githubactions.VerifyLatestWorkflow(context.Background(), gateOptions)
	if err != nil {
		t.Fatal(err)
	}
	if verification.Input.Contract.DecisionTime != "2026-09-04T18:00:00.000Z" {
		t.Fatalf("decisionTime = %s", verification.Input.Contract.DecisionTime)
	}
	if verification.Input.Observations[0].ID != "github-head-fixed-1" {
		t.Fatalf("head observation id = %s", verification.Input.Observations[0].ID)
	}
	if verification.Input.Observations[1].ID != "github-run-fixed-2" {
		t.Fatalf("run observation id = %s", verification.Input.Observations[1].ID)
	}

	gateOptions.NewID = func() (string, error) { return "", errors.New("no entropy") }
	if _, err := githubactions.VerifyLatestWorkflow(context.Background(), gateOptions); err == nil {
		t.Fatal("a failing identifier source was accepted")
	}
}

func TestGateVerificationInputIsIndependentlyVerifiable(t *testing.T) {
	state := &fixture{}
	verification, err := githubactions.VerifyLatestWorkflow(
		context.Background(),
		options(state.server(t)),
	)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := worldcut.VerifyDecisionContract(verification.Input)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.VerificationRecordDigest != verification.Result.VerificationRecordDigest {
		t.Fatal("the returned input does not reproduce the returned result")
	}
}

func TestEvidenceCoverageSummarizesHistory(t *testing.T) {
	state := &fixture{runs: []any{
		run(nil),
		run(map[string]any{"id": 80, "conclusion": "failure"}),
		run(map[string]any{"id": 79, "conclusion": "success"}),
	}}
	server := state.server(t)
	coverage, err := githubactions.InspectWorkflowEvidence(context.Background(), options(server), 20)
	if err != nil {
		t.Fatal(err)
	}
	if coverage.InspectedRuns != 3 || coverage.CompleteEvidenceRuns != 3 {
		t.Fatalf("coverage = %+v", coverage)
	}
	if coverage.EvidenceCoverage != 1 {
		t.Fatalf("evidenceCoverage = %v", coverage.EvidenceCoverage)
	}
	if coverage.Conclusions["success"] != 2 || coverage.Conclusions["failure"] != 1 {
		t.Fatalf("conclusions = %+v", coverage.Conclusions)
	}
	if !strings.Contains(state.requests[0].query, "per_page=20") {
		t.Fatalf("query = %s", state.requests[0].query)
	}
}

func TestEvidenceCoverageHandlesNoRuns(t *testing.T) {
	state := &fixture{runsOverride: map[string]any{"workflow_runs": []any{}}}
	coverage, err := githubactions.InspectWorkflowEvidence(
		context.Background(),
		options(state.server(t)),
		5,
	)
	if err != nil {
		t.Fatal(err)
	}
	if coverage.InspectedRuns != 0 || coverage.EvidenceCoverage != 0 {
		t.Fatalf("coverage = %+v", coverage)
	}
	if len(coverage.Conclusions) != 0 {
		t.Fatalf("conclusions = %+v", coverage.Conclusions)
	}
}

func TestEvidenceCoverageBoundsHistoryLimit(t *testing.T) {
	state := &fixture{}
	server := state.server(t)
	for _, limit := range []int{0, -1, 101} {
		_, err := githubactions.InspectWorkflowEvidence(context.Background(), options(server), limit)
		if worldcut.ErrorCode(err) != worldcut.GitHubResponseInvalidCode {
			t.Fatalf("limit %d error = %v (code %q)", limit, err, worldcut.ErrorCode(err))
		}
	}
}
