import assert from "node:assert/strict";
import test from "node:test";
import { selectAcquisitionPlan } from "../acquisition-plan.js";
import type {
  AcquisitionAction,
  AcquisitionOption,
  RequirementResult,
} from "../types.js";

function action(
  id: string,
  cost: number,
): AcquisitionAction {
  return {
    id,
    type: "REFRESH_OBSERVATION",
    role: id,
    cost,
    description: id,
    expected: null,
  };
}

function option(
  id: string,
  actions: AcquisitionAction[],
): AcquisitionOption {
  return {
    id,
    description: id,
    actions,
  };
}

function unresolved(
  requirementId: string,
  options: AcquisitionOption[],
): RequirementResult {
  return {
    requirementId,
    requirementType: "dependency",
    required: true,
    status: "UNKNOWN",
    summary: requirementId,
    details: null,
    acquisitionOptions: options,
  };
}

test("selects the lowest-cost bounded action set", () => {
  const shared = action("shared", 3);
  const result = selectAcquisitionPlan([
    unresolved("r1", [
      option("r1-shared", [shared]),
      option("r1-only", [action("only-r1", 2)]),
    ]),
    unresolved("r2", [
      option("r2-shared", [shared]),
      option("r2-only", [action("only-r2", 2)]),
    ]),
  ]);

  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(
    result.actions.map((candidate) => candidate.id),
    ["shared"],
  );
  assert.equal(result.totalCost, 3);
});

test("preserves conjunctive actions inside one acquisition option", () => {
  const result = selectAcquisitionPlan([
    unresolved("r1", [
      option("both-required", [action("left", 1), action("right", 1)]),
    ]),
  ]);

  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(
    result.actions.map((candidate) => candidate.id),
    ["left", "right"],
  );
  assert.equal(result.totalCost, 2);
});

test("reports an incomplete plan when a requirement has no acquisition action", () => {
  const result = selectAcquisitionPlan([
    unresolved("r1", [option("r1", [action("only-r1", 1)])]),
    unresolved("r2", []),
  ]);

  assert.equal(result.status, "INCOMPLETE");
  assert.deepEqual(result.unresolvedRequirementIds, ["r2"]);
});

test("bounds combinatorial acquisition searches", () => {
  const requirements = Array.from({ length: 17 }, (_, index) =>
    unresolved(`r${index}`, [
      option(`r${index}-a`, [action(`a${index}`, 0)]),
      option(`r${index}-b`, [action(`b${index}`, 0)]),
    ]),
  );

  const result = selectAcquisitionPlan(requirements);

  assert.equal(result.status, "INCOMPLETE");
  assert.match(result.reason ?? "", /combination limit/);
  assert.equal(result.actions.length, 0);
  assert.equal(result.unresolvedRequirementIds.length, 17);
});

test("finds the exact optimum at the combination boundary", () => {
  const requirements = Array.from({ length: 16 }, (_, index) =>
    unresolved(`r${index}`, [
      option(`r${index}-costly`, [action(`costly-${index}`, 1)]),
      option(`r${index}-free`, [action(`free-${index}`, 0)]),
    ]),
  );
  requirements.push(
    unresolved("tail", [option("tail-only", [action("tail", 0)])]),
  );

  const result = selectAcquisitionPlan(requirements);

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.totalCost, 0);
  assert.equal(result.selectedOptionIds.length, 17);
});

test("bounds long single-option chains without recursion", () => {
  const requirements = Array.from({ length: 65 }, (_, index) =>
    unresolved(`r${index}`, [
      option(`r${index}-only`, [action(`action-${index}`, 0)]),
    ]),
  );

  const result = selectAcquisitionPlan(requirements);

  assert.equal(result.status, "INCOMPLETE");
  assert.match(result.reason ?? "", /at most 64/);
});

test("rejects fractional action costs", () => {
  assert.throws(
    () =>
      selectAcquisitionPlan([
        unresolved("r1", [
          option("fractional", [action("fractional", 0.5)]),
        ]),
      ]),
    /cost must be between/,
  );
});
