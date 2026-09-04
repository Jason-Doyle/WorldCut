// Package agenticdatakernel adapts resolved Agentic Data Kernel assertions
// into WorldCut observations.
//
// The adapter is structural: it declares only the fields WorldCut needs and
// takes no runtime dependency on the kernel. Every rejection uses the stable
// WORLDCUT_ADK_RESOLUTION_INVALID code and fails closed.
package agenticdatakernel

import (
	"fmt"
	"sort"
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
)

// Assertion is the structural subset of a kernel assertion WorldCut consumes.
type Assertion struct {
	// TenantID owns the assertion. Every WorldCut resource account and
	// dependency resource account must equal it.
	TenantID string
	// AssertionID identifies the assertion and the derived observation.
	AssertionID string
	// Object is the asserted JSON value.
	Object any
	// ValidFrom and ValidTo bound business validity. A nil ValidTo is open.
	ValidFrom string
	ValidTo   *string
	// SystemFrom and SystemTo bound system validity. A nil SystemTo is open.
	SystemFrom string
	SystemTo   *string
	// Status is the assertion lifecycle state. Only "active" is eligible.
	Status string
	// Basis carries the namespaced basis.worldcut metadata.
	Basis any
}

// Resolution is the structural subset of a kernel resolution result.
type Resolution struct {
	// Status is one of known, unknown, conflicted, or resolved_with_conflict.
	Status string
	// Selected is the assertion the kernel selected, when one exists.
	Selected *Assertion
	// ValidAt and SystemAt are the bitemporal coordinates of the resolution.
	ValidAt  string
	SystemAt string
}

// Options carries application policy for adapting a resolution.
type Options struct {
	// AllowResolvedWithConflict permits a resolution that preserved an
	// unresolved conflict. This is an explicit application policy decision.
	AllowResolvedWithConflict bool
}

var (
	resolutionStatuses = map[string]bool{
		"known":                  true,
		"unknown":                true,
		"conflicted":             true,
		"resolved_with_conflict": true,
	}
	provenanceValues = map[string]bool{
		"provider_asserted": true,
		"client_observed":   true,
		"derived":           true,
		"operator_supplied": true,
	}
	basisFields = map[string]bool{
		"protocolVersion": true,
		"role":            true,
		"resource":        true,
		"provenance":      true,
		"version":         true,
		"dependencies":    true,
		"acquisitionCost": true,
	}
	resourceFields = []string{"provider", "account", "kind", "key"}
)

func invalid(format string, arguments ...any) error {
	return worldcut.NewError(
		worldcut.ADKResolutionInvalidCode,
		fmt.Sprintf(format, arguments...),
	)
}

// copyText detaches an optional caller-owned string pointer so later
// assignment through that pointer cannot change a returned observation.
func copyText(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func wrap(message string, cause error) error {
	return worldcut.WrapError(worldcut.ADKResolutionInvalidCode, message, cause)
}

type worldCutBasis struct {
	role            string
	resource        worldcut.ResourceIdentity
	provenance      string
	version         *string
	dependencies    []worldcut.DependencyWitness
	acquisitionCost int64
}

// ObservationFromResolution converts an eligible kernel resolution into a
// validated WorldCut observation.
//
// The returned observation shares no memory with the caller's assertion
// object or basis metadata, and it has already passed the same strict
// protocol validation as a transported verification input.
func ObservationFromResolution(resolution Resolution, options Options) (worldcut.Observation, error) {
	observation, err := adapt(resolution, options)
	if err != nil {
		if worldcut.ErrorCode(err) == worldcut.ADKResolutionInvalidCode {
			return worldcut.Observation{}, err
		}
		return worldcut.Observation{}, wrap(
			"Agentic Data Kernel resolution metadata is invalid",
			err,
		)
	}
	return observation, nil
}

func adapt(resolution Resolution, options Options) (worldcut.Observation, error) {
	if !resolutionStatuses[resolution.Status] {
		return worldcut.Observation{}, invalid(
			"Agentic Data Kernel resolution status %s is unsupported",
			resolution.Status,
		)
	}
	if resolution.Status == "unknown" || resolution.Status == "conflicted" {
		return worldcut.Observation{}, invalid(
			"Agentic Data Kernel resolution status %s cannot authorize an observation",
			resolution.Status,
		)
	}
	if resolution.Status == "resolved_with_conflict" && !options.AllowResolvedWithConflict {
		return worldcut.Observation{}, invalid(
			"resolved_with_conflict requires AllowResolvedWithConflict: true",
		)
	}
	if resolution.Selected == nil {
		return worldcut.Observation{}, invalid(
			"Agentic Data Kernel resolution has no selected assertion",
		)
	}
	assertion := *resolution.Selected
	if assertion.Status != "active" {
		return worldcut.Observation{}, invalid(
			"Agentic Data Kernel assertion status %s is not eligible",
			assertion.Status,
		)
	}

	systemValid, err := activeAt(
		assertion.SystemFrom,
		assertion.SystemTo,
		resolution.SystemAt,
		"assertion.systemTime",
	)
	if err != nil {
		return worldcut.Observation{}, err
	}
	if !systemValid {
		return worldcut.Observation{}, invalid(
			"Agentic Data Kernel assertion is not system-valid at resolution.systemAt",
		)
	}
	businessValid, err := activeAt(
		assertion.ValidFrom,
		assertion.ValidTo,
		resolution.ValidAt,
		"assertion.validTime",
	)
	if err != nil {
		return worldcut.Observation{}, err
	}
	if !businessValid {
		return worldcut.Observation{}, invalid(
			"Agentic Data Kernel assertion is not business-valid at resolution.validAt",
		)
	}

	object, err := worldcut.SnapshotJSONValue(assertion.Object)
	if err != nil {
		return worldcut.Observation{}, wrap("assertion.object is not JSON data", err)
	}
	basis, err := worldCutBasisFrom(assertion)
	if err != nil {
		return worldcut.Observation{}, err
	}
	if basis.resource.Account != assertion.TenantID {
		return worldcut.Observation{}, invalid(
			"WorldCut resource account must equal the Agentic Data Kernel tenantId",
		)
	}

	observation := worldcut.Observation{
		ID:              "adk-" + assertion.AssertionID,
		Role:            basis.role,
		Resource:        basis.resource,
		Value:           object,
		ObservedAt:      assertion.SystemFrom,
		AcquisitionCost: basis.acquisitionCost,
		Witness: worldcut.ObservationWitness{
			Provenance: basis.provenance,
			Version:    basis.version,
			Validity: &worldcut.ValidityInterval{
				From:  assertion.ValidFrom,
				Until: copyText(assertion.ValidTo),
			},
			Dependencies: basis.dependencies,
		},
	}
	if err := validateObservation(observation, resolution.SystemAt); err != nil {
		return worldcut.Observation{}, wrap(
			"Agentic Data Kernel WorldCut metadata is invalid",
			err,
		)
	}
	return observation, nil
}

// validateObservation submits the adapted observation to the WorldCut engine
// so that construction cannot bypass protocol validation.
func validateObservation(observation worldcut.Observation, systemAt string) error {
	probe := observation
	probe.Value = map[string]any{"selected": observation.Value}
	_, err := worldcut.VerifyDecisionContract(worldcut.VerificationInput{
		ProtocolVersion: worldcut.ProtocolVersion,
		Contract: worldcut.Contract{
			ID:           "agentic-data-kernel-observation-validation",
			Version:      "1",
			DecisionTime: systemAt,
			Assumptions:  worldcut.SupportedAssumptions(),
			Requirements: []worldcut.Requirement{
				worldcut.NewValueEqualsRequirement(
					"selected-value-is-preserved",
					"The selected kernel value is preserved",
					observation.Role,
					[]string{"selected"},
					observation.Value,
				),
			},
		},
		Observations: []worldcut.Observation{probe},
	})
	return err
}

func timestamp(value, field string) (time.Time, error) {
	parsed, err := worldcut.ParseTimestamp(value)
	if err != nil {
		return time.Time{}, invalid("%s must be normalized ISO-8601 UTC", field)
	}
	return parsed, nil
}

func activeAt(start string, end *string, at, field string) (bool, error) {
	startTime, err := timestamp(start, field+".from")
	if err != nil {
		return false, err
	}
	atTime, err := timestamp(at, field+".at")
	if err != nil {
		return false, err
	}
	if end == nil {
		return !atTime.Before(startTime), nil
	}
	endTime, err := timestamp(*end, field+".to")
	if err != nil {
		return false, err
	}
	return !atTime.Before(startTime) && atTime.Before(endTime), nil
}

func worldCutBasisFrom(assertion Assertion) (worldCutBasis, error) {
	snapshot, err := worldcut.SnapshotJSONValue(assertion.Basis)
	if err != nil {
		return worldCutBasis{}, wrap("assertion.basis is not JSON data", err)
	}
	basisRecord, ok := snapshot.(map[string]any)
	if !ok {
		return worldCutBasis{}, invalid("assertion.basis must be an object")
	}
	candidate, ok := basisRecord["worldcut"].(map[string]any)
	if !ok {
		return worldCutBasis{}, invalid("assertion.basis.worldcut must be an object")
	}
	unknown := unsupportedFields(candidate, basisFields)
	if len(unknown) != 0 {
		return worldCutBasis{}, invalid(
			"assertion.basis.worldcut contains unsupported field(s): %v",
			unknown,
		)
	}
	if candidate["protocolVersion"] != worldcut.ProtocolVersion {
		return worldCutBasis{}, invalid(
			"assertion.basis.worldcut.protocolVersion must equal %s",
			worldcut.ProtocolVersion,
		)
	}
	role, ok := candidate["role"].(string)
	if !ok || role == "" {
		return worldCutBasis{}, invalid("assertion.basis.worldcut.role must be a non-empty string")
	}
	resource, err := resourceFrom(candidate["resource"], "assertion.basis.worldcut.resource")
	if err != nil {
		return worldCutBasis{}, err
	}
	provenance, ok := candidate["provenance"].(string)
	if !ok || !provenanceValues[provenance] {
		return worldCutBasis{}, invalid("assertion.basis.worldcut.provenance is unsupported")
	}
	var version *string
	if rawVersion, exists := candidate["version"]; exists {
		text, ok := rawVersion.(string)
		if !ok || text == "" {
			return worldCutBasis{}, invalid(
				"assertion.basis.worldcut.version must be a non-empty string",
			)
		}
		version = &text
	}
	acquisitionCost := int64(1)
	if rawCost, exists := candidate["acquisitionCost"]; exists {
		number, ok := rawCost.(float64)
		if !ok || number != float64(int64(number)) || number < 0 ||
			number > float64(worldcut.MaxAcquisitionCost) {
			return worldCutBasis{}, invalid(
				"assertion.basis.worldcut.acquisitionCost must be an integer between 0 and %d",
				worldcut.MaxAcquisitionCost,
			)
		}
		acquisitionCost = int64(number)
	}
	dependencies, err := dependenciesFrom(candidate, assertion.TenantID)
	if err != nil {
		return worldCutBasis{}, err
	}
	return worldCutBasis{
		role:            role,
		resource:        resource,
		provenance:      provenance,
		version:         version,
		dependencies:    dependencies,
		acquisitionCost: acquisitionCost,
	}, nil
}

func dependenciesFrom(candidate map[string]any, tenantID string) ([]worldcut.DependencyWitness, error) {
	rawDependencies, exists := candidate["dependencies"]
	if !exists {
		return nil, nil
	}
	values, ok := rawDependencies.([]any)
	if !ok {
		return nil, invalid("assertion.basis.worldcut.dependencies must be an array")
	}
	dependencies := make([]worldcut.DependencyWitness, 0, len(values))
	for _, value := range values {
		record, ok := value.(map[string]any)
		if !ok {
			return nil, invalid("assertion.basis.worldcut.dependencies[] must be an object")
		}
		resourceRecord, ok := record["resource"].(map[string]any)
		if !ok {
			return nil, invalid(
				"assertion.basis.worldcut.dependencies[].resource must be an object",
			)
		}
		if resourceRecord["account"] != tenantID {
			return nil, invalid(
				"Every WorldCut dependency resource account must equal the Agentic Data Kernel tenantId",
			)
		}
		unknown := unsupportedFields(record, map[string]bool{
			"name":       true,
			"resource":   true,
			"relation":   true,
			"version":    true,
			"provenance": true,
		})
		if len(unknown) != 0 {
			return nil, invalid(
				"assertion.basis.worldcut.dependencies[] contains unsupported field(s): %v",
				unknown,
			)
		}
		name, ok := record["name"].(string)
		if !ok || name == "" {
			return nil, invalid(
				"assertion.basis.worldcut.dependencies[].name must be a non-empty string",
			)
		}
		resource, err := resourceFrom(
			resourceRecord,
			"assertion.basis.worldcut.dependencies["+name+"].resource",
		)
		if err != nil {
			return nil, err
		}
		relation, ok := record["relation"].(string)
		if !ok || relation != "exact" {
			return nil, invalid(
				"assertion.basis.worldcut.dependencies[%s].relation is unsupported",
				name,
			)
		}
		provenance, ok := record["provenance"].(string)
		if !ok || !provenanceValues[provenance] {
			return nil, invalid(
				"assertion.basis.worldcut.dependencies[%s].provenance is unsupported",
				name,
			)
		}
		var version *string
		if rawVersion, exists := record["version"]; exists {
			text, ok := rawVersion.(string)
			if !ok || text == "" {
				return nil, invalid(
					"assertion.basis.worldcut.dependencies[%s].version must be a non-empty string",
					name,
				)
			}
			version = &text
		}
		dependencies = append(dependencies, worldcut.DependencyWitness{
			Name:       name,
			Resource:   resource,
			Relation:   relation,
			Version:    version,
			Provenance: provenance,
		})
	}
	return dependencies, nil
}

func resourceFrom(value any, field string) (worldcut.ResourceIdentity, error) {
	record, ok := value.(map[string]any)
	if !ok {
		return worldcut.ResourceIdentity{}, invalid("%s must be an object", field)
	}
	allowed := map[string]bool{}
	for _, name := range resourceFields {
		allowed[name] = true
	}
	unknown := unsupportedFields(record, allowed)
	if len(unknown) != 0 {
		return worldcut.ResourceIdentity{}, invalid(
			"%s contains unsupported field(s): %v",
			field,
			unknown,
		)
	}
	values := make([]string, 0, len(resourceFields))
	for _, name := range resourceFields {
		text, ok := record[name].(string)
		if !ok || text == "" {
			return worldcut.ResourceIdentity{}, invalid(
				"%s.%s must be a non-empty string",
				field,
				name,
			)
		}
		values = append(values, text)
	}
	return worldcut.ResourceIdentity{
		Provider: values[0],
		Account:  values[1],
		Kind:     values[2],
		Key:      values[3],
	}, nil
}

func unsupportedFields(record map[string]any, allowed map[string]bool) []string {
	var unknown []string
	for key := range record {
		if !allowed[key] {
			unknown = append(unknown, key)
		}
	}
	sort.Strings(unknown)
	return unknown
}
