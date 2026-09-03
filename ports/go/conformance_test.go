package worldcut

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"testing"
)

func moduleRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate conformance tests")
	}
	return filepath.Dir(file)
}

func readVectorObject(t *testing.T, name string) map[string]any {
	t.Helper()
	source, err := os.ReadFile(filepath.Join(moduleRoot(t), "testdata", "conformance", "0.1", name))
	if err != nil {
		t.Fatal(err)
	}
	value, err := decodeJSON(source)
	if err != nil {
		t.Fatal(err)
	}
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s is not a JSON object", name)
	}
	return record
}

func vectorCases(t *testing.T, name string) []any {
	t.Helper()
	record := readVectorObject(t, name)
	cases, ok := record["cases"].([]any)
	if !ok {
		t.Fatalf("%s does not contain cases", name)
	}
	return cases
}

func semanticResult(t *testing.T, result *VerificationResult) any {
	t.Helper()
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	value, err := decodeJSON(encoded)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func firstDifference(path string, actual, expected any) string {
	if reflect.DeepEqual(actual, expected) {
		return ""
	}
	actualMap, actualIsMap := actual.(map[string]any)
	expectedMap, expectedIsMap := expected.(map[string]any)
	if actualIsMap && expectedIsMap {
		keys := make([]string, 0, len(actualMap)+len(expectedMap))
		seen := map[string]bool{}
		for key := range actualMap {
			seen[key] = true
			keys = append(keys, key)
		}
		for key := range expectedMap {
			if !seen[key] {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		for _, key := range keys {
			if difference := firstDifference(path+"."+key, actualMap[key], expectedMap[key]); difference != "" {
				return difference
			}
		}
	}
	actualArray, actualIsArray := actual.([]any)
	expectedArray, expectedIsArray := expected.([]any)
	if actualIsArray && expectedIsArray {
		if len(actualArray) != len(expectedArray) {
			return path + ": array lengths differ"
		}
		for i := range actualArray {
			if difference := firstDifference(fmt.Sprintf("%s[%d]", path, i), actualArray[i], expectedArray[i]); difference != "" {
				return difference
			}
		}
	}
	return fmt.Sprintf("%s: actual=%#v expected=%#v", path, actual, expected)
}

func TestVerificationVectors(t *testing.T) {
	for _, rawCase := range vectorCases(t, "verification-vectors.json") {
		vector := rawCase.(map[string]any)
		name := vector["name"].(string)
		t.Run(name, func(t *testing.T) {
			input, err := json.Marshal(vector["input"])
			if err != nil {
				t.Fatal(err)
			}
			result, err := VerifyJSON(input)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(semanticResult(t, result), vector["expected"]) {
				t.Fatal(firstDifference("result", semanticResult(t, result), vector["expected"]))
			}
			expected := vector["expected"].(map[string]any)
			if result.VerificationRecordDigest != expected["verificationRecordDigest"] {
				t.Fatalf("digest = %s, want %s", result.VerificationRecordDigest, expected["verificationRecordDigest"])
			}
		})
	}
}

func TestInvalidVectors(t *testing.T) {
	for _, rawCase := range vectorCases(t, "invalid-vectors.json") {
		vector := rawCase.(map[string]any)
		name := vector["name"].(string)
		t.Run(name, func(t *testing.T) {
			input, err := json.Marshal(vector["input"])
			if err != nil {
				t.Fatal(err)
			}
			_, err = VerifyJSON(input)
			if err == nil {
				t.Fatal("invalid input unexpectedly verified")
			}
			if code := ErrorCode(err); code != vector["expectedErrorCode"] {
				t.Fatalf("error code = %q, want %q (%v)", code, vector["expectedErrorCode"], err)
			}
		})
	}
}

func TestCanonicalizationVectors(t *testing.T) {
	for _, rawCase := range vectorCases(t, "canonicalization-vectors.json") {
		vector := rawCase.(map[string]any)
		name := vector["name"].(string)
		t.Run(name, func(t *testing.T) {
			canonical, err := CanonicalJSON(vector["value"])
			if err != nil {
				t.Fatal(err)
			}
			if string(canonical) != vector["expectedCanonicalJson"] {
				t.Fatalf("canonical JSON = %s, want %s", canonical, vector["expectedCanonicalJson"])
			}
			digest, err := SHA256Digest(vector["value"])
			if err != nil {
				t.Fatal(err)
			}
			if digest != vector["expectedSha256"] {
				t.Fatalf("digest = %s, want %s", digest, vector["expectedSha256"])
			}
		})
	}
}

func TestRawVectors(t *testing.T) {
	for _, rawCase := range vectorCases(t, "raw-vectors.json") {
		vector := rawCase.(map[string]any)
		name := vector["name"].(string)
		t.Run(name, func(t *testing.T) {
			source, err := os.ReadFile(filepath.Join(moduleRoot(t), "testdata", "conformance", "0.1", filepath.FromSlash(vector["file"].(string))))
			if err != nil {
				t.Fatal(err)
			}
			_, err = VerifyJSON(source)
			if err == nil {
				t.Fatal("raw invalid input unexpectedly verified")
			}
			outcome := ErrorCode(err)
			if outcome == "" {
				outcome = "PARSE_ERROR"
			}
			accepted := false
			for _, candidate := range vector["acceptedOutcomes"].([]any) {
				if outcome == candidate {
					accepted = true
				}
			}
			if !accepted {
				t.Fatalf("outcome = %s, accepted = %v", outcome, vector["acceptedOutcomes"])
			}
		})
	}
}

func TestConformanceManifest(t *testing.T) {
	manifest := readVectorObject(t, "manifest.json")
	files := manifest["files"].(map[string]any)
	for name, rawMetadata := range files {
		metadata := rawMetadata.(map[string]any)
		path := filepath.Join(moduleRoot(t), "testdata", "conformance", "0.1", filepath.FromSlash(name))
		source, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(source)
		if actual := hex.EncodeToString(sum[:]); actual != metadata["sha256"] {
			t.Errorf("%s SHA-256 = %s, want %s", name, actual, metadata["sha256"])
		}
		if expectedCases, exists := metadata["cases"]; exists {
			vector := readVectorObject(t, name)
			actualCases := len(vector["cases"].([]any))
			if float64(actualCases) != expectedCases {
				t.Errorf("%s cases = %d, want %v", name, actualCases, expectedCases)
			}
		}
		if expectedBytes, exists := metadata["bytes"]; exists && float64(len(source)) != expectedBytes {
			t.Errorf("%s bytes = %d, want %v", name, len(source), expectedBytes)
		}
	}
}
