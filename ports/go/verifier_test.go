package worldcut

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestValueAtPathUsesCanonicalArrayIndices(t *testing.T) {
	value := []any{"zero", "one"}
	for _, path := range []string{"00", "+1", "-1", "1.0", "length", "2"} {
		if _, found := valueAtPath(value, []string{path}); found {
			t.Fatalf("non-canonical array path %q was found", path)
		}
	}
	actual, found := valueAtPath(value, []string{"1"})
	if !found || actual != "one" {
		t.Fatalf("canonical array index failed: %v, %v", actual, found)
	}
}

func TestViolationDominatesUnknown(t *testing.T) {
	source := []byte(`{
	  "protocolVersion":"0.1",
	  "contract":{
	    "id":"test","version":"1","decisionTime":"2026-01-01T00:00:00.000Z",
	    "assumptions":{"clockModel":"trusted_normalized","intervalModel":"half_open","metadataModel":"honest_but_possibly_incomplete"},
	    "requirements":[
	      {"id":"missing","description":"Missing","type":"value_equals","role":"missing","path":["x"],"expected":true},
	      {"id":"wrong","description":"Wrong","type":"value_equals","role":"present","path":["x"],"expected":true}
	    ]
	  },
	  "observations":[{
	    "id":"observation","role":"present",
	    "resource":{"provider":"p","account":"a","kind":"k","key":"x"},
	    "value":{"x":false},"observedAt":"2026-01-01T00:00:00.000Z","acquisitionCost":1,
	    "witness":{"provenance":"provider_asserted"}
	  }]
	}`)
	result, err := VerifyJSON(source)
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != "CONTRACT_VIOLATED" {
		t.Fatalf("verdict = %s", result.Verdict)
	}
}

func TestResultMutationDoesNotAffectParsedInput(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("testdata", "conformance", "0.1", "verification-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	vectors, err := decodeJSON(source)
	if err != nil {
		t.Fatal(err)
	}
	firstCase := vectors.(map[string]any)["cases"].([]any)[0].(map[string]any)
	inputSource, err := json.Marshal(firstCase["input"])
	if err != nil {
		t.Fatal(err)
	}
	input, err := ParseInput(inputSource)
	if err != nil {
		t.Fatal(err)
	}
	first, err := Verify(input)
	if err != nil {
		t.Fatal(err)
	}
	first.RequirementResults[0].Details.(map[string]any)["mutated"] = true

	second, err := Verify(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.VerificationRecordDigest != second.VerificationRecordDigest {
		t.Fatal("result mutation changed a later verification digest")
	}
	if _, exists := second.RequirementResults[0].Details.(map[string]any)["mutated"]; exists {
		t.Fatal("result mutation leaked into parsed input")
	}
}
