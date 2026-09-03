package worldcut

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var canonicalArrayIndex = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

func resourceJSON(resource ResourceIdentity) map[string]any {
	return map[string]any{
		"provider": resource.Provider,
		"account":  resource.Account,
		"kind":     resource.Kind,
		"key":      resource.Key,
	}
}

func intervalJSON(interval *ValidityInterval) map[string]any {
	var until any
	if interval.Until != nil {
		until = *interval.Until
	}
	return map[string]any{"from": interval.From, "until": until}
}

func sameResource(left, right ResourceIdentity) bool {
	return left == right
}

func action(actionType string, observation *Observation, role, description string, expected any) (AcquisitionAction, error) {
	var cost int64 = 1
	if observation != nil {
		cost = observation.AcquisitionCost
		if actionType == "FETCH_REQUIRED_METADATA" {
			cost = (cost + 3) / 4
			if cost < 1 {
				cost = 1
			}
		}
	}
	expectedDigest := "none"
	if expected != nil {
		digest, err := SHA256Digest(expected)
		if err != nil {
			return AcquisitionAction{}, err
		}
		expectedDigest = digest[:12]
	}
	return AcquisitionAction{
		ID:          strings.ToLower(actionType) + ":" + role + ":" + expectedDigest,
		Type:        actionType,
		Role:        role,
		Cost:        cost,
		Description: description,
		Expected:    expected,
	}, nil
}

func option(requirementID, suffix, description string, actions []AcquisitionAction) AcquisitionOption {
	return AcquisitionOption{
		ID:          requirementID + ":" + suffix,
		Description: description,
		Actions:     actions,
	}
}

func missingRolesResult(requirement Requirement, roles []string) (RequirementResult, error) {
	actions := make([]AcquisitionAction, 0, len(roles))
	for _, role := range roles {
		candidate, err := action("REFRESH_OBSERVATION", nil, role, "Acquire an observation for role "+role+".", nil)
		if err != nil {
			return RequirementResult{}, err
		}
		actions = append(actions, candidate)
	}
	return RequirementResult{
		RequirementID:   requirement.ID,
		RequirementType: requirement.Type,
		Required:        requirement.isRequired(),
		Status:          "UNKNOWN",
		Summary:         "No observations are bound to required role(s): " + strings.Join(roles, ", ") + ".",
		Details:         map[string]any{"missingRoles": roles},
		AcquisitionOptions: []AcquisitionOption{
			option(requirement.ID, "acquire-missing-roles", "Acquire every missing role required to evaluate this requirement.", actions),
		},
	}, nil
}

func evaluateDependency(requirement Requirement, observations map[string]*Observation) (RequirementResult, error) {
	var missing []string
	for _, role := range []string{requirement.DependentRole, requirement.TargetRole} {
		if observations[role] == nil {
			missing = append(missing, role)
		}
	}
	if len(missing) != 0 {
		return missingRolesResult(requirement, missing)
	}
	dependent := observations[requirement.DependentRole]
	target := observations[requirement.TargetRole]
	var dependency *DependencyWitness
	for i := range dependent.Witness.Dependencies {
		if dependent.Witness.Dependencies[i].Name == requirement.DependencyName {
			dependency = &dependent.Witness.Dependencies[i]
			break
		}
	}
	if dependency == nil {
		first, err := action(
			"FETCH_REQUIRED_METADATA",
			dependent,
			dependent.Role,
			"Fetch dependency metadata for "+dependent.Role+".",
			map[string]any{
				"dependencyName": requirement.DependencyName,
				"targetResource": resourceJSON(target.Resource),
			},
		)
		if err != nil {
			return RequirementResult{}, err
		}
		actions := []AcquisitionAction{first}
		if target.Witness.Version == nil {
			second, err := action("FETCH_REQUIRED_METADATA", target, target.Role, "Fetch the resource version for "+target.Role+".", nil)
			if err != nil {
				return RequirementResult{}, err
			}
			actions = append(actions, second)
		}
		return RequirementResult{
			RequirementID:   requirement.ID,
			RequirementType: requirement.Type,
			Required:        requirement.isRequired(),
			Status:          "UNKNOWN",
			Summary:         dependent.Role + " does not expose dependency " + requirement.DependencyName + ".",
			Details: map[string]any{
				"dependentRole":     dependent.Role,
				"targetRole":        target.Role,
				"missingDependency": requirement.DependencyName,
			},
			AcquisitionOptions: []AcquisitionOption{
				option(requirement.ID, "fetch-dependency-metadata", "Fetch all metadata required to compare the dependency.", actions),
			},
		}, nil
	}
	if !sameResource(dependency.Resource, target.Resource) {
		candidate, err := action(
			"ACQUIRE_COMPATIBLE_EVIDENCE",
			dependent,
			dependent.Role,
			"Acquire "+dependent.Role+" evidence for the selected "+target.Role+" resource.",
			map[string]any{"targetResource": resourceJSON(target.Resource)},
		)
		if err != nil {
			return RequirementResult{}, err
		}
		return RequirementResult{
			RequirementID:      requirement.ID,
			RequirementType:    requirement.Type,
			Required:           requirement.isRequired(),
			Status:             "VIOLATED",
			Summary:            dependent.Role + " is bound to a different resource than " + target.Role + ".",
			Details:            map[string]any{"dependentResource": resourceJSON(dependency.Resource), "targetResource": resourceJSON(target.Resource)},
			AcquisitionOptions: []AcquisitionOption{option(requirement.ID, "acquire-compatible-resource", "Acquire dependent evidence bound to the selected target resource.", []AcquisitionAction{candidate})},
		}, nil
	}
	if dependency.Version == nil || target.Witness.Version == nil {
		actions := []AcquisitionAction{}
		if dependency.Version == nil {
			candidate, err := action(
				"FETCH_REQUIRED_METADATA",
				dependent,
				dependent.Role,
				"Fetch the dependency version for "+dependent.Role+".",
				map[string]any{"dependencyName": requirement.DependencyName},
			)
			if err != nil {
				return RequirementResult{}, err
			}
			actions = append(actions, candidate)
		}
		if target.Witness.Version == nil {
			candidate, err := action("FETCH_REQUIRED_METADATA", target, target.Role, "Fetch the resource version for "+target.Role+".", nil)
			if err != nil {
				return RequirementResult{}, err
			}
			actions = append(actions, candidate)
		}
		var dependencyVersion any
		if dependency.Version != nil {
			dependencyVersion = *dependency.Version
		}
		var targetVersion any
		if target.Witness.Version != nil {
			targetVersion = *target.Witness.Version
		}
		return RequirementResult{
			RequirementID:   requirement.ID,
			RequirementType: requirement.Type,
			Required:        requirement.isRequired(),
			Status:          "UNKNOWN",
			Summary:         "Version evidence is incomplete for " + requirement.Description + ".",
			Details:         map[string]any{"dependencyVersion": dependencyVersion, "targetVersion": targetVersion},
			AcquisitionOptions: []AcquisitionOption{
				option(requirement.ID, "fetch-all-version-metadata", "Fetch every missing version needed for this comparison.", actions),
			},
		}, nil
	}
	dependencyVersion := *dependency.Version
	targetVersion := *target.Witness.Version
	if dependencyVersion != targetVersion {
		dependentAction, err := action(
			"ACQUIRE_COMPATIBLE_EVIDENCE",
			dependent,
			dependent.Role,
			"Acquire "+dependent.Role+" evidence bound to "+targetVersion+".",
			map[string]any{"targetRole": target.Role, "targetVersion": targetVersion},
		)
		if err != nil {
			return RequirementResult{}, err
		}
		targetAction, err := action(
			"REFRESH_OBSERVATION",
			target,
			target.Role,
			"Refresh "+target.Role+" before selecting compatible evidence.",
			map[string]any{"dependentRole": dependent.Role, "dependentVersion": dependencyVersion},
		)
		if err != nil {
			return RequirementResult{}, err
		}
		return RequirementResult{
			RequirementID:   requirement.ID,
			RequirementType: requirement.Type,
			Required:        requirement.isRequired(),
			Status:          "VIOLATED",
			Summary:         fmt.Sprintf("%s: %s does not equal %s.", requirement.Description, dependencyVersion, targetVersion),
			Details: map[string]any{
				"dependentRole":     dependent.Role,
				"dependencyVersion": dependencyVersion,
				"targetRole":        target.Role,
				"targetVersion":     targetVersion,
				"relation":          dependency.Relation,
			},
			AcquisitionOptions: []AcquisitionOption{
				option(requirement.ID, "acquire-compatible-dependent", "Acquire dependent evidence bound to the selected target version.", []AcquisitionAction{dependentAction}),
				option(requirement.ID, "refresh-target", "Refresh the target before selecting compatible evidence.", []AcquisitionAction{targetAction}),
			},
		}, nil
	}
	return RequirementResult{
		RequirementID:      requirement.ID,
		RequirementType:    requirement.Type,
		Required:           requirement.isRequired(),
		Status:             "SATISFIED",
		Summary:            requirement.Description + ": both roles are bound to " + dependencyVersion + ".",
		Details:            map[string]any{"dependentRole": dependent.Role, "targetRole": target.Role, "version": dependencyVersion},
		AcquisitionOptions: []AcquisitionOption{},
	}, nil
}

func intervalTimes(interval *ValidityInterval) (time.Time, *time.Time) {
	start, _ := time.Parse(timestampLayout, interval.From)
	if interval.Until == nil {
		return start, nil
	}
	end, _ := time.Parse(timestampLayout, *interval.Until)
	return start, &end
}

func formatTime(value time.Time) string {
	return value.UTC().Format(timestampLayout)
}

func evaluateCommonValidTime(requirement Requirement, observationsByRole map[string]*Observation) (RequirementResult, error) {
	missingRoles := []string{}
	observations := []*Observation{}
	missingValidity := []*Observation{}
	for _, role := range requirement.Roles {
		observation := observationsByRole[role]
		if observation == nil {
			missingRoles = append(missingRoles, role)
			continue
		}
		observations = append(observations, observation)
		if observation.Witness.Validity == nil {
			missingValidity = append(missingValidity, observation)
		}
	}
	prerequisites := []AcquisitionAction{}
	for _, role := range missingRoles {
		candidate, err := action("REFRESH_OBSERVATION", nil, role, "Acquire an observation for role "+role+".", nil)
		if err != nil {
			return RequirementResult{}, err
		}
		prerequisites = append(prerequisites, candidate)
	}
	for _, observation := range missingValidity {
		candidate, err := action(
			"FETCH_REQUIRED_METADATA",
			observation,
			observation.Role,
			"Fetch validity metadata for "+observation.Role+".",
			map[string]any{"within": intervalJSON(requirement.Within)},
		)
		if err != nil {
			return RequirementResult{}, err
		}
		prerequisites = append(prerequisites, candidate)
	}
	latestStart, earliestEnd := intervalTimes(requirement.Within)
	for _, observation := range observations {
		if observation.Witness.Validity == nil {
			continue
		}
		start, end := intervalTimes(observation.Witness.Validity)
		if start.After(latestStart) {
			latestStart = start
		}
		if end != nil && (earliestEnd == nil || end.Before(*earliestEnd)) {
			copy := *end
			earliestEnd = &copy
		}
	}
	missingValidityRoles := make([]string, 0, len(missingValidity))
	for _, observation := range missingValidity {
		missingValidityRoles = append(missingValidityRoles, observation.Role)
	}
	if earliestEnd != nil && !latestStart.Before(*earliestEnd) {
		options := make([]AcquisitionOption, 0, len(observations))
		for _, observation := range observations {
			refresh, err := action(
				"REFRESH_OBSERVATION",
				observation,
				observation.Role,
				"Refresh "+observation.Role+" to seek a compatible validity window.",
				map[string]any{"within": intervalJSON(requirement.Within)},
			)
			if err != nil {
				return RequirementResult{}, err
			}
			actions := append([]AcquisitionAction{refresh}, prerequisites...)
			options = append(options, option(
				requirement.ID,
				"refresh-"+observation.Role,
				"Refresh "+observation.Role+" and acquire every other missing prerequisite.",
				actions,
			))
		}
		return RequirementResult{
			RequirementID:   requirement.ID,
			RequirementType: requirement.Type,
			Required:        requirement.isRequired(),
			Status:          "VIOLATED",
			Summary:         requirement.Description + ": the known validity intervals do not overlap.",
			Details: map[string]any{
				"roles":                requirement.Roles,
				"latestStart":          formatTime(latestStart),
				"earliestEnd":          formatTime(*earliestEnd),
				"missingRoles":         missingRoles,
				"missingValidityRoles": missingValidityRoles,
			},
			AcquisitionOptions: options,
		}, nil
	}
	var endJSON any
	if earliestEnd != nil {
		endJSON = formatTime(*earliestEnd)
	}
	if len(missingRoles) != 0 || len(missingValidity) != 0 {
		return RequirementResult{
			RequirementID:   requirement.ID,
			RequirementType: requirement.Type,
			Required:        requirement.isRequired(),
			Status:          "UNKNOWN",
			Summary:         requirement.Description + ": validity evidence is incomplete.",
			Details: map[string]any{
				"roles":                requirement.Roles,
				"missingRoles":         missingRoles,
				"missingValidityRoles": missingValidityRoles,
				"possibleKnownWindow":  map[string]any{"from": formatTime(latestStart), "until": endJSON},
			},
			AcquisitionOptions: []AcquisitionOption{
				option(requirement.ID, "acquire-all-validity-prerequisites", "Acquire every missing observation and validity witness.", prerequisites),
			},
		}, nil
	}
	return RequirementResult{
		RequirementID:   requirement.ID,
		RequirementType: requirement.Type,
		Required:        requirement.isRequired(),
		Status:          "SATISFIED",
		Summary:         requirement.Description + ": a common valid time exists.",
		Details: map[string]any{
			"roles":        requirement.Roles,
			"commonWindow": map[string]any{"from": formatTime(latestStart), "until": endJSON},
		},
		AcquisitionOptions: []AcquisitionOption{},
	}, nil
}

func valueAtPath(value any, path []string) (any, bool) {
	current := value
	for _, segment := range path {
		switch typed := current.(type) {
		case []any:
			if !canonicalArrayIndex.MatchString(segment) {
				return nil, false
			}
			index, err := strconv.ParseUint(segment, 10, 64)
			if err != nil || index >= uint64(len(typed)) {
				return nil, false
			}
			current = typed[index]
		case map[string]any:
			next, ok := typed[segment]
			if !ok {
				return nil, false
			}
			current = next
		default:
			return nil, false
		}
	}
	return current, true
}

func evaluateValueEquals(requirement Requirement, observations map[string]*Observation) (RequirementResult, error) {
	observation := observations[requirement.Role]
	if observation == nil {
		return missingRolesResult(requirement, []string{requirement.Role})
	}
	displayPath := strings.Join(requirement.Path, ".")
	actual, found := valueAtPath(observation.Value, requirement.Path)
	if !found {
		candidate, err := action(
			"ACQUIRE_COMPATIBLE_EVIDENCE",
			observation,
			observation.Role,
			"Acquire "+observation.Role+" evidence containing "+displayPath+".",
			map[string]any{"path": requirement.Path, "expected": requirement.Expected},
		)
		if err != nil {
			return RequirementResult{}, err
		}
		return RequirementResult{
			RequirementID:   requirement.ID,
			RequirementType: requirement.Type,
			Required:        requirement.isRequired(),
			Status:          "UNKNOWN",
			Summary:         requirement.Description + ": value path " + displayPath + " is missing.",
			Details:         map[string]any{"role": requirement.Role, "path": requirement.Path, "expected": requirement.Expected},
			AcquisitionOptions: []AcquisitionOption{
				option(requirement.ID, "acquire-value", "Acquire evidence containing the required value path.", []AcquisitionAction{candidate}),
			},
		}, nil
	}
	actualCanonical, err := CanonicalJSON(actual)
	if err != nil {
		return RequirementResult{}, err
	}
	expectedCanonical, err := CanonicalJSON(requirement.Expected)
	if err != nil {
		return RequirementResult{}, err
	}
	if string(actualCanonical) != string(expectedCanonical) {
		candidate, err := action(
			"REFRESH_OBSERVATION",
			observation,
			observation.Role,
			"Refresh "+observation.Role+" before evaluating "+displayPath+".",
			map[string]any{"path": requirement.Path, "expected": requirement.Expected},
		)
		if err != nil {
			return RequirementResult{}, err
		}
		return RequirementResult{
			RequirementID:   requirement.ID,
			RequirementType: requirement.Type,
			Required:        requirement.isRequired(),
			Status:          "VIOLATED",
			Summary:         requirement.Description + ": observed value does not equal the required value.",
			Details:         map[string]any{"role": requirement.Role, "path": requirement.Path, "expected": requirement.Expected, "actual": actual},
			AcquisitionOptions: []AcquisitionOption{
				option(requirement.ID, "refresh-value", "Refresh the observation before evaluating the value again.", []AcquisitionAction{candidate}),
			},
		}, nil
	}
	return RequirementResult{
		RequirementID:      requirement.ID,
		RequirementType:    requirement.Type,
		Required:           requirement.isRequired(),
		Status:             "SATISFIED",
		Summary:            requirement.Description + ": observed value matches the requirement.",
		Details:            map[string]any{"role": requirement.Role, "path": requirement.Path, "expected": requirement.Expected},
		AcquisitionOptions: []AcquisitionOption{},
	}, nil
}
