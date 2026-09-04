package agenticdatakernel_test

import (
	"strings"
	"testing"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	adk "github.com/Jason-Doyle/WorldCut/ports/go/integrations/agenticdatakernel"
)

func basis() map[string]any {
	return map[string]any{
		"worldcut": map[string]any{
			"protocolVersion": "0.1",
			"role":            "head",
			"resource": map[string]any{
				"provider": "github",
				"account":  "tenant-a",
				"kind":     "branch_head",
				"key":      "service/main",
			},
			"provenance":      "provider_asserted",
			"version":         "commit-B",
			"acquisitionCost": 2,
		},
	}
}

func text(value string) *string {
	return &value
}

func resolution() adk.Resolution {
	return adk.Resolution{
		Status:   "known",
		ValidAt:  "2026-09-02T12:00:00.000Z",
		SystemAt: "2026-09-02T12:00:00.000Z",
		Selected: &adk.Assertion{
			TenantID:    "tenant-a",
			AssertionID: "assertion-1",
			Object:      map[string]any{"type": "string", "value": "commit-B"},
			ValidFrom:   "2026-09-02T11:00:00.000Z",
			ValidTo:     nil,
			SystemFrom:  "2026-09-02T11:30:00.000Z",
			SystemTo:    nil,
			Status:      "active",
			Basis:       basis(),
		},
	}
}

func worldCutBasis(input adk.Resolution) map[string]any {
	return input.Selected.Basis.(map[string]any)["worldcut"].(map[string]any)
}

func TestAdaptsEligibleResolution(t *testing.T) {
	observation, err := adk.ObservationFromResolution(resolution(), adk.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if observation.ID != "adk-assertion-1" {
		t.Fatalf("id = %s", observation.ID)
	}
	if observation.Role != "head" {
		t.Fatalf("role = %s", observation.Role)
	}
	if observation.Resource.Account != "tenant-a" {
		t.Fatalf("resource account = %s", observation.Resource.Account)
	}
	if observation.Witness.Version == nil || *observation.Witness.Version != "commit-B" {
		t.Fatalf("version = %v", observation.Witness.Version)
	}
	if observation.AcquisitionCost != 2 {
		t.Fatalf("acquisitionCost = %d", observation.AcquisitionCost)
	}
	if observation.ObservedAt != "2026-09-02T11:30:00.000Z" {
		t.Fatalf("observedAt = %s", observation.ObservedAt)
	}
	validity := observation.Witness.Validity
	if validity == nil || validity.From != "2026-09-02T11:00:00.000Z" || validity.Until != nil {
		t.Fatalf("validity = %+v", validity)
	}
	value, ok := observation.Value.(map[string]any)
	if !ok || value["value"] != "commit-B" {
		t.Fatalf("value = %#v", observation.Value)
	}
}

func TestAdaptedObservationVerifies(t *testing.T) {
	observation, err := adk.ObservationFromResolution(resolution(), adk.Options{})
	if err != nil {
		t.Fatal(err)
	}
	result, err := worldcut.VerifyDecisionContract(worldcut.VerificationInput{
		Contract: worldcut.Contract{
			ID:           "kernel-decision",
			Version:      "1",
			DecisionTime: "2026-09-02T12:00:00.000Z",
			Requirements: []worldcut.Requirement{
				worldcut.NewValueEqualsRequirement(
					"selected-commit",
					"The kernel selected commit-B",
					"head",
					[]string{"value"},
					"commit-B",
				),
			},
		},
		Observations: []worldcut.Observation{observation},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", result.Verdict)
	}
}

func TestAdaptedObservationIsMutationIsolated(t *testing.T) {
	input := resolution()
	object := input.Selected.Object.(map[string]any)
	validTo := "2026-09-02T13:00:00.000Z"
	input.Selected.ValidTo = &validTo
	observation, err := adk.ObservationFromResolution(input, adk.Options{})
	if err != nil {
		t.Fatal(err)
	}
	object["value"] = "commit-C"
	worldCutBasis(input)["role"] = "mutated"
	worldCutBasis(input)["resource"].(map[string]any)["account"] = "tenant-b"
	validTo = "9999-01-01T00:00:00.000Z"

	value := observation.Value.(map[string]any)
	if value["value"] != "commit-B" {
		t.Fatalf("observation value aliased the caller's object: %#v", value)
	}
	if observation.Role != "head" || observation.Resource.Account != "tenant-a" {
		t.Fatalf("observation aliased the caller's basis: %+v", observation)
	}
	if observation.Witness.Validity.Until == nil ||
		*observation.Witness.Validity.Until != "2026-09-02T13:00:00.000Z" {
		t.Fatalf("observation aliased the caller's validTo pointer: %+v", observation.Witness.Validity)
	}
}

func TestRejectsUnusableResolutionStatuses(t *testing.T) {
	for _, status := range []string{"unknown", "conflicted"} {
		input := resolution()
		input.Status = status
		input.Selected = nil
		_, err := adk.ObservationFromResolution(input, adk.Options{})
		if worldcut.ErrorCode(err) != worldcut.ADKResolutionInvalidCode {
			t.Fatalf("status %s error = %v", status, err)
		}
	}

	input := resolution()
	input.Status = "invented"
	if _, err := adk.ObservationFromResolution(input, adk.Options{}); err == nil ||
		!strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("unexpected error: %v", err)
	}

	input = resolution()
	input.Status = "resolved_with_conflict"
	if _, err := adk.ObservationFromResolution(input, adk.Options{}); err == nil ||
		!strings.Contains(err.Error(), "AllowResolvedWithConflict") {
		t.Fatalf("unexpected error: %v", err)
	}
	observation, err := adk.ObservationFromResolution(
		input,
		adk.Options{AllowResolvedWithConflict: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	if observation.Role != "head" {
		t.Fatalf("role = %s", observation.Role)
	}

	input = resolution()
	input.Selected = nil
	if _, err := adk.ObservationFromResolution(input, adk.Options{}); err == nil ||
		!strings.Contains(err.Error(), "no selected assertion") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRejectsIneligibleLifecycleAndTemporalStates(t *testing.T) {
	disputed := resolution()
	disputed.Selected.Status = "disputed"
	if _, err := adk.ObservationFromResolution(disputed, adk.Options{}); err == nil ||
		!strings.Contains(err.Error(), "not eligible") {
		t.Fatalf("unexpected error: %v", err)
	}

	systemClosed := resolution()
	systemClosed.Selected.SystemTo = text("2026-09-02T11:45:00.000Z")
	if _, err := adk.ObservationFromResolution(systemClosed, adk.Options{}); err == nil ||
		!strings.Contains(err.Error(), "not system-valid") {
		t.Fatalf("unexpected error: %v", err)
	}

	systemEarly := resolution()
	systemEarly.Selected.SystemFrom = "2026-09-02T12:30:00.000Z"
	if _, err := adk.ObservationFromResolution(systemEarly, adk.Options{}); err == nil ||
		!strings.Contains(err.Error(), "not system-valid") {
		t.Fatalf("unexpected error: %v", err)
	}

	businessExpired := resolution()
	businessExpired.Selected.ValidTo = text("2026-09-02T11:45:00.000Z")
	if _, err := adk.ObservationFromResolution(businessExpired, adk.Options{}); err == nil ||
		!strings.Contains(err.Error(), "not business-valid") {
		t.Fatalf("unexpected error: %v", err)
	}

	for name, mutate := range map[string]func(*adk.Resolution){
		"unnormalized systemAt": func(r *adk.Resolution) { r.SystemAt = "2026-09-02T12:00:00Z" },
		"unnormalized validAt":  func(r *adk.Resolution) { r.ValidAt = "" },
		"unnormalized validFrom": func(r *adk.Resolution) {
			r.Selected.ValidFrom = "2026-09-02"
		},
		"unnormalized systemTo": func(r *adk.Resolution) {
			r.Selected.SystemTo = text("not-a-timestamp")
		},
	} {
		t.Run(name, func(t *testing.T) {
			input := resolution()
			mutate(&input)
			_, err := adk.ObservationFromResolution(input, adk.Options{})
			if worldcut.ErrorCode(err) != worldcut.ADKResolutionInvalidCode {
				t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
			}
		})
	}
}

func TestBindsResourceAccountsToTheKernelTenant(t *testing.T) {
	mismatched := resolution()
	worldCutBasis(mismatched)["resource"].(map[string]any)["account"] = "tenant-b"
	if _, err := adk.ObservationFromResolution(mismatched, adk.Options{}); err == nil ||
		!strings.Contains(err.Error(), "tenantId") {
		t.Fatalf("unexpected error: %v", err)
	}

	dependencyTenant := resolution()
	worldCutBasis(dependencyTenant)["dependencies"] = []any{
		map[string]any{"resource": map[string]any{"account": "tenant-b"}},
	}
	_, err := adk.ObservationFromResolution(dependencyTenant, adk.Options{})
	if err == nil || !strings.Contains(err.Error(), "Every WorldCut dependency resource account") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAcceptsDependencyWitnesses(t *testing.T) {
	input := resolution()
	worldCutBasis(input)["role"] = "ci"
	worldCutBasis(input)["dependencies"] = []any{
		map[string]any{
			"name": "tested_head",
			"resource": map[string]any{
				"provider": "github",
				"account":  "tenant-a",
				"kind":     "branch_head",
				"key":      "service/main",
			},
			"relation":   "exact",
			"version":    "commit-B",
			"provenance": "provider_asserted",
		},
	}
	observation, err := adk.ObservationFromResolution(input, adk.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(observation.Witness.Dependencies) != 1 {
		t.Fatalf("dependencies = %+v", observation.Witness.Dependencies)
	}
	dependency := observation.Witness.Dependencies[0]
	if dependency.Name != "tested_head" || dependency.Relation != "exact" ||
		dependency.Version == nil || *dependency.Version != "commit-B" {
		t.Fatalf("dependency = %+v", dependency)
	}
}

func TestRejectsMalformedWorldCutMetadata(t *testing.T) {
	cases := map[string]func(map[string]any){
		"dependencies is an object": func(b map[string]any) {
			b["dependencies"] = map[string]any{}
		},
		"dependency is not an object": func(b map[string]any) {
			b["dependencies"] = []any{"tested_head"}
		},
		"dependency resource missing": func(b map[string]any) {
			b["dependencies"] = []any{map[string]any{"name": "tested_head"}}
		},
		"dependency relation unsupported": func(b map[string]any) {
			b["dependencies"] = []any{map[string]any{
				"name": "tested_head",
				"resource": map[string]any{
					"provider": "github",
					"account":  "tenant-a",
					"kind":     "branch_head",
					"key":      "service/main",
				},
				"relation":   "compatible",
				"provenance": "provider_asserted",
			}}
		},
		"dependency field unsupported": func(b map[string]any) {
			b["dependencies"] = []any{map[string]any{
				"name": "tested_head",
				"resource": map[string]any{
					"provider": "github",
					"account":  "tenant-a",
					"kind":     "branch_head",
					"key":      "service/main",
				},
				"relation":   "exact",
				"provenance": "provider_asserted",
				"expiresAt":  "2026-09-02T12:00:00.000Z",
			}}
		},
		"unsupported basis field":  func(b map[string]any) { b["scope"] = "global" },
		"wrong protocol version":   func(b map[string]any) { b["protocolVersion"] = "0.2" },
		"missing protocol version": func(b map[string]any) { delete(b, "protocolVersion") },
		"empty role":               func(b map[string]any) { b["role"] = "" },
		"missing role":             func(b map[string]any) { delete(b, "role") },
		"role is not a string":     func(b map[string]any) { b["role"] = 4 },
		"missing resource":         func(b map[string]any) { delete(b, "resource") },
		"resource extra field": func(b map[string]any) {
			b["resource"].(map[string]any)["region"] = "eu"
		},
		"resource field empty": func(b map[string]any) {
			b["resource"].(map[string]any)["kind"] = ""
		},
		"unsupported provenance": func(b map[string]any) { b["provenance"] = "guessed" },
		"missing provenance":     func(b map[string]any) { delete(b, "provenance") },
		"empty version":          func(b map[string]any) { b["version"] = "" },
		"negative cost":          func(b map[string]any) { b["acquisitionCost"] = -1 },
		"fractional cost":        func(b map[string]any) { b["acquisitionCost"] = 1.5 },
		"unbounded cost": func(b map[string]any) {
			b["acquisitionCost"] = float64(worldcut.MaxAcquisitionCost) + 1
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			input := resolution()
			mutate(worldCutBasis(input))
			_, err := adk.ObservationFromResolution(input, adk.Options{})
			if worldcut.ErrorCode(err) != worldcut.ADKResolutionInvalidCode {
				t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
			}
		})
	}
}

func TestRejectsMalformedBasisContainers(t *testing.T) {
	cases := map[string]any{
		"basis is nil":                nil,
		"basis is a string":           "worldcut",
		"basis is an array":           []any{},
		"basis has no worldcut entry": map[string]any{"other": map[string]any{}},
		"worldcut is not an object":   map[string]any{"worldcut": "0.1"},
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			input := resolution()
			input.Selected.Basis = value
			_, err := adk.ObservationFromResolution(input, adk.Options{})
			if worldcut.ErrorCode(err) != worldcut.ADKResolutionInvalidCode {
				t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
			}
		})
	}
}

func TestRejectsNonJSONAssertionObjects(t *testing.T) {
	input := resolution()
	input.Selected.Object = func() {}
	_, err := adk.ObservationFromResolution(input, adk.Options{})
	if worldcut.ErrorCode(err) != worldcut.ADKResolutionInvalidCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}

	cyclic := map[string]any{}
	cyclic["self"] = cyclic
	input = resolution()
	input.Selected.Object = cyclic
	_, err = adk.ObservationFromResolution(input, adk.Options{})
	if worldcut.ErrorCode(err) != worldcut.ADKResolutionInvalidCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
}

func TestRejectsAssertionIdentitiesTheEngineWouldReject(t *testing.T) {
	input := resolution()
	input.Selected.AssertionID = string([]byte{0xed, 0xa0, 0x80})
	_, err := adk.ObservationFromResolution(input, adk.Options{})
	if worldcut.ErrorCode(err) != worldcut.ADKResolutionInvalidCode {
		t.Fatalf("error = %v (code %q)", err, worldcut.ErrorCode(err))
	}
	if !strings.Contains(err.Error(), "WorldCut metadata is invalid") {
		t.Fatalf("error message = %s", err.Error())
	}
}

func TestPreservesYearZeroCompatibleTimestamps(t *testing.T) {
	input := resolution()
	input.Selected.ValidFrom = "0000-01-01T00:00:00.000Z"
	input.Selected.SystemFrom = "0000-01-01T00:00:00.000Z"
	input.ValidAt = "0000-01-01T00:00:00.000Z"
	input.SystemAt = "0000-01-01T00:00:00.000Z"
	observation, err := adk.ObservationFromResolution(input, adk.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if observation.ObservedAt != "0000-01-01T00:00:00.000Z" {
		t.Fatalf("observedAt = %s", observation.ObservedAt)
	}
}
