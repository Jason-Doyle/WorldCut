package worldcut

import "encoding/json"

const (
	ProtocolVersion      = "0.1"
	EngineVersion        = "0.1.2"
	CanonicalizationName = "worldcut-json-v1"
)

type ResourceIdentity struct {
	Provider string `json:"provider"`
	Account  string `json:"account"`
	Kind     string `json:"kind"`
	Key      string `json:"key"`
}

type ValidityInterval struct {
	From  string  `json:"from"`
	Until *string `json:"until"`
}

type DependencyWitness struct {
	Name       string           `json:"name"`
	Resource   ResourceIdentity `json:"resource"`
	Relation   string           `json:"relation"`
	Version    *string          `json:"version,omitempty"`
	Provenance string           `json:"provenance"`
}

type ObservationWitness struct {
	Provenance   string              `json:"provenance"`
	Version      *string             `json:"version,omitempty"`
	Validity     *ValidityInterval   `json:"validity,omitempty"`
	Dependencies []DependencyWitness `json:"dependencies,omitempty"`
}

type Observation struct {
	ID              string             `json:"id"`
	Role            string             `json:"role"`
	Resource        ResourceIdentity   `json:"resource"`
	Value           any                `json:"value"`
	ObservedAt      string             `json:"observedAt"`
	AcquisitionCost int64              `json:"acquisitionCost"`
	Witness         ObservationWitness `json:"witness"`
	raw             map[string]any
}

// Requirement holds the union of every protocol 0.1 requirement shape. Only
// the fields that belong to Type are part of a well-formed requirement; see
// [Requirement.MarshalJSON].
type Requirement struct {
	ID             string
	Description    string
	Required       *bool
	Type           string
	DependentRole  string
	TargetRole     string
	DependencyName string
	Roles          []string
	Within         *ValidityInterval
	Role           string
	Path           []string
	Expected       any
	raw            map[string]any
}

func (r Requirement) isRequired() bool {
	return r.Required == nil || *r.Required
}

// MarshalJSON emits the protocol form of the requirement variant named by
// Type. Fields belonging to another variant are still emitted when they hold
// a value so that strict validation rejects them instead of silently dropping
// evidence the caller supplied.
func (r Requirement) MarshalJSON() ([]byte, error) {
	document := map[string]any{
		"id":          r.ID,
		"description": r.Description,
		"type":        r.Type,
	}
	if r.Required != nil {
		document["required"] = *r.Required
	}
	if r.Type == "dependency" || r.DependentRole != "" || r.TargetRole != "" || r.DependencyName != "" {
		document["dependentRole"] = r.DependentRole
		document["targetRole"] = r.TargetRole
		document["dependencyName"] = r.DependencyName
	}
	if r.Type == "common_valid_time" || len(r.Roles) != 0 || r.Within != nil {
		document["roles"] = r.Roles
		document["within"] = r.Within
	}
	if r.Type == "value_equals" || r.Role != "" || len(r.Path) != 0 || r.Expected != nil {
		document["role"] = r.Role
		document["path"] = r.Path
		document["expected"] = r.Expected
	}
	return json.Marshal(document)
}

// ContractAssumptions names the clock, interval, and metadata models a
// contract relies on. Protocol 0.1 supports exactly one combination, returned
// by [SupportedAssumptions].
type ContractAssumptions struct {
	ClockModel    string `json:"clockModel"`
	IntervalModel string `json:"intervalModel"`
	MetadataModel string `json:"metadataModel"`
}

type Contract struct {
	ID           string              `json:"id"`
	Version      string              `json:"version"`
	DecisionTime string              `json:"decisionTime"`
	Assumptions  ContractAssumptions `json:"assumptions"`
	Requirements []Requirement       `json:"requirements"`
	raw          map[string]any
}

// VerificationInput is the constructible form of a WorldCut verification
// input. Use [VerifyDecisionContract] or [ParseVerificationInput] to submit
// one; both apply the same strict validation as [ParseInput].
type VerificationInput struct {
	ProtocolVersion string        `json:"protocolVersion"`
	Contract        Contract      `json:"contract"`
	Observations    []Observation `json:"observations"`
}

type verificationInput struct {
	ProtocolVersion string
	Contract        Contract
	Observations    []Observation
	raw             map[string]any
}

// ParsedInput is an immutable, validated WorldCut verification input.
type ParsedInput struct {
	value *verificationInput
}

type AcquisitionAction struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Role        string `json:"role"`
	Cost        int64  `json:"cost"`
	Description string `json:"description"`
	Expected    any    `json:"expected"`
}

type AcquisitionOption struct {
	ID          string              `json:"id"`
	Description string              `json:"description"`
	Actions     []AcquisitionAction `json:"actions"`
}

type RequirementResult struct {
	RequirementID      string              `json:"requirementId"`
	RequirementType    string              `json:"requirementType"`
	Required           bool                `json:"required"`
	Status             string              `json:"status"`
	Summary            string              `json:"summary"`
	Details            any                 `json:"details"`
	AcquisitionOptions []AcquisitionOption `json:"acquisitionOptions"`
}

type AcquisitionPlan struct {
	Status                   string              `json:"status"`
	Reason                   *string             `json:"reason"`
	Actions                  []AcquisitionAction `json:"actions"`
	SelectedOptionIDs        []string            `json:"selectedOptionIds"`
	TotalCost                int64               `json:"totalCost"`
	CoveredRequirementIDs    []string            `json:"coveredRequirementIds"`
	UnresolvedRequirementIDs []string            `json:"unresolvedRequirementIds"`
}

type VerificationCoverage struct {
	Required  int `json:"required"`
	Satisfied int `json:"satisfied"`
	Violated  int `json:"violated"`
	Unknown   int `json:"unknown"`
	Advisory  int `json:"advisory"`
}

type VerificationResult struct {
	ProtocolVersion          string               `json:"protocolVersion"`
	EngineVersion            string               `json:"engineVersion"`
	Canonicalization         string               `json:"canonicalization"`
	ContractID               string               `json:"contractId"`
	ContractVersion          string               `json:"contractVersion"`
	Verdict                  string               `json:"verdict"`
	Coverage                 VerificationCoverage `json:"coverage"`
	RequirementResults       []RequirementResult  `json:"requirementResults"`
	AcquisitionPlan          AcquisitionPlan      `json:"acquisitionPlan"`
	VerificationRecordDigest string               `json:"verificationRecordDigest"`
}
