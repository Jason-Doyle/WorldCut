package worldcut

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
	Name       string
	Resource   ResourceIdentity
	Relation   string
	Version    *string
	Provenance string
}

type ObservationWitness struct {
	Provenance   string
	Version      *string
	Validity     *ValidityInterval
	Dependencies []DependencyWitness
}

type Observation struct {
	ID              string
	Role            string
	Resource        ResourceIdentity
	Value           any
	ObservedAt      string
	AcquisitionCost int64
	Witness         ObservationWitness
	raw             map[string]any
}

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

type Contract struct {
	ID           string
	Version      string
	DecisionTime string
	Requirements []Requirement
	raw          map[string]any
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
