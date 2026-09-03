package worldcut

import (
	"fmt"
	"sort"
	"strings"
)

const (
	maxUnresolvedRequirements = 64
	maxOptionCombinations     = 65_536
	maxSearchStates           = (maxUnresolvedRequirements + 1) * maxOptionCombinations
	maxPlanTotalCost          = int64(64_000_000_000)
)

type planCandidate struct {
	optionIDs []string
	actions   []AcquisitionAction
	cost      int64
}

type planState struct {
	index     int
	optionIDs []string
	actions   map[string]AcquisitionAction
	cost      int64
}

func sortedResults(results []RequirementResult) {
	sort.Slice(results, func(i, j int) bool {
		return compareUTF16(results[i].RequirementID, results[j].RequirementID) < 0
	})
}

func sortedStrings(values []string) {
	sort.Slice(values, func(i, j int) bool {
		return compareUTF16(values[i], values[j]) < 0
	})
}

func sortedActionValues(actions map[string]AcquisitionAction) []AcquisitionAction {
	result := make([]AcquisitionAction, 0, len(actions))
	for _, candidate := range actions {
		result = append(result, candidate)
	}
	sort.Slice(result, func(i, j int) bool {
		return compareUTF16(result[i].ID, result[j].ID) < 0
	})
	return result
}

func compareCandidates(left, right planCandidate) int {
	if left.cost < right.cost {
		return -1
	}
	if left.cost > right.cost {
		return 1
	}
	if len(left.actions) < len(right.actions) {
		return -1
	}
	if len(left.actions) > len(right.actions) {
		return 1
	}
	return compareUTF16(strings.Join(left.optionIDs, "\x00"), strings.Join(right.optionIDs, "\x00"))
}

func incompletePlan(reason string, unresolved []RequirementResult) AcquisitionPlan {
	ids := make([]string, len(unresolved))
	for i, result := range unresolved {
		ids[i] = result.RequirementID
	}
	return AcquisitionPlan{
		Status:                   "INCOMPLETE",
		Reason:                   &reason,
		Actions:                  []AcquisitionAction{},
		SelectedOptionIDs:        []string{},
		TotalCost:                0,
		CoveredRequirementIDs:    []string{},
		UnresolvedRequirementIDs: ids,
	}
}

func addOption(state planState, candidate AcquisitionOption) (planState, error) {
	actions := make(map[string]AcquisitionAction, len(state.actions)+len(candidate.Actions))
	for id, existing := range state.actions {
		actions[id] = existing
	}
	cost := state.cost
	for _, newAction := range candidate.Actions {
		if newAction.Cost < 0 || newAction.Cost > maxAcquisitionCost {
			return planState{}, invalidInput("acquisition action %s cost must be between 0 and %d", newAction.ID, maxAcquisitionCost)
		}
		if existing, ok := actions[newAction.ID]; ok {
			if existing.Cost != newAction.Cost {
				return planState{}, fmt.Errorf("acquisition action %s has conflicting declared costs", newAction.ID)
			}
			continue
		}
		if cost > maxPlanTotalCost-newAction.Cost {
			return planState{}, invalidInput("acquisition plan cost exceeds %d", maxPlanTotalCost)
		}
		actions[newAction.ID] = newAction
		cost += newAction.Cost
	}
	return planState{
		index:     state.index + 1,
		optionIDs: append(append([]string{}, state.optionIDs...), candidate.ID),
		actions:   actions,
		cost:      cost,
	}, nil
}

func SelectAcquisitionPlan(results []RequirementResult) (AcquisitionPlan, error) {
	var unresolved []RequirementResult
	for _, result := range results {
		if result.Required && result.Status != "SATISFIED" {
			unresolved = append(unresolved, result)
		}
	}
	sortedResults(unresolved)
	if len(unresolved) == 0 {
		return AcquisitionPlan{
			Status:                   "NOT_NEEDED",
			Reason:                   nil,
			Actions:                  []AcquisitionAction{},
			SelectedOptionIDs:        []string{},
			TotalCost:                0,
			CoveredRequirementIDs:    []string{},
			UnresolvedRequirementIDs: []string{},
		}, nil
	}
	if len(unresolved) > maxUnresolvedRequirements {
		return incompletePlan("Acquisition planning supports at most 64 unresolved requirements.", unresolved), nil
	}
	var coverable []RequirementResult
	impossible := []string{}
	combinations := 1
	for _, result := range unresolved {
		if len(result.AcquisitionOptions) == 0 {
			impossible = append(impossible, result.RequirementID)
			continue
		}
		if combinations > maxOptionCombinations/len(result.AcquisitionOptions) {
			return incompletePlan("Acquisition search exceeds the 65536 combination limit.", unresolved), nil
		}
		combinations *= len(result.AcquisitionOptions)
		coverable = append(coverable, result)
	}
	stack := []planState{{actions: map[string]AcquisitionAction{}}}
	var best *planCandidate
	visited := 0
	for len(stack) != 0 {
		visited++
		if visited > maxSearchStates {
			return incompletePlan("Acquisition search exceeds the 4259840 state limit.", unresolved), nil
		}
		state := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if best != nil && state.cost > best.cost {
			continue
		}
		if state.index >= len(coverable) {
			optionIDs := append([]string{}, state.optionIDs...)
			sortedStrings(optionIDs)
			candidate := planCandidate{
				optionIDs: optionIDs,
				actions:   sortedActionValues(state.actions),
				cost:      state.cost,
			}
			if best == nil || compareCandidates(candidate, *best) < 0 {
				best = &candidate
			}
			continue
		}
		options := append([]AcquisitionOption{}, coverable[state.index].AcquisitionOptions...)
		sort.Slice(options, func(i, j int) bool {
			return compareUTF16(options[i].ID, options[j].ID) < 0
		})
		for i := len(options) - 1; i >= 0; i-- {
			next, err := addOption(state, options[i])
			if err != nil {
				return AcquisitionPlan{}, err
			}
			if best == nil || next.cost <= best.cost {
				stack = append(stack, next)
			}
		}
	}
	if best == nil {
		return incompletePlan("Acquisition search completed without a valid option set.", unresolved), nil
	}
	covered := make([]string, len(coverable))
	for i, result := range coverable {
		covered[i] = result.RequirementID
	}
	sortedStrings(impossible)
	status := "AVAILABLE"
	var reason *string
	if len(impossible) != 0 {
		status = "INCOMPLETE"
		text := "No acquisition option is available for: " + strings.Join(impossible, ", ") + "."
		reason = &text
	}
	return AcquisitionPlan{
		Status:                   status,
		Reason:                   reason,
		Actions:                  best.actions,
		SelectedOptionIDs:        best.optionIDs,
		TotalCost:                best.cost,
		CoveredRequirementIDs:    covered,
		UnresolvedRequirementIDs: impossible,
	}, nil
}
