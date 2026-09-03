package worldcut

import "testing"

func testAction(id string, cost int64) AcquisitionAction {
	return AcquisitionAction{
		ID:          id,
		Type:        "REFRESH_OBSERVATION",
		Role:        id,
		Cost:        cost,
		Description: id,
		Expected:    nil,
	}
}

func testOption(id string, actions ...AcquisitionAction) AcquisitionOption {
	return AcquisitionOption{ID: id, Description: id, Actions: actions}
}

func unresolved(id string, options ...AcquisitionOption) RequirementResult {
	return RequirementResult{
		RequirementID:      id,
		RequirementType:    "dependency",
		Required:           true,
		Status:             "UNKNOWN",
		Summary:            id,
		Details:            nil,
		AcquisitionOptions: options,
	}
}

func TestPlannerDeduplicatesSharedActions(t *testing.T) {
	shared := testAction("shared", 3)
	plan, err := SelectAcquisitionPlan([]RequirementResult{
		unresolved("r1", testOption("r1-shared", shared), testOption("r1-only", testAction("r1", 2))),
		unresolved("r2", testOption("r2-shared", shared), testOption("r2-only", testAction("r2", 2))),
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Status != "AVAILABLE" || plan.TotalCost != 3 || len(plan.Actions) != 1 || plan.Actions[0].ID != "shared" {
		t.Fatalf("unexpected plan: %+v", plan)
	}
}

func TestPlannerTieBreaksByActionCountThenOptionID(t *testing.T) {
	plan, err := SelectAcquisitionPlan([]RequirementResult{
		unresolved("r", testOption("r:b", testAction("one", 2)), testOption("r:a", testAction("left", 1), testAction("right", 1))),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.SelectedOptionIDs) != 1 || plan.SelectedOptionIDs[0] != "r:b" {
		t.Fatalf("unexpected selected option: %+v", plan)
	}
}
