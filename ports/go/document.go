package worldcut

import (
	"encoding/json"
	"reflect"
	"time"
)

// SupportedAssumptions returns the only clock, interval, and metadata models
// protocol 0.1 accepts.
func SupportedAssumptions() ContractAssumptions {
	return ContractAssumptions{
		ClockModel:    "trusted_normalized",
		IntervalModel: "half_open",
		MetadataModel: "honest_but_possibly_incomplete",
	}
}

// NewDependencyRequirement builds an exact dependency requirement.
func NewDependencyRequirement(id, description, dependentRole, targetRole, dependencyName string) Requirement {
	return Requirement{
		ID:             id,
		Description:    description,
		Type:           "dependency",
		DependentRole:  dependentRole,
		TargetRole:     targetRole,
		DependencyName: dependencyName,
	}
}

// NewCommonValidTimeRequirement builds a scoped common-valid-time requirement.
func NewCommonValidTimeRequirement(id, description string, roles []string, within ValidityInterval) Requirement {
	if within.Until != nil {
		until := *within.Until
		within.Until = &until
	}
	return Requirement{
		ID:          id,
		Description: description,
		Type:        "common_valid_time",
		Roles:       append([]string(nil), roles...),
		Within:      &within,
	}
}

// NewValueEqualsRequirement builds a deterministic value-path requirement.
// A nil expected value means the JSON value null.
func NewValueEqualsRequirement(id, description, role string, path []string, expected any) Requirement {
	return Requirement{
		ID:          id,
		Description: description,
		Type:        "value_equals",
		Role:        role,
		Path:        append([]string(nil), path...),
		Expected:    expected,
	}
}

// Advisory marks the requirement as evaluated but not required for the
// aggregate verdict.
func (r Requirement) Advisory() Requirement {
	required := false
	r.Required = &required
	return r
}

func (input VerificationInput) withDefaults() VerificationInput {
	if input.ProtocolVersion == "" {
		input.ProtocolVersion = ProtocolVersion
	}
	if input.Contract.Assumptions == (ContractAssumptions{}) {
		input.Contract.Assumptions = SupportedAssumptions()
	}
	return input
}

// ParseVerificationInput validates a constructed verification input and
// returns an immutable parsed snapshot. The input is encoded and then run
// through the same strict validation and canonicalization as [ParseInput], so
// constructed and transported inputs are accepted on identical terms.
//
// An empty ProtocolVersion defaults to [ProtocolVersion] and a zero
// ContractAssumptions defaults to [SupportedAssumptions]. Every other field
// must be supplied. The returned snapshot shares no memory with the caller's
// maps or slices.
func ParseVerificationInput(input VerificationInput) (*ParsedInput, error) {
	encoded, err := encodeDocument(input.withDefaults())
	if err != nil {
		return nil, err
	}
	return ParseInput(encoded)
}

// VerifyDecisionContract validates and verifies a constructed verification
// input. It is equivalent to [ParseVerificationInput] followed by [Verify].
func VerifyDecisionContract(input VerificationInput) (*VerificationResult, error) {
	parsed, err := ParseVerificationInput(input)
	if err != nil {
		return nil, err
	}
	return Verify(parsed)
}

func encodeDocument(value any) ([]byte, error) {
	// Go's JSON encoder silently replaces invalid Unicode and cannot encode
	// cycles, so the canonical value rules run before encoding and every
	// rejection stays a WorldCut input error.
	if err := validateCanonicalValue(reflect.ValueOf(value), "input", map[canonicalVisit]bool{}); err != nil {
		return nil, invalidInput("%v", err)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, invalidInput("%v", err)
	}
	return encoded, nil
}

// SnapshotJSONValue validates a Go value against the WorldCut canonical JSON
// data rules and returns an independent snapshot built only from JSON types:
// nil, bool, float64, string, []any, and map[string]any.
//
// Use it when adapting provider payloads so that later mutation of the
// caller's maps or slices cannot change a captured observation.
func SnapshotJSONValue(value any) (any, error) {
	encoded, err := encodeDocument(value)
	if err != nil {
		return nil, err
	}
	snapshot, err := decodeJSON(encoded)
	if err != nil {
		return nil, invalidInput("%v", err)
	}
	return snapshot, nil
}

// ParseTimestamp validates a normalized ISO-8601 UTC timestamp with
// milliseconds, the only timestamp form protocol 0.1 accepts.
func ParseTimestamp(value string) (time.Time, error) {
	_, parsed, err := parseTimestamp(value, "timestamp")
	if err != nil {
		return time.Time{}, invalidInput("%v", err)
	}
	return parsed, nil
}

// FormatTimestamp renders an instant as normalized UTC milliseconds.
func FormatTimestamp(instant time.Time) string {
	return instant.UTC().Format(timestampLayout)
}
