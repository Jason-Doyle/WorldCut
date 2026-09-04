package worldcut

import (
	"math"
	"strings"
	"testing"
)

// TestDecodeAcceptsFiniteUnderflow locks the behaviour that a JSON number which
// underflows the IEEE-754 double range is a finite zero rather than a protocol
// error. TypeScript is normative here: JSON.parse("1e-400") is 0, and the
// Python and .NET ports agree.
func TestDecodeAcceptsFiniteUnderflow(t *testing.T) {
	for _, testCase := range []struct {
		lexeme   string
		negative bool
	}{
		{"1e-400", false},
		{"-1e-400", true},
		{"1e-1000", false},
		{"-1e-1000", true},
		{"5e-324", false},
		{"-5e-324", true},
		{"0.00000000000000000000000000000000000000000000000000000000001e-400", false},
	} {
		t.Run(testCase.lexeme, func(t *testing.T) {
			decoded, err := decodeJSON([]byte(testCase.lexeme))
			if err != nil {
				t.Fatalf("decodeJSON(%q) = %v", testCase.lexeme, err)
			}
			number, ok := decoded.(float64)
			if !ok {
				t.Fatalf("decodeJSON(%q) produced %T", testCase.lexeme, decoded)
			}
			if math.IsInf(number, 0) || math.IsNaN(number) {
				t.Fatalf("decodeJSON(%q) = %v, want a finite value", testCase.lexeme, number)
			}
			if testCase.negative && !math.Signbit(number) {
				t.Fatalf("decodeJSON(%q) = %v, want a negative value", testCase.lexeme, number)
			}
			if !testCase.negative && math.Signbit(number) {
				t.Fatalf("decodeJSON(%q) = %v, want a non-negative value", testCase.lexeme, number)
			}
		})
	}
}

// TestDecodeRejectsOverflowAndSyntaxErrors keeps the underflow allowance from
// widening into acceptance of infinities or malformed numbers.
func TestDecodeRejectsOverflowAndSyntaxErrors(t *testing.T) {
	for _, lexeme := range []string{
		"1e400",
		"-1e400",
		"1e309",
		"1e99999999999999999999",
		"01",
		"1e",
		"0x1",
		"NaN",
		"Infinity",
		"-Infinity",
		".5",
		"1.",
	} {
		t.Run(lexeme, func(t *testing.T) {
			if _, err := decodeJSON([]byte(lexeme)); err == nil {
				t.Fatalf("decodeJSON(%q) unexpectedly succeeded", lexeme)
			}
		})
	}
}

// TestVerifyAcceptsUnderflowInsideAnObservation proves the allowance reaches the
// public API and that an underflowing lexeme compares equal to zero.
func TestVerifyAcceptsUnderflowInsideAnObservation(t *testing.T) {
	template := `{
	  "protocolVersion":"0.1",
	  "contract":{
	    "id":"underflow","version":"1","decisionTime":"2026-01-01T00:00:00.000Z",
	    "assumptions":{"clockModel":"trusted_normalized","intervalModel":"half_open","metadataModel":"honest_but_possibly_incomplete"},
	    "requirements":[
	      {"id":"tiny","description":"Tiny","type":"value_equals","role":"present","path":["tiny"],"expected":EXPECTED}
	    ]
	  },
	  "observations":[{
	    "id":"observation","role":"present",
	    "resource":{"provider":"p","account":"a","kind":"k","key":"x"},
	    "value":{"tiny":LEXEME},"observedAt":"2026-01-01T00:00:00.000Z","acquisitionCost":1,
	    "witness":{"provenance":"provider_asserted"}
	  }]
	}`

	for _, testCase := range []struct {
		name     string
		lexeme   string
		expected string
		verdict  string
	}{
		{"positive-underflow-equals-zero", "1e-400", "0", "CONTRACT_SATISFIED"},
		{"negative-underflow-equals-zero", "-1e-400", "0", "CONTRACT_SATISFIED"},
		{"negative-underflow-equals-negative-zero", "-1e-400", "-0", "CONTRACT_SATISFIED"},
		{"underflow-is-not-one", "1e-400", "1", "CONTRACT_VIOLATED"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			source := strings.ReplaceAll(template, "LEXEME", testCase.lexeme)
			source = strings.ReplaceAll(source, "EXPECTED", testCase.expected)
			result, err := VerifyJSON([]byte(source))
			if err != nil {
				t.Fatalf("VerifyJSON = %v", err)
			}
			if result.Verdict != testCase.verdict {
				t.Fatalf("verdict = %s, want %s", result.Verdict, testCase.verdict)
			}
		})
	}
}

// TestVerifyRejectsOverflowInsideAnObservation keeps overflow failing closed
// through the public API.
func TestVerifyRejectsOverflowInsideAnObservation(t *testing.T) {
	source := `{
	  "protocolVersion":"0.1",
	  "contract":{
	    "id":"overflow","version":"1","decisionTime":"2026-01-01T00:00:00.000Z",
	    "assumptions":{"clockModel":"trusted_normalized","intervalModel":"half_open","metadataModel":"honest_but_possibly_incomplete"},
	    "requirements":[
	      {"id":"big","description":"Big","type":"value_equals","role":"present","path":["big"],"expected":1}
	    ]
	  },
	  "observations":[{
	    "id":"observation","role":"present",
	    "resource":{"provider":"p","account":"a","kind":"k","key":"x"},
	    "value":{"big":1e400},"observedAt":"2026-01-01T00:00:00.000Z","acquisitionCost":1,
	    "witness":{"provenance":"provider_asserted"}
	  }]
	}`
	if _, err := VerifyJSON([]byte(source)); err == nil {
		t.Fatal("an overflowing JSON number was accepted")
	} else if code := ErrorCode(err); code != InvalidInputCode {
		t.Fatalf("error code = %q, want %q", code, InvalidInputCode)
	}
}
