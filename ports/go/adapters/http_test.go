package adapters_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	"github.com/Jason-Doyle/WorldCut/ports/go/adapters"
)

type stubBody struct {
	closed *atomic.Bool
	read   *atomic.Bool
}

func (b stubBody) Read(p []byte) (int, error) {
	b.read.Store(true)
	return 0, io.EOF
}

func (b stubBody) Close() error {
	b.closed.Store(true)
	return nil
}

type stubClient struct {
	response *http.Response
	err      error
	request  *http.Request
}

func (c *stubClient) Do(request *http.Request) (*http.Response, error) {
	c.request = request
	return c.response, c.err
}

func headerResponse(status int, header http.Header, body io.ReadCloser) *http.Response {
	if header == nil {
		header = http.Header{}
	}
	return &http.Response{StatusCode: status, Header: header, Body: body}
}

func fixtureResource() worldcut.ResourceIdentity {
	return worldcut.ResourceIdentity{
		Provider: "fixture",
		Account:  "test",
		Kind:     "document",
		Key:      "one",
	}
}

func TestCaptureHTTPObservationPromotesStrongETag(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodHead {
			t.Errorf("method = %s", request.Method)
		}
		writer.Header().Set("ETag", `"fixture-v3"`)
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	observation, err := adapters.CaptureHTTPObservation(context.Background(), adapters.HTTPObservationOptions{
		URL:      server.URL + "/resource",
		Role:     "http-resource",
		Resource: fixtureResource(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if observation.Witness.Version == nil || *observation.Witness.Version != `"fixture-v3"` {
		t.Fatalf("version = %v", observation.Witness.Version)
	}
	value, ok := observation.Value.(map[string]any)
	if !ok {
		t.Fatalf("value = %#v", observation.Value)
	}
	if value["status"] != 200 || value["ok"] != true ||
		value["etag"] != `"fixture-v3"` || value["lastModified"] != nil {
		t.Fatalf("value = %#v", value)
	}
	if !strings.HasPrefix(observation.ID, "http-") {
		t.Fatalf("identifier = %s", observation.ID)
	}
}

func TestCaptureHTTPObservationClosesUnreadBodies(t *testing.T) {
	for _, method := range []string{"", http.MethodGet, http.MethodHead} {
		closed := &atomic.Bool{}
		read := &atomic.Bool{}
		client := &stubClient{
			response: headerResponse(
				http.StatusOK,
				http.Header{"Etag": []string{`"stream-v1"`}},
				stubBody{closed: closed, read: read},
			),
		}
		observation, err := adapters.CaptureHTTPObservation(
			context.Background(),
			adapters.HTTPObservationOptions{
				URL:      "https://example.invalid/resource",
				Method:   method,
				Role:     "http-resource",
				Resource: fixtureResource(),
				Client:   client,
			},
		)
		if err != nil {
			t.Fatal(err)
		}
		if observation.Witness.Version == nil || *observation.Witness.Version != `"stream-v1"` {
			t.Fatalf("version = %v", observation.Witness.Version)
		}
		if !closed.Load() {
			t.Fatalf("response body was not closed for method %q", method)
		}
		if read.Load() {
			t.Fatalf("response body was read for method %q", method)
		}
		expectedMethod := method
		if expectedMethod == "" {
			expectedMethod = http.MethodHead
		}
		if client.request.Method != expectedMethod {
			t.Fatalf("request method = %s", client.request.Method)
		}
	}
}

func TestCaptureHTTPObservationDoesNotPromoteWeakValidators(t *testing.T) {
	cases := map[string]http.Header{
		"last modified only": {"Last-Modified": []string{"Wed, 02 Sep 2026 20:00:00 GMT"}},
		"weak etag":          {"Etag": []string{`W/"semantic-v1"`}},
		"wildcard etag":      {"Etag": []string{"*"}},
		"unquoted etag":      {"Etag": []string{"not-quoted"}},
		"empty etag":         {"Etag": []string{""}},
		"quote only":         {"Etag": []string{`"`}},
		"embedded quote":     {"Etag": []string{`"a"b"`}},
		"control character":  {"Etag": []string{"\"a\tb\""}},
		"above latin-1":      {"Etag": []string{`"€"`}},
		"duplicate etag":     {"Etag": []string{`"one"`, `"two"`}},
	}
	for name, header := range cases {
		t.Run(name, func(t *testing.T) {
			closed := &atomic.Bool{}
			read := &atomic.Bool{}
			observation, err := adapters.CaptureHTTPObservation(
				context.Background(),
				adapters.HTTPObservationOptions{
					URL:      "https://example.invalid/resource",
					Role:     "http-resource",
					Resource: fixtureResource(),
					Client: &stubClient{response: headerResponse(
						http.StatusOK,
						header,
						stubBody{closed: closed, read: read},
					)},
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			if observation.Witness.Version != nil {
				t.Fatalf("version = %q", *observation.Witness.Version)
			}
			value := observation.Value.(map[string]any)
			if name == "duplicate etag" && value["etag"] != `"one", "two"` {
				t.Fatalf("etag = %#v", value["etag"])
			}
			if header.Get("Last-Modified") != "" && value["lastModified"] != header.Get("Last-Modified") {
				t.Fatalf("lastModified = %#v", value["lastModified"])
			}
		})
	}
}

func TestCaptureHTTPObservationRecordsFailureStatus(t *testing.T) {
	observation, err := adapters.CaptureHTTPObservation(
		context.Background(),
		adapters.HTTPObservationOptions{
			URL:      "https://example.invalid/resource",
			Role:     "http-resource",
			Resource: fixtureResource(),
			Client: &stubClient{response: headerResponse(
				http.StatusNotFound,
				http.Header{},
				stubBody{closed: &atomic.Bool{}, read: &atomic.Bool{}},
			)},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	value := observation.Value.(map[string]any)
	if value["status"] != 404 || value["ok"] != false {
		t.Fatalf("value = %#v", value)
	}
	if observation.Witness.Version != nil {
		t.Fatal("a failed response must not carry an exact version")
	}
}

func TestCaptureHTTPObservationRefusesRedirects(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("ETag", `"redirected"`)
		writer.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL, http.StatusFound)
	}))
	defer server.Close()

	_, err := adapters.CaptureHTTPObservation(context.Background(), adapters.HTTPObservationOptions{
		URL:      server.URL + "/resource",
		Role:     "http-resource",
		Resource: fixtureResource(),
	})
	if err == nil || !errors.Is(err, adapters.ErrRedirectNotFollowed) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCaptureHTTPObservationRefusesRedirectsWithInjectedClient(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL, http.StatusFound)
	}))
	defer server.Close()

	_, err := adapters.CaptureHTTPObservation(context.Background(), adapters.HTTPObservationOptions{
		URL:      server.URL + "/resource",
		Role:     "http-resource",
		Resource: fixtureResource(),
		Client:   &http.Client{},
	})
	if err == nil || !errors.Is(err, adapters.ErrRedirectNotFollowed) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCaptureHTTPObservationValidatesOptions(t *testing.T) {
	cases := map[string]adapters.HTTPObservationOptions{
		"missing url":      {Role: "role", Resource: fixtureResource()},
		"missing role":     {URL: "https://example.invalid", Resource: fixtureResource()},
		"missing resource": {URL: "https://example.invalid", Role: "role"},
		"unsupported method": {
			URL:      "https://example.invalid",
			Role:     "role",
			Resource: fixtureResource(),
			Method:   "POST",
		},
	}
	for name, options := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := adapters.CaptureHTTPObservation(context.Background(), options); err == nil {
				t.Fatal("expected a rejection")
			}
		})
	}
}

func TestCaptureHTTPObservationReportsTransportFailures(t *testing.T) {
	_, err := adapters.CaptureHTTPObservation(context.Background(), adapters.HTTPObservationOptions{
		URL:      "https://example.invalid/resource",
		Role:     "http-resource",
		Resource: fixtureResource(),
		Client:   &stubClient{err: errors.New("dial failed")},
	})
	if err == nil || !strings.Contains(err.Error(), "dial failed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCaptureHTTPObservationClosesResponseReturnedWithError(t *testing.T) {
	closed := &atomic.Bool{}
	_, err := adapters.CaptureHTTPObservation(context.Background(), adapters.HTTPObservationOptions{
		URL:      "https://example.invalid/resource",
		Role:     "http-resource",
		Resource: fixtureResource(),
		Client: &stubClient{
			response: headerResponse(
				http.StatusTemporaryRedirect,
				http.Header{},
				stubBody{closed: closed, read: &atomic.Bool{}},
			),
			err: errors.New("redirect refused"),
		},
	})
	if err == nil || !strings.Contains(err.Error(), "redirect refused") {
		t.Fatalf("unexpected error: %v", err)
	}
	if !closed.Load() {
		t.Fatal("response body returned with an error was not closed")
	}
}

func TestCaptureHTTPObservationRejectsAChangedResponseURL(t *testing.T) {
	closed := &atomic.Bool{}
	response := headerResponse(
		http.StatusOK,
		http.Header{"Etag": []string{`"redirected"`}},
		stubBody{closed: closed, read: &atomic.Bool{}},
	)
	response.Request, _ = http.NewRequest(
		http.MethodHead,
		"https://other.example.invalid/resource",
		nil,
	)
	_, err := adapters.CaptureHTTPObservation(context.Background(), adapters.HTTPObservationOptions{
		URL:      "https://example.invalid/resource",
		Role:     "http-resource",
		Resource: fixtureResource(),
		Client:   &stubClient{response: response},
	})
	if err == nil || !errors.Is(err, adapters.ErrRedirectNotFollowed) {
		t.Fatalf("unexpected error: %v", err)
	}
	if !closed.Load() {
		t.Fatal("redirected response body was not closed")
	}
}

func TestCaptureHTTPObservationHonorsContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := adapters.CaptureHTTPObservation(ctx, adapters.HTTPObservationOptions{
		URL:      server.URL,
		Role:     "http-resource",
		Resource: fixtureResource(),
	})
	if err == nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCaptureHTTPObservationRejectsNonUTF8Headers(t *testing.T) {
	_, err := adapters.CaptureHTTPObservation(context.Background(), adapters.HTTPObservationOptions{
		URL:      "https://example.invalid/resource",
		Role:     "http-resource",
		Resource: fixtureResource(),
		Client: &stubClient{response: headerResponse(
			http.StatusOK,
			http.Header{"Etag": []string{"\"\xff\""}},
			stubBody{closed: &atomic.Bool{}, read: &atomic.Bool{}},
		)},
	})
	if err == nil || !strings.Contains(err.Error(), "valid UTF-8") {
		t.Fatalf("unexpected error: %v", err)
	}
}
