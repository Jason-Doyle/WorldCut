package adapters

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
)

// HTTPDoer performs a single HTTP request. *http.Client satisfies it.
type HTTPDoer interface {
	Do(request *http.Request) (*http.Response, error)
}

// HTTPObservationOptions describes one HTTP resource to capture.
type HTTPObservationOptions struct {
	// URL is the absolute resource URL.
	URL string
	// Role binds the observation to a contract role.
	Role string
	// Resource is the caller-declared resource identity.
	Resource worldcut.ResourceIdentity
	// Method is "HEAD" (the default) or "GET".
	Method string
	// AcquisitionCost defaults to 1.
	AcquisitionCost *int64
	// Client defaults to a client that refuses to follow redirects.
	Client HTTPDoer
	// Clock defaults to time.Now.
	Clock func() time.Time
	// NewID defaults to a random version 4 UUID.
	NewID func() (string, error)
}

// ErrRedirectNotFollowed reports that a response redirected. WorldCut never
// follows a redirect because the redirected resource is a different resource.
var ErrRedirectNotFollowed = errors.New("HTTP redirects are not followed")

func defaultHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return ErrRedirectNotFollowed
		},
	}
}

func redirectRefusingHTTPClient(client HTTPDoer) HTTPDoer {
	if client == nil {
		return defaultHTTPClient()
	}
	if standardClient, ok := client.(*http.Client); ok {
		cloned := *standardClient
		cloned.CheckRedirect = func(*http.Request, []*http.Request) error {
			return ErrRedirectNotFollowed
		}
		return &cloned
	}
	return client
}

func closeResponseBody(response *http.Response) {
	if response != nil && response.Body != nil {
		_ = response.Body.Close()
	}
}

// strongETag returns the ETag when it is a syntactically valid strong
// validator. Weak validators, the wildcard, and unquoted values are not exact
// versions and are never promoted.
func strongETag(value string) (string, bool) {
	candidate := strings.TrimSpace(value)
	if len(candidate) < 2 || candidate[0] != '"' || candidate[len(candidate)-1] != '"' {
		return "", false
	}
	for _, character := range candidate[1 : len(candidate)-1] {
		if character == 0x21 ||
			(character >= 0x23 && character <= 0x7e) ||
			(character >= 0x80 && character <= 0xff) {
			continue
		}
		return "", false
	}
	return candidate, true
}

func responseMatchesRequest(response *http.Response, request *http.Request) bool {
	if response.Request == nil || response.Request.URL == nil {
		return true
	}
	return response.Request.URL.String() == request.URL.String()
}

// CaptureHTTPObservation records the status and validators of one HTTP
// resource.
//
// Only a syntactically valid strong ETag becomes an exact version witness.
// The status, ok flag, raw ETag, and Last-Modified header stay descriptive
// values; Last-Modified is never treated as an exact version. The response
// body is always closed and never read.
func CaptureHTTPObservation(ctx context.Context, options HTTPObservationOptions) (worldcut.Observation, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireText(options.URL, "url"); err != nil {
		return worldcut.Observation{}, err
	}
	if err := requireText(options.Role, "role"); err != nil {
		return worldcut.Observation{}, err
	}
	if err := requireResource(options.Resource); err != nil {
		return worldcut.Observation{}, err
	}
	method := options.Method
	if method == "" {
		method = http.MethodHead
	}
	if method != http.MethodHead && method != http.MethodGet {
		return worldcut.Observation{}, fmt.Errorf("method %q is not supported; use GET or HEAD", method)
	}
	cost, err := acquisitionCost(options.AcquisitionCost)
	if err != nil {
		return worldcut.Observation{}, err
	}
	id, err := observationID("http", options.NewID)
	if err != nil {
		return worldcut.Observation{}, err
	}

	request, err := http.NewRequestWithContext(ctx, method, options.URL, nil)
	if err != nil {
		return worldcut.Observation{}, fmt.Errorf("build HTTP request for %s: %w", options.URL, err)
	}
	client := redirectRefusingHTTPClient(options.Client)
	response, err := client.Do(request)
	if err != nil {
		closeResponseBody(response)
		return worldcut.Observation{}, fmt.Errorf("HTTP request for %s failed: %w", options.URL, err)
	}
	if response == nil {
		return worldcut.Observation{}, fmt.Errorf("HTTP client returned no response for %s", options.URL)
	}
	if !responseMatchesRequest(response, request) {
		closeResponseBody(response)
		return worldcut.Observation{}, fmt.Errorf(
			"HTTP request for %s failed: %w",
			options.URL,
			ErrRedirectNotFollowed,
		)
	}
	// The body is deliberately never read; closing it releases the
	// connection without consuming a resource representation.
	if response.Body != nil {
		defer closeResponseBody(response)
	}

	etag, etagPresent := joinedHeader(response.Header, "ETag")
	lastModified, lastModifiedPresent := joinedHeader(response.Header, "Last-Modified")
	if !utf8.ValidString(etag) || !utf8.ValidString(lastModified) {
		return worldcut.Observation{}, fmt.Errorf("HTTP response headers for %s are not valid UTF-8", options.URL)
	}

	value := map[string]any{
		"status":       response.StatusCode,
		"ok":           response.StatusCode >= 200 && response.StatusCode <= 299,
		"etag":         nullableText(etag, etagPresent),
		"lastModified": nullableText(lastModified, lastModifiedPresent),
	}
	witness := worldcut.ObservationWitness{Provenance: "provider_asserted"}
	if etagPresent {
		if version, ok := strongETag(etag); ok {
			witness.Version = &version
		}
	}
	return worldcut.Observation{
		ID:              id,
		Role:            options.Role,
		Resource:        options.Resource,
		Value:           value,
		ObservedAt:      observedAt(options.Clock),
		AcquisitionCost: cost,
		Witness:         witness,
	}, nil
}

func joinedHeader(header http.Header, name string) (string, bool) {
	values := header.Values(name)
	if len(values) == 0 {
		return "", false
	}
	return strings.Join(values, ", "), true
}

func nullableText(value string, present bool) any {
	if !present {
		return nil
	}
	return value
}
