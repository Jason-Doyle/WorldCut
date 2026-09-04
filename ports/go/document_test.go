package worldcut

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

func sampleContractInput() VerificationInput {
	return VerificationInput{
		Contract: Contract{
			ID:           "deploy",
			Version:      "1",
			DecisionTime: "2026-09-04T18:00:00.000Z",
			Requirements: []Requirement{
				NewDependencyRequirement(
					"ci-tested-current-head",
					"The passing CI run tested the selected branch head",
					"ci",
					"head",
					"tested_head",
				),
				NewValueEqualsRequirement(
					"ci-passed",
					"CI passed",
					"ci",
					[]string{"status"},
					"passed",
				),
			},
		},
		Observations: []Observation{
			{
				ID:   "head-1",
				Role: "head",
				Resource: ResourceIdentity{
					Provider: "git",
					Account:  "acme",
					Kind:     "branch_head",
					Key:      "payments/main",
				},
				Value:           map[string]any{"commit": "commit-B"},
				ObservedAt:      "2026-09-04T17:59:00.000Z",
				AcquisitionCost: 1,
				Witness: ObservationWitness{
					Provenance: "provider_asserted",
					Version:    stringPointer("commit-B"),
				},
			},
			{
				ID:   "ci-1",
				Role: "ci",
				Resource: ResourceIdentity{
					Provider: "github-actions",
					Account:  "acme",
					Kind:     "workflow_run",
					Key:      "ci.yml/2041",
				},
				Value:           map[string]any{"status": "passed"},
				ObservedAt:      "2026-09-04T17:59:30.000Z",
				AcquisitionCost: 2,
				Witness: ObservationWitness{
					Provenance: "provider_asserted",
					Version:    stringPointer("2041"),
					Dependencies: []DependencyWitness{{
						Name: "tested_head",
						Resource: ResourceIdentity{
							Provider: "git",
							Account:  "acme",
							Kind:     "branch_head",
							Key:      "payments/main",
						},
						Relation:   "exact",
						Version:    stringPointer("commit-B"),
						Provenance: "provider_asserted",
					}},
				},
			},
		},
	}
}

func stringPointer(value string) *string {
	return &value
}

const sampleContractJSON = `{
  "protocolVersion": "0.1",
  "contract": {
    "id": "deploy",
    "version": "1",
    "decisionTime": "2026-09-04T18:00:00.000Z",
    "assumptions": {
      "clockModel": "trusted_normalized",
      "intervalModel": "half_open",
      "metadataModel": "honest_but_possibly_incomplete"
    },
    "requirements": [
      {
        "id": "ci-tested-current-head",
        "description": "The passing CI run tested the selected branch head",
        "type": "dependency",
        "dependentRole": "ci",
        "targetRole": "head",
        "dependencyName": "tested_head"
      },
      {
        "id": "ci-passed",
        "description": "CI passed",
        "type": "value_equals",
        "role": "ci",
        "path": ["status"],
        "expected": "passed"
      }
    ]
  },
  "observations": [
    {
      "id": "head-1",
      "role": "head",
      "resource": {
        "provider": "git",
        "account": "acme",
        "kind": "branch_head",
        "key": "payments/main"
      },
      "value": {"commit": "commit-B"},
      "observedAt": "2026-09-04T17:59:00.000Z",
      "acquisitionCost": 1,
      "witness": {"provenance": "provider_asserted", "version": "commit-B"}
    },
    {
      "id": "ci-1",
      "role": "ci",
      "resource": {
        "provider": "github-actions",
        "account": "acme",
        "kind": "workflow_run",
        "key": "ci.yml/2041"
      },
      "value": {"status": "passed"},
      "observedAt": "2026-09-04T17:59:30.000Z",
      "acquisitionCost": 2,
      "witness": {
        "provenance": "provider_asserted",
        "version": "2041",
        "dependencies": [
          {
            "name": "tested_head",
            "resource": {
              "provider": "git",
              "account": "acme",
              "kind": "branch_head",
              "key": "payments/main"
            },
            "relation": "exact",
            "version": "commit-B",
            "provenance": "provider_asserted"
          }
        ]
      }
    }
  ]
}`

func TestConstructedInputMatchesTransportedInput(t *testing.T) {
	constructed, err := VerifyDecisionContract(sampleContractInput())
	if err != nil {
		t.Fatal(err)
	}
	transported, err := VerifyJSON([]byte(sampleContractJSON))
	if err != nil {
		t.Fatal(err)
	}
	if constructed.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", constructed.Verdict)
	}
	constructedJSON, err := json.Marshal(constructed)
	if err != nil {
		t.Fatal(err)
	}
	transportedJSON, err := json.Marshal(transported)
	if err != nil {
		t.Fatal(err)
	}
	if string(constructedJSON) != string(transportedJSON) {
		t.Fatalf("constructed result differs from transported result:\n%s\n%s", constructedJSON, transportedJSON)
	}
	if constructed.VerificationRecordDigest != transported.VerificationRecordDigest {
		t.Fatalf(
			"digest mismatch: %s != %s",
			constructed.VerificationRecordDigest,
			transported.VerificationRecordDigest,
		)
	}
}

func TestConstructedInputAppliesProtocolDefaults(t *testing.T) {
	input := sampleContractInput()
	input.ProtocolVersion = ""
	input.Contract.Assumptions = ContractAssumptions{}
	if _, err := VerifyDecisionContract(input); err != nil {
		t.Fatal(err)
	}

	input.ProtocolVersion = "0.2"
	_, err := VerifyDecisionContract(input)
	if err == nil || ErrorCode(err) != InvalidInputCode {
		t.Fatalf("unexpected protocol version error: %v", err)
	}

	input = sampleContractInput()
	input.Contract.Assumptions = ContractAssumptions{ClockModel: "wall_clock"}
	_, err = VerifyDecisionContract(input)
	if err == nil || !strings.Contains(err.Error(), "assumptions are not supported") {
		t.Fatalf("unexpected assumptions error: %v", err)
	}
}

func TestConstructedInputIsMutationIsolated(t *testing.T) {
	value := map[string]any{"status": "passed"}
	nested := []any{map[string]any{"note": "original"}}
	input := sampleContractInput()
	input.Observations[1].Value = map[string]any{
		"status": value["status"],
		"nested": nested,
	}
	parsed, err := ParseVerificationInput(input)
	if err != nil {
		t.Fatal(err)
	}

	value["status"] = "failed"
	nested[0].(map[string]any)["note"] = "mutated"
	input.Observations[1].Witness.Dependencies[0].Name = "other"
	input.Contract.Requirements[1].Expected = "failed"

	result, err := Verify(parsed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s after caller mutation", result.Verdict)
	}
	second, err := Verify(parsed)
	if err != nil {
		t.Fatal(err)
	}
	if second.VerificationRecordDigest != result.VerificationRecordDigest {
		t.Fatal("repeated verification of a parsed snapshot is not deterministic")
	}
	result.RequirementResults[0].Status = "MUTATED"
	third, err := Verify(parsed)
	if err != nil {
		t.Fatal(err)
	}
	if third.RequirementResults[0].Status == "MUTATED" {
		t.Fatal("mutating a result changed the parsed snapshot")
	}
}

func TestConstructedInputRejectsInvalidCanonicalData(t *testing.T) {
	cyclic := map[string]any{}
	cyclic["self"] = cyclic

	cases := map[string]any{
		"invalid unicode": string([]byte{0xed, 0xa0, 0x80}),
		"non-finite":      math.Inf(1),
		"cycle":           cyclic,
		"binary":          []byte("bytes"),
		"function":        func() {},
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			input := sampleContractInput()
			input.Observations[0].Value = map[string]any{"field": value}
			_, err := VerifyDecisionContract(input)
			if err == nil {
				t.Fatal("expected a rejection")
			}
			if ErrorCode(err) != InvalidInputCode {
				t.Fatalf("error code = %q (%v)", ErrorCode(err), err)
			}
		})
	}
}

func TestConstructedRequirementRejectsForeignVariantFields(t *testing.T) {
	input := sampleContractInput()
	input.Contract.Requirements[0].Role = "ci"
	_, err := VerifyDecisionContract(input)
	if err == nil || !strings.Contains(err.Error(), "unsupported field(s)") {
		t.Fatalf("cross-variant field was not rejected: %v", err)
	}
}

func TestConstructedRequirementSupportsNullExpectedAndAdvisory(t *testing.T) {
	input := sampleContractInput()
	input.Contract.Requirements[1] = NewValueEqualsRequirement(
		"ci-note-absent",
		"CI exposes a null note",
		"ci",
		[]string{"note"},
		nil,
	).Advisory()
	input.Observations[1].Value = map[string]any{"status": "passed", "note": nil}
	result, err := VerifyDecisionContract(input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Coverage.Advisory != 1 || result.Coverage.Required != 1 {
		t.Fatalf("coverage = %+v", result.Coverage)
	}
	for _, requirement := range result.RequirementResults {
		if requirement.RequirementID == "ci-note-absent" && requirement.Status != "SATISFIED" {
			t.Fatalf("null expected value was not matched: %s", requirement.Status)
		}
	}
}

func TestConstructedInputRejectsProtocolViolations(t *testing.T) {
	t.Run("duplicate role", func(t *testing.T) {
		input := sampleContractInput()
		input.Observations[1].Role = "head"
		if _, err := VerifyDecisionContract(input); err == nil ||
			!strings.Contains(err.Error(), "duplicate observation role") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("acquisition cost bound", func(t *testing.T) {
		input := sampleContractInput()
		input.Observations[0].AcquisitionCost = MaxAcquisitionCost + 1
		if _, err := VerifyDecisionContract(input); err == nil ||
			!strings.Contains(err.Error(), "acquisitionCost") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("observation after decision time", func(t *testing.T) {
		input := sampleContractInput()
		input.Observations[0].ObservedAt = "2026-09-04T18:00:00.001Z"
		if _, err := VerifyDecisionContract(input); err == nil ||
			!strings.Contains(err.Error(), "must not be after contract.decisionTime") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("unnormalized timestamp", func(t *testing.T) {
		input := sampleContractInput()
		input.Observations[0].ObservedAt = "2026-09-04T17:59:00Z"
		if _, err := VerifyDecisionContract(input); err == nil ||
			!strings.Contains(err.Error(), "normalized ISO-8601 UTC") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("unsupported requirement type", func(t *testing.T) {
		input := sampleContractInput()
		input.Contract.Requirements[0].Type = "value_greater_than"
		if _, err := VerifyDecisionContract(input); err == nil ||
			!strings.Contains(err.Error(), "unsupported requirement type") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestCommonValidTimeRequirementConstruction(t *testing.T) {
	roles := []string{"head", "ci"}
	requirement := NewCommonValidTimeRequirement(
		"shared-window",
		"Both roles were valid together",
		roles,
		ValidityInterval{From: "2026-09-04T17:00:00.000Z", Until: stringPointer("2026-09-04T19:00:00.000Z")},
	)
	roles[0] = "mutated"
	if requirement.Roles[0] != "head" {
		t.Fatal("requirement retained an alias of the caller's roles slice")
	}

	input := sampleContractInput()
	input.Contract.Requirements = []Requirement{requirement}
	interval := ValidityInterval{
		From:  "2026-09-04T17:30:00.000Z",
		Until: stringPointer("2026-09-04T18:30:00.000Z"),
	}
	input.Observations[0].Witness.Validity = &interval
	input.Observations[1].Witness.Validity = &interval
	result, err := VerifyDecisionContract(input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", result.Verdict)
	}
}

func TestSnapshotJSONValueIsIndependentAndNormalized(t *testing.T) {
	source := map[string]any{
		"list":   []any{1, 2},
		"nested": map[string]any{"flag": true},
	}
	snapshot, err := SnapshotJSONValue(source)
	if err != nil {
		t.Fatal(err)
	}
	source["nested"].(map[string]any)["flag"] = false
	source["list"].([]any)[0] = 99

	record, ok := snapshot.(map[string]any)
	if !ok {
		t.Fatalf("snapshot type = %T", snapshot)
	}
	if record["nested"].(map[string]any)["flag"] != true {
		t.Fatal("snapshot aliased the caller's nested map")
	}
	if record["list"].([]any)[0] != float64(1) {
		t.Fatalf("snapshot did not normalize numbers: %#v", record["list"])
	}

	if _, err := SnapshotJSONValue(math.NaN()); err == nil {
		t.Fatal("NaN was accepted")
	}
}

func TestTimestampHelpers(t *testing.T) {
	instant := time.Date(2026, 9, 4, 18, 0, 0, 123_456_789, time.UTC)
	formatted := FormatTimestamp(instant)
	if formatted != "2026-09-04T18:00:00.123Z" {
		t.Fatalf("formatted = %s", formatted)
	}
	parsed, err := ParseTimestamp(formatted)
	if err != nil {
		t.Fatal(err)
	}
	if FormatTimestamp(parsed) != formatted {
		t.Fatal("timestamp round trip failed")
	}
	offset := time.Date(2026, 9, 4, 18, 0, 0, 0, time.FixedZone("east", 3600))
	if FormatTimestamp(offset) != "2026-09-04T17:00:00.000Z" {
		t.Fatalf("offset was not normalized to UTC: %s", FormatTimestamp(offset))
	}
	for _, value := range []string{
		"2026-09-04T18:00:00Z",
		"2026-09-04T18:00:00.123+01:00",
		"2026-09-04 18:00:00.123Z",
		"",
	} {
		if _, err := ParseTimestamp(value); err == nil {
			t.Fatalf("accepted unnormalized timestamp %q", value)
		}
	}
	if _, err := ParseTimestamp("0000-01-01T00:00:00.000Z"); err != nil {
		t.Fatalf("year zero timestamp was rejected: %v", err)
	}
}

func TestErrorCodeUnwrapsWrappedIntegrationErrors(t *testing.T) {
	cause := &Error{Code: InvalidInputCode, Message: "inner"}
	wrapped := WrapError(GitHubResponseInvalidCode, "outer", cause)
	if ErrorCode(wrapped) != GitHubResponseInvalidCode {
		t.Fatalf("code = %s", ErrorCode(wrapped))
	}
	if wrapped.Error() != "outer: inner" {
		t.Fatalf("message = %s", wrapped.Error())
	}
	if ErrorCode(nil) != "" {
		t.Fatal("nil error reported a code")
	}
}

func FuzzVerifyDecisionContractNoPanic(f *testing.F) {
	f.Add("head", "commit-B", int64(1), "2026-09-04T18:00:00.000Z")
	f.Add("", "", int64(-1), "")
	f.Fuzz(func(t *testing.T, role, version string, cost int64, observedAt string) {
		input := VerificationInput{
			Contract: Contract{
				ID:           "fuzz",
				Version:      "1",
				DecisionTime: "2026-09-04T18:00:00.000Z",
				Requirements: []Requirement{
					NewValueEqualsRequirement("expect", "Expect", role, []string{"status"}, version),
				},
			},
			Observations: []Observation{{
				ID:              "observation",
				Role:            role,
				Resource:        ResourceIdentity{Provider: "p", Account: "a", Kind: "k", Key: "x"},
				Value:           map[string]any{"status": version},
				ObservedAt:      observedAt,
				AcquisitionCost: cost,
				Witness:         ObservationWitness{Provenance: "provider_asserted"},
			}},
		}
		result, err := VerifyDecisionContract(input)
		if err != nil {
			if ErrorCode(err) != InvalidInputCode {
				t.Fatalf("unexpected error code %q for %v", ErrorCode(err), err)
			}
			return
		}
		if result.ProtocolVersion != ProtocolVersion || result.EngineVersion != EngineVersion {
			t.Fatalf("unexpected result envelope: %+v", result)
		}
	})
}
