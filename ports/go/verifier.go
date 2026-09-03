package worldcut

import (
	"encoding/json"
	"fmt"
	"sort"
)

func VerifyJSON(source []byte) (*VerificationResult, error) {
	input, err := ParseInput(source)
	if err != nil {
		return nil, err
	}
	return Verify(input)
}

func Verify(input *ParsedInput) (*VerificationResult, error) {
	if input == nil || input.value == nil || input.value.raw == nil {
		return nil, invalidInput("verification input must be produced by ParseInput")
	}
	return verifyParsed(input.value)
}

func verifyParsed(input *verificationInput) (*VerificationResult, error) {
	observations := make(map[string]*Observation, len(input.Observations))
	for i := range input.Observations {
		observation := &input.Observations[i]
		observations[observation.Role] = observation
	}
	requirements := append([]Requirement{}, input.Contract.Requirements...)
	sort.Slice(requirements, func(i, j int) bool {
		return compareUTF16(requirements[i].ID, requirements[j].ID) < 0
	})
	results := make([]RequirementResult, 0, len(requirements))
	for _, requirement := range requirements {
		var result RequirementResult
		var err error
		switch requirement.Type {
		case "dependency":
			result, err = evaluateDependency(requirement, observations)
		case "common_valid_time":
			result, err = evaluateCommonValidTime(requirement, observations)
		case "value_equals":
			result, err = evaluateValueEquals(requirement, observations)
		default:
			err = fmt.Errorf("unsupported requirement type: %s", requirement.Type)
		}
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	coverage := VerificationCoverage{}
	for _, result := range results {
		if !result.Required {
			coverage.Advisory++
			continue
		}
		coverage.Required++
		switch result.Status {
		case "SATISFIED":
			coverage.Satisfied++
		case "VIOLATED":
			coverage.Violated++
		case "UNKNOWN":
			coverage.Unknown++
		}
	}
	verdict := "CONTRACT_SATISFIED"
	if coverage.Violated > 0 {
		verdict = "CONTRACT_VIOLATED"
	} else if coverage.Unknown > 0 {
		verdict = "INSUFFICIENT_EVIDENCE"
	}
	plan, err := SelectAcquisitionPlan(results)
	if err != nil {
		return nil, err
	}
	record := map[string]any{
		"protocolVersion":    input.ProtocolVersion,
		"engineVersion":      EngineVersion,
		"canonicalization":   CanonicalizationName,
		"contract":           normalizedContract(input),
		"observations":       normalizedObservations(input),
		"verdict":            verdict,
		"requirementResults": results,
		"acquisitionPlan":    plan,
	}
	digest, err := SHA256Digest(record)
	if err != nil {
		return nil, err
	}
	result := &VerificationResult{
		ProtocolVersion:          input.ProtocolVersion,
		EngineVersion:            EngineVersion,
		Canonicalization:         CanonicalizationName,
		ContractID:               input.Contract.ID,
		ContractVersion:          input.Contract.Version,
		Verdict:                  verdict,
		Coverage:                 coverage,
		RequirementResults:       results,
		AcquisitionPlan:          plan,
		VerificationRecordDigest: digest,
	}
	return cloneVerificationResult(result)
}

func cloneVerificationResult(result *VerificationResult) (*VerificationResult, error) {
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var cloned VerificationResult
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		return nil, err
	}
	return &cloned, nil
}

func normalizedContract(input *verificationInput) map[string]any {
	contract := make(map[string]any, len(input.Contract.raw))
	for key, value := range input.Contract.raw {
		contract[key] = value
	}
	requirements := append([]Requirement{}, input.Contract.Requirements...)
	sort.Slice(requirements, func(i, j int) bool {
		return compareUTF16(requirements[i].ID, requirements[j].ID) < 0
	})
	rawRequirements := make([]any, len(requirements))
	for i, requirement := range requirements {
		rawRequirements[i] = requirement.raw
	}
	contract["requirements"] = rawRequirements
	return contract
}

func normalizedObservations(input *verificationInput) []any {
	observations := append([]Observation{}, input.Observations...)
	sort.Slice(observations, func(i, j int) bool {
		return compareUTF16(observations[i].Role, observations[j].Role) < 0
	})
	result := make([]any, len(observations))
	for i, observation := range observations {
		result[i] = observation.raw
	}
	return result
}
