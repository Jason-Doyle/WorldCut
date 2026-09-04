package worldcut

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"time"
	"unicode/utf8"
)

const (
	maxAcquisitionCost = int64(1_000_000_000)
	timestampLayout    = "2006-01-02T15:04:05.000Z"
)

var provenanceValues = map[string]bool{
	"provider_asserted": true,
	"client_observed":   true,
	"derived":           true,
	"operator_supplied": true,
}

func validateRawUnicode(source []byte) error {
	if !utf8.Valid(source) {
		return errors.New("input is not valid UTF-8")
	}
	inString := false
	for i := 0; i < len(source); i++ {
		switch source[i] {
		case '"':
			inString = !inString
		case '\\':
			if !inString {
				continue
			}
			i++
			if i >= len(source) {
				return errors.New("unterminated JSON escape")
			}
			if source[i] != 'u' {
				continue
			}
			if i+4 >= len(source) {
				return errors.New("incomplete Unicode escape")
			}
			code, err := strconv.ParseUint(string(source[i+1:i+5]), 16, 16)
			if err != nil {
				return errors.New("invalid Unicode escape")
			}
			i += 4
			if code >= 0xD800 && code <= 0xDBFF {
				if i+6 >= len(source) || source[i+1] != '\\' || source[i+2] != 'u' {
					return errors.New("unpaired high surrogate")
				}
				low, err := strconv.ParseUint(string(source[i+3:i+7]), 16, 16)
				if err != nil || low < 0xDC00 || low > 0xDFFF {
					return errors.New("unpaired high surrogate")
				}
				i += 6
			} else if code >= 0xDC00 && code <= 0xDFFF {
				return errors.New("unpaired low surrogate")
			}
		}
	}
	return nil
}

func decodeJSON(source []byte) (any, error) {
	if err := validateRawUnicode(source); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(source))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("input contains more than one JSON value")
		}
		return nil, err
	}
	return normalizeNumbers(value)
}

func normalizeNumbers(value any) (any, error) {
	switch typed := value.(type) {
	case json.Number:
		number, err := strconv.ParseFloat(string(typed), 64)
		// strconv.ErrRange covers both IEEE-754 underflow, which yields a
		// finite +/-0, and overflow, which yields +/-Inf. TypeScript, Python,
		// and .NET all accept underflow such as 1e-400 as zero, so only the
		// non-finite results are protocol errors here.
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return nil, fmt.Errorf("invalid JSON number %q", typed)
		}
		if math.IsInf(number, 0) || math.IsNaN(number) {
			return nil, fmt.Errorf("invalid JSON number %q", typed)
		}
		return number, nil
	case []any:
		for i := range typed {
			normalized, err := normalizeNumbers(typed[i])
			if err != nil {
				return nil, err
			}
			typed[i] = normalized
		}
	case map[string]any:
		for key, element := range typed {
			normalized, err := normalizeNumbers(element)
			if err != nil {
				return nil, err
			}
			typed[key] = normalized
		}
	}
	return value, nil
}

func asRecord(value any, field string) (map[string]any, error) {
	record, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s must be an object", field)
	}
	return record, nil
}

func exactKeys(record map[string]any, allowed []string, field string) error {
	allowedSet := make(map[string]bool, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = true
	}
	var unknown []string
	for key := range record {
		if !allowedSet[key] {
			unknown = append(unknown, key)
		}
	}
	sort.Slice(unknown, func(i, j int) bool {
		return compareUTF16(unknown[i], unknown[j]) < 0
	})
	if len(unknown) != 0 {
		return fmt.Errorf("%s contains unsupported field(s): %v", field, unknown)
	}
	return nil
}

func requiredKeys(record map[string]any, keys []string, field string) error {
	var missing []string
	for _, key := range keys {
		if _, ok := record[key]; !ok {
			missing = append(missing, key)
		}
	}
	if len(missing) != 0 {
		return fmt.Errorf("%s is missing required field(s): %v", field, missing)
	}
	return nil
}

func nonEmptyString(value any, field string) (string, error) {
	text, ok := value.(string)
	if !ok || text == "" {
		return "", fmt.Errorf("%s must be a non-empty string", field)
	}
	return text, nil
}

func parseTimestamp(value any, field string) (string, time.Time, error) {
	text, err := nonEmptyString(value, field)
	if err != nil {
		return "", time.Time{}, err
	}
	parsed, err := time.Parse(timestampLayout, text)
	if err != nil || parsed.Format(timestampLayout) != text {
		return "", time.Time{}, fmt.Errorf("%s must use normalized ISO-8601 UTC form with milliseconds", field)
	}
	return text, parsed, nil
}

func parseResource(value any, field string) (ResourceIdentity, error) {
	record, err := asRecord(value, field)
	if err != nil {
		return ResourceIdentity{}, err
	}
	keys := []string{"provider", "account", "kind", "key"}
	if err := exactKeys(record, keys, field); err != nil {
		return ResourceIdentity{}, err
	}
	if err := requiredKeys(record, keys, field); err != nil {
		return ResourceIdentity{}, err
	}
	provider, err := nonEmptyString(record["provider"], field+".provider")
	if err != nil {
		return ResourceIdentity{}, err
	}
	account, err := nonEmptyString(record["account"], field+".account")
	if err != nil {
		return ResourceIdentity{}, err
	}
	kind, err := nonEmptyString(record["kind"], field+".kind")
	if err != nil {
		return ResourceIdentity{}, err
	}
	key, err := nonEmptyString(record["key"], field+".key")
	if err != nil {
		return ResourceIdentity{}, err
	}
	return ResourceIdentity{Provider: provider, Account: account, Kind: kind, Key: key}, nil
}

func parseInterval(value any, field string) (*ValidityInterval, error) {
	record, err := asRecord(value, field)
	if err != nil {
		return nil, err
	}
	if err := exactKeys(record, []string{"from", "until"}, field); err != nil {
		return nil, err
	}
	if err := requiredKeys(record, []string{"from", "until"}, field); err != nil {
		return nil, err
	}
	from, start, err := parseTimestamp(record["from"], field+".from")
	if err != nil {
		return nil, err
	}
	var until *string
	if record["until"] != nil {
		text, end, err := parseTimestamp(record["until"], field+".until")
		if err != nil {
			return nil, err
		}
		if !end.After(start) {
			return nil, fmt.Errorf("%s must be a non-empty half-open interval", field)
		}
		until = &text
	}
	return &ValidityInterval{From: from, Until: until}, nil
}

func ParseInput(source []byte) (*ParsedInput, error) {
	value, err := decodeJSON(source)
	if err != nil {
		return nil, invalidInput("%v", err)
	}
	input, err := validateInput(value)
	if err != nil {
		return nil, invalidInput("%v", err)
	}
	return &ParsedInput{value: input}, nil
}

func validateInput(value any) (*verificationInput, error) {
	root, err := asRecord(value, "input")
	if err != nil {
		return nil, err
	}
	if err := exactKeys(root, []string{"protocolVersion", "contract", "observations"}, "input"); err != nil {
		return nil, err
	}
	if err := requiredKeys(root, []string{"protocolVersion", "contract", "observations"}, "input"); err != nil {
		return nil, err
	}
	protocol, err := nonEmptyString(root["protocolVersion"], "input.protocolVersion")
	if err != nil {
		return nil, err
	}
	if protocol != ProtocolVersion {
		return nil, errors.New("input.protocolVersion must equal 0.1")
	}
	contract, decisionTime, err := parseContract(root["contract"])
	if err != nil {
		return nil, err
	}
	observationValues, ok := root["observations"].([]any)
	if !ok {
		return nil, errors.New("observations must be an array")
	}
	observations := make([]Observation, 0, len(observationValues))
	ids := map[string]bool{}
	roles := map[string]bool{}
	for _, observationValue := range observationValues {
		observation, observedAt, err := parseObservation(observationValue)
		if err != nil {
			return nil, err
		}
		if ids[observation.ID] {
			return nil, fmt.Errorf("duplicate observation id: %s", observation.ID)
		}
		if roles[observation.Role] {
			return nil, fmt.Errorf("duplicate observation role: %s", observation.Role)
		}
		if observedAt.After(decisionTime) {
			return nil, fmt.Errorf("%s.observedAt must not be after contract.decisionTime", observation.Role)
		}
		ids[observation.ID] = true
		roles[observation.Role] = true
		observations = append(observations, observation)
	}
	return &verificationInput{
		ProtocolVersion: protocol,
		Contract:        contract,
		Observations:    observations,
		raw:             root,
	}, nil
}

func parseContract(value any) (Contract, time.Time, error) {
	record, err := asRecord(value, "contract")
	if err != nil {
		return Contract{}, time.Time{}, err
	}
	keys := []string{"id", "version", "decisionTime", "assumptions", "requirements"}
	if err := exactKeys(record, keys, "contract"); err != nil {
		return Contract{}, time.Time{}, err
	}
	if err := requiredKeys(record, keys, "contract"); err != nil {
		return Contract{}, time.Time{}, err
	}
	id, err := nonEmptyString(record["id"], "contract.id")
	if err != nil {
		return Contract{}, time.Time{}, err
	}
	version, err := nonEmptyString(record["version"], "contract.version")
	if err != nil {
		return Contract{}, time.Time{}, err
	}
	decisionText, decisionTime, err := parseTimestamp(record["decisionTime"], "contract.decisionTime")
	if err != nil {
		return Contract{}, time.Time{}, err
	}
	assumptions, err := asRecord(record["assumptions"], "contract.assumptions")
	if err != nil {
		return Contract{}, time.Time{}, err
	}
	assumptionKeys := []string{"clockModel", "intervalModel", "metadataModel"}
	if err := exactKeys(assumptions, assumptionKeys, "contract.assumptions"); err != nil {
		return Contract{}, time.Time{}, err
	}
	if err := requiredKeys(assumptions, assumptionKeys, "contract.assumptions"); err != nil {
		return Contract{}, time.Time{}, err
	}
	if assumptions["clockModel"] != "trusted_normalized" ||
		assumptions["intervalModel"] != "half_open" ||
		assumptions["metadataModel"] != "honest_but_possibly_incomplete" {
		return Contract{}, time.Time{}, errors.New("contract assumptions are not supported by this engine")
	}
	requirementValues, ok := record["requirements"].([]any)
	if !ok {
		return Contract{}, time.Time{}, errors.New("contract.requirements must be an array")
	}
	requirements := make([]Requirement, 0, len(requirementValues))
	ids := map[string]bool{}
	requiredCount := 0
	for _, requirementValue := range requirementValues {
		requirement, err := parseRequirement(requirementValue)
		if err != nil {
			return Contract{}, time.Time{}, err
		}
		if ids[requirement.ID] {
			return Contract{}, time.Time{}, fmt.Errorf("duplicate requirement id: %s", requirement.ID)
		}
		ids[requirement.ID] = true
		if requirement.isRequired() {
			requiredCount++
		}
		requirements = append(requirements, requirement)
	}
	if requiredCount == 0 {
		return Contract{}, time.Time{}, errors.New("a decision contract must contain at least one required requirement")
	}
	return Contract{
		ID:           id,
		Version:      version,
		DecisionTime: decisionText,
		Requirements: requirements,
		raw:          record,
	}, decisionTime, nil
}

func parseObservation(value any) (Observation, time.Time, error) {
	record, err := asRecord(value, "observation")
	if err != nil {
		return Observation{}, time.Time{}, err
	}
	keys := []string{"id", "role", "resource", "value", "observedAt", "acquisitionCost", "witness"}
	if err := exactKeys(record, keys, "observation"); err != nil {
		return Observation{}, time.Time{}, err
	}
	if err := requiredKeys(record, keys, "observation"); err != nil {
		return Observation{}, time.Time{}, err
	}
	id, err := nonEmptyString(record["id"], "observation.id")
	if err != nil {
		return Observation{}, time.Time{}, err
	}
	role, err := nonEmptyString(record["role"], "observation.role")
	if err != nil {
		return Observation{}, time.Time{}, err
	}
	resource, err := parseResource(record["resource"], role+".resource")
	if err != nil {
		return Observation{}, time.Time{}, err
	}
	observedAtText, observedAt, err := parseTimestamp(record["observedAt"], role+".observedAt")
	if err != nil {
		return Observation{}, time.Time{}, err
	}
	costNumber, ok := record["acquisitionCost"].(float64)
	if !ok || math.Trunc(costNumber) != costNumber || costNumber < 0 || costNumber > float64(maxAcquisitionCost) {
		return Observation{}, time.Time{}, fmt.Errorf("%s.acquisitionCost must be an integer between 0 and %d", role, maxAcquisitionCost)
	}
	witness, err := parseWitness(record["witness"], role)
	if err != nil {
		return Observation{}, time.Time{}, err
	}
	return Observation{
		ID:              id,
		Role:            role,
		Resource:        resource,
		Value:           record["value"],
		ObservedAt:      observedAtText,
		AcquisitionCost: int64(costNumber),
		Witness:         witness,
		raw:             record,
	}, observedAt, nil
}

func parseWitness(value any, role string) (ObservationWitness, error) {
	field := role + ".witness"
	record, err := asRecord(value, field)
	if err != nil {
		return ObservationWitness{}, err
	}
	if err := exactKeys(record, []string{"provenance", "version", "validity", "dependencies"}, field); err != nil {
		return ObservationWitness{}, err
	}
	if err := requiredKeys(record, []string{"provenance"}, field); err != nil {
		return ObservationWitness{}, err
	}
	provenance, err := nonEmptyString(record["provenance"], field+".provenance")
	if err != nil || !provenanceValues[provenance] {
		return ObservationWitness{}, fmt.Errorf("%s.provenance is not a supported provenance category", field)
	}
	var version *string
	if rawVersion, exists := record["version"]; exists {
		text, err := nonEmptyString(rawVersion, field+".version")
		if err != nil {
			return ObservationWitness{}, err
		}
		version = &text
	}
	var validity *ValidityInterval
	if rawValidity, exists := record["validity"]; exists {
		validity, err = parseInterval(rawValidity, field+".validity")
		if err != nil {
			return ObservationWitness{}, err
		}
	}
	var dependencies []DependencyWitness
	if rawDependencies, exists := record["dependencies"]; exists {
		values, ok := rawDependencies.([]any)
		if !ok {
			return ObservationWitness{}, fmt.Errorf("%s.dependencies must be an array", field)
		}
		names := map[string]bool{}
		dependencies = make([]DependencyWitness, 0, len(values))
		for _, rawDependency := range values {
			dependency, err := parseDependency(rawDependency, role)
			if err != nil {
				return ObservationWitness{}, err
			}
			if names[dependency.Name] {
				return ObservationWitness{}, fmt.Errorf("duplicate dependency %s on role %s", dependency.Name, role)
			}
			names[dependency.Name] = true
			dependencies = append(dependencies, dependency)
		}
	}
	return ObservationWitness{
		Provenance:   provenance,
		Version:      version,
		Validity:     validity,
		Dependencies: dependencies,
	}, nil
}

func parseDependency(value any, role string) (DependencyWitness, error) {
	field := role + ".dependency"
	record, err := asRecord(value, field)
	if err != nil {
		return DependencyWitness{}, err
	}
	allowed := []string{"name", "resource", "relation", "version", "provenance"}
	if err := exactKeys(record, allowed, field); err != nil {
		return DependencyWitness{}, err
	}
	if err := requiredKeys(record, []string{"name", "resource", "relation", "provenance"}, field); err != nil {
		return DependencyWitness{}, err
	}
	name, err := nonEmptyString(record["name"], "dependency.name")
	if err != nil {
		return DependencyWitness{}, err
	}
	resource, err := parseResource(record["resource"], role+".dependency."+name+".resource")
	if err != nil {
		return DependencyWitness{}, err
	}
	relation, err := nonEmptyString(record["relation"], role+".dependency."+name+".relation")
	if err != nil || relation != "exact" {
		return DependencyWitness{}, fmt.Errorf("%s.dependency.%s.relation is unsupported", role, name)
	}
	provenance, err := nonEmptyString(record["provenance"], role+".dependency."+name+".provenance")
	if err != nil || !provenanceValues[provenance] {
		return DependencyWitness{}, fmt.Errorf("%s.dependency.%s.provenance is unsupported", role, name)
	}
	var version *string
	if rawVersion, exists := record["version"]; exists {
		text, err := nonEmptyString(rawVersion, role+".dependency."+name+".version")
		if err != nil {
			return DependencyWitness{}, err
		}
		version = &text
	}
	return DependencyWitness{
		Name:       name,
		Resource:   resource,
		Relation:   relation,
		Version:    version,
		Provenance: provenance,
	}, nil
}

func parseRequirement(value any) (Requirement, error) {
	record, err := asRecord(value, "requirement")
	if err != nil {
		return Requirement{}, err
	}
	if err := requiredKeys(record, []string{"id", "description", "type"}, "requirement"); err != nil {
		return Requirement{}, err
	}
	id, err := nonEmptyString(record["id"], "requirement.id")
	if err != nil {
		return Requirement{}, err
	}
	description, err := nonEmptyString(record["description"], id+".description")
	if err != nil {
		return Requirement{}, err
	}
	requirementType, err := nonEmptyString(record["type"], id+".type")
	if err != nil {
		return Requirement{}, err
	}
	var required *bool
	if rawRequired, exists := record["required"]; exists {
		value, ok := rawRequired.(bool)
		if !ok {
			return Requirement{}, fmt.Errorf("%s.required must be boolean", id)
		}
		required = &value
	}
	requirement := Requirement{
		ID:          id,
		Description: description,
		Required:    required,
		Type:        requirementType,
		raw:         record,
	}
	switch requirementType {
	case "dependency":
		allowed := []string{"id", "description", "required", "type", "dependentRole", "targetRole", "dependencyName"}
		if err := exactKeys(record, allowed, id); err != nil {
			return Requirement{}, err
		}
		if err := requiredKeys(record, []string{"dependentRole", "targetRole", "dependencyName"}, id); err != nil {
			return Requirement{}, err
		}
		requirement.DependentRole, err = nonEmptyString(record["dependentRole"], id+".dependentRole")
		if err != nil {
			return Requirement{}, err
		}
		requirement.TargetRole, err = nonEmptyString(record["targetRole"], id+".targetRole")
		if err != nil {
			return Requirement{}, err
		}
		requirement.DependencyName, err = nonEmptyString(record["dependencyName"], id+".dependencyName")
		if err != nil {
			return Requirement{}, err
		}
	case "common_valid_time":
		allowed := []string{"id", "description", "required", "type", "roles", "within"}
		if err := exactKeys(record, allowed, id); err != nil {
			return Requirement{}, err
		}
		if err := requiredKeys(record, []string{"roles", "within"}, id); err != nil {
			return Requirement{}, err
		}
		roleValues, ok := record["roles"].([]any)
		if !ok {
			return Requirement{}, fmt.Errorf("%s.roles must be an array", id)
		}
		if len(roleValues) < 2 {
			return Requirement{}, fmt.Errorf("%s must reference at least two roles", id)
		}
		seen := map[string]bool{}
		for _, rawRole := range roleValues {
			role, err := nonEmptyString(rawRole, id+".role")
			if err != nil {
				return Requirement{}, err
			}
			if seen[role] {
				return Requirement{}, fmt.Errorf("%s contains duplicate role %s", id, role)
			}
			seen[role] = true
			requirement.Roles = append(requirement.Roles, role)
		}
		requirement.Within, err = parseInterval(record["within"], id+".within")
		if err != nil {
			return Requirement{}, err
		}
	case "value_equals":
		allowed := []string{"id", "description", "required", "type", "role", "path", "expected"}
		if err := exactKeys(record, allowed, id); err != nil {
			return Requirement{}, err
		}
		if err := requiredKeys(record, []string{"role", "path", "expected"}, id); err != nil {
			return Requirement{}, err
		}
		requirement.Role, err = nonEmptyString(record["role"], id+".role")
		if err != nil {
			return Requirement{}, err
		}
		pathValues, ok := record["path"].([]any)
		if !ok || len(pathValues) == 0 {
			return Requirement{}, fmt.Errorf("%s.path must contain at least one segment", id)
		}
		for _, rawSegment := range pathValues {
			segment, err := nonEmptyString(rawSegment, id+".path segment")
			if err != nil {
				return Requirement{}, err
			}
			requirement.Path = append(requirement.Path, segment)
		}
		requirement.Expected = record["expected"]
	default:
		return Requirement{}, fmt.Errorf("unsupported requirement type: %s", requirementType)
	}
	return requirement, nil
}
