import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  dependencyVersionBaseline,
  explicitContractBaseline,
} from "../baselines.js";
import {
  coherentDeploymentScenario,
  mismatchedDeploymentScenario,
  missingDependencyScenario,
  nonOverlappingValidityScenario,
} from "../scenarios.js";
import type {
  CoherenceContract,
  Observation,
  VerificationInput,
} from "../types.js";
import { WorldCutInputError } from "../errors.js";
import { verifyDecisionContract } from "../verifier.js";

test("satisfies a decision contract when required evidence is bound correctly", () => {
  const scenario = coherentDeploymentScenario();
  const result = verifyDecisionContract(scenario.input);

  assert.equal(result.verdict, "CONTRACT_SATISFIED");
  assert.deepEqual(result.coverage, {
    required: 1,
    satisfied: 1,
    violated: 0,
    unknown: 0,
    advisory: 0,
  });
  assert.equal(result.acquisitionPlan.status, "NOT_NEEDED");
});

test("verification engine version matches the conformance ruleset", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../../conformance/0.1/manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { engineVersion: string };
  const result = verifyDecisionContract(coherentDeploymentScenario().input);

  assert.equal(result.engineVersion, manifest.engineVersion);
});

test("checks required values without model interpretation", () => {
  const scenario = coherentDeploymentScenario();
  const satisfiedInput: VerificationInput = {
    ...scenario.input,
    contract: {
      ...scenario.input.contract,
      requirements: [
        ...scenario.input.contract.requirements,
        {
          id: "ci-passed",
          type: "value_equals",
          description: "The CI conclusion is successful",
          role: "ci",
          path: ["status"],
          expected: "passed",
        },
      ],
    },
  };
  const satisfied = verifyDecisionContract(satisfiedInput);
  assert.equal(satisfied.verdict, "CONTRACT_SATISFIED");

  const violatedInput = structuredClone(satisfiedInput);
  const valueRequirement = violatedInput.contract.requirements.find(
    (requirement) => requirement.type === "value_equals",
  );
  assert.ok(valueRequirement?.type === "value_equals");
  valueRequirement.expected = "failed";
  const violated = verifyDecisionContract(violatedInput);
  assert.equal(violated.verdict, "CONTRACT_VIOLATED");

  const unknownInput = structuredClone(satisfiedInput);
  const unknownRequirement = unknownInput.contract.requirements.find(
    (requirement) => requirement.type === "value_equals",
  );
  assert.ok(unknownRequirement?.type === "value_equals");
  unknownRequirement.path = ["missing"];
  const unknown = verifyDecisionContract(unknownInput);
  assert.equal(unknown.verdict, "INSUFFICIENT_EVIDENCE");
});

test("rejects unsupported protocol versions with a structured input error", () => {
  const input = structuredClone(
    coherentDeploymentScenario().input,
  ) as unknown as VerificationInput;
  (input as unknown as { protocolVersion: string }).protocolVersion = "9";

  assert.throws(
    () => verifyDecisionContract(input),
    (error: unknown) =>
      error instanceof WorldCutInputError &&
      error.code === "WORLDCUT_INVALID_INPUT" &&
      /protocolVersion/.test(error.message),
  );
});

test("reports a requirement violation rather than claiming raw facts conflict", () => {
  const scenario = mismatchedDeploymentScenario();
  const result = verifyDecisionContract(scenario.input);

  assert.equal(result.verdict, "CONTRACT_VIOLATED");
  assert.equal(result.requirementResults[0]?.status, "VIOLATED");
  assert.match(
    result.requirementResults[0]?.summary ?? "",
    /A does not equal B/,
  );
  assert.equal(result.acquisitionPlan.status, "AVAILABLE");
  assert.ok(result.acquisitionPlan.totalCost < 5);
});

test("missing required dependency metadata cannot authorize", () => {
  const scenario = missingDependencyScenario();
  const result = verifyDecisionContract(scenario.input);

  assert.equal(result.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.requirementResults[0]?.status, "UNKNOWN");
  assert.equal(
    result.acquisitionPlan.actions[0]?.type,
    "FETCH_REQUIRED_METADATA",
  );
});

test("acquisition plan fetches every conjunctive missing version", () => {
  const scenario = coherentDeploymentScenario();
  const head = scenario.input.observations.find(
    (observation) => observation.role === "head",
  );
  const ci = scenario.input.observations.find(
    (observation) => observation.role === "ci",
  );
  assert.ok(head && ci);
  const { version: _headVersion, ...headWitnessWithoutVersion } = head.witness;
  const dependenciesWithoutVersions = ci.witness.dependencies?.map(
    (dependency) => {
      const { version: _dependencyVersion, ...withoutVersion } = dependency;
      return withoutVersion;
    },
  );
  const input: VerificationInput = {
    protocolVersion: "0.1",
    contract: scenario.input.contract,
    observations: [
      {
        ...head,
        witness: headWitnessWithoutVersion,
      },
      {
        ...ci,
        witness: {
          ...ci.witness,
          ...(dependenciesWithoutVersions
            ? { dependencies: dependenciesWithoutVersions }
            : {}),
        },
      },
    ],
  };

  const result = verifyDecisionContract(input);

  assert.equal(result.verdict, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(
    result.acquisitionPlan.actions.map((action) => action.role).sort(),
    ["ci", "head"],
  );
});

test("detects fresh observations whose scoped validity intervals never overlap", () => {
  const scenario = nonOverlappingValidityScenario();
  const result = verifyDecisionContract(scenario.input);
  const strictDependency = dependencyVersionBaseline(scenario.input, true);
  const explicit = explicitContractBaseline(scenario.input);

  assert.equal(result.verdict, "CONTRACT_VIOLATED");
  assert.equal(strictDependency.verdict, "CONTRACT_SATISFIED");
  assert.equal(explicit.verdict, result.verdict);
});

test("advisory unknown requirements do not weaken authorization semantics", () => {
  const scenario = coherentDeploymentScenario();
  const input: VerificationInput = {
    protocolVersion: "0.1",
    observations: scenario.input.observations,
    contract: {
      ...scenario.input.contract,
      requirements: [
        ...scenario.input.contract.requirements,
        {
          id: "advisory-window",
          type: "common_valid_time",
          description: "Optional context shared a validity window",
          required: false,
          roles: ["optional-a", "optional-b"],
          within: {
            from: "2026-09-02T12:00:00.000Z",
            until: "2026-09-02T12:01:00.000Z",
          },
        },
      ],
    },
  };
  const result = verifyDecisionContract(input);

  assert.equal(result.verdict, "CONTRACT_SATISFIED");
  assert.equal(result.coverage.advisory, 1);
  assert.equal(
    result.requirementResults.find(
      (requirement) => requirement.requirementId === "advisory-window",
    )?.status,
    "UNKNOWN",
  );
});

test("verification record digest is independent of input array ordering", () => {
  const scenario = mismatchedDeploymentScenario();
  const first = verifyDecisionContract(scenario.input);
  const second = verifyDecisionContract({
    protocolVersion: "0.1",
    contract: {
      ...scenario.input.contract,
      requirements: [...scenario.input.contract.requirements].reverse(),
    },
    observations: [...scenario.input.observations].reverse(),
  });

  assert.equal(first.verificationRecordDigest, second.verificationRecordDigest);
});

test("rejects ambiguous role bindings", () => {
  const scenario = coherentDeploymentScenario();
  const original = scenario.input.observations[0];
  assert.ok(original);
  const duplicated: Observation = {
    ...original,
    id: "duplicate-head",
  };

  assert.throws(
    () =>
      verifyDecisionContract({
        protocolVersion: "0.1",
        contract: scenario.input.contract,
        observations: [...scenario.input.observations, duplicated],
      }),
    /Duplicate observation role/,
  );
});

test("rejects runtime semantics the engine does not implement", () => {
  const scenario = coherentDeploymentScenario();
  const unsupportedAssumptions = {
    ...scenario.input,
    contract: {
      ...scenario.input.contract,
      assumptions: {
        clockModel: "untrusted",
        intervalModel: "closed",
        metadataModel: "byzantine",
      },
    },
  } as unknown as VerificationInput;
  assert.throws(
    () => verifyDecisionContract(unsupportedAssumptions),
    /assumptions/,
  );

  const unsupportedRelation = structuredClone(
    scenario.input,
  ) as unknown as VerificationInput;
  const dependency = unsupportedRelation.observations.find(
    (observation) => observation.role === "ci",
  )?.witness.dependencies?.[0];
  assert.ok(dependency);
  (dependency as unknown as { relation: string }).relation = "ancestor";
  assert.throws(
    () => verifyDecisionContract(unsupportedRelation),
    /relation is unsupported/,
  );

  const unknownAssumption = structuredClone(
    scenario.input,
  ) as unknown as VerificationInput;
  (
    unknownAssumption.contract.assumptions as unknown as Record<
      string,
      unknown
    >
  ).clockSkewModel = "bounded";
  assert.throws(
    () => verifyDecisionContract(unknownAssumption),
    /unsupported field/,
  );

  const unknownRequirementSemantic = structuredClone(
    scenario.input,
  ) as unknown as VerificationInput;
  (
    unknownRequirementSemantic.contract.requirements[0] as unknown as Record<
      string,
      unknown
    >
  ).minimumOverlapMilliseconds = 500;
  assert.throws(
    () => verifyDecisionContract(unknownRequirementSemantic),
    /unsupported field/,
  );
});

test("rejects duplicate temporal roles, future evidence, and empty authorization contracts", () => {
  const temporal = nonOverlappingValidityScenario();
  const duplicateRoles = structuredClone(
    temporal.input,
  ) as unknown as VerificationInput;
  const temporalRequirement = duplicateRoles.contract.requirements[0];
  assert.ok(temporalRequirement?.type === "common_valid_time");
  temporalRequirement.roles = ["approval", "approval"];
  assert.throws(
    () => verifyDecisionContract(duplicateRoles),
    /duplicate role/,
  );

  const coherent = coherentDeploymentScenario();
  const futureEvidence = structuredClone(coherent.input);
  const firstObservation = futureEvidence.observations[0];
  assert.ok(firstObservation);
  firstObservation.observedAt = "2026-09-02T12:01:00.001Z";
  assert.throws(
    () => verifyDecisionContract(futureEvidence),
    /must not be after/,
  );

  const emptyContract: CoherenceContract = {
    ...coherent.input.contract,
    requirements: [],
  };
  assert.throws(
    () =>
      verifyDecisionContract({
        protocolVersion: "0.1",
        contract: emptyContract,
        observations: coherent.input.observations,
      }),
    /at least one required requirement/,
  );
});

test("rejects non-normalized timestamps and non-finite JSON numbers", () => {
  const scenario = coherentDeploymentScenario();
  const nonNormalized = structuredClone(scenario.input);
  nonNormalized.contract.decisionTime = "2026-09-02";
  assert.throws(
    () => verifyDecisionContract(nonNormalized),
    /normalized ISO-8601/,
  );

  const nonFinite = structuredClone(scenario.input);
  const firstObservation = nonFinite.observations[0];
  assert.ok(firstObservation);
  firstObservation.value = {
    unsafe: Number.NaN,
  };
  assert.throws(() => verifyDecisionContract(nonFinite), /non-finite/);
});

test("snapshots only enumerable data and rejects accessor-driven semantics", () => {
  const scenario = coherentDeploymentScenario();
  const accessorInput = structuredClone(
    scenario.input,
  ) as unknown as VerificationInput;
  const requirement = accessorInput.contract.requirements[0];
  assert.ok(requirement);
  Object.defineProperty(requirement, "required", {
    enumerable: true,
    get: () => false,
  });
  assert.throws(
    () => verifyDecisionContract(accessorInput),
    /enumerable data/,
  );

  const hiddenInput = structuredClone(
    scenario.input,
  ) as unknown as VerificationInput;
  Object.defineProperty(hiddenInput.contract, "hiddenSemantics", {
    enumerable: false,
    value: "ignored",
  });
  assert.throws(
    () => verifyDecisionContract(hiddenInput),
    /enumerable data/,
  );
});

test("prototype accessors and __proto__ fields cannot alter contract semantics", () => {
  const mismatch = mismatchedDeploymentScenario();
  Object.defineProperty(Object.prototype, "required", {
    configurable: true,
    get: () => false,
  });
  try {
    const result = verifyDecisionContract(mismatch.input);
    assert.equal(result.verdict, "CONTRACT_VIOLATED");
    assert.equal(result.coverage.required, 1);
  } finally {
    delete (Object.prototype as { required?: unknown }).required;
  }

  const extraProtoField = structuredClone(
    coherentDeploymentScenario().input,
  ) as unknown as VerificationInput;
  Object.defineProperty(extraProtoField.contract.assumptions, "__proto__", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: "unsupported",
  });
  assert.throws(
    () => verifyDecisionContract(extraProtoField),
    /unsupported field/,
  );
});

test("inherited descriptor values cannot convert accessors into data", () => {
  const scenario = mismatchedDeploymentScenario();
  const accessorInput = structuredClone(
    scenario.input,
  ) as unknown as VerificationInput;
  const requirement = accessorInput.contract.requirements[0];
  assert.ok(requirement);
  Object.defineProperty(requirement, "required", {
    enumerable: true,
    configurable: true,
    get: () => false,
  });
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    writable: true,
    value: false,
  });
  try {
    assert.throws(
      () => verifyDecisionContract(accessorInput),
      /enumerable data/,
    );
  } finally {
    delete (Object.prototype as { value?: unknown }).value;
  }
});

test("resource identities are compared component by component", () => {
  const scenario = coherentDeploymentScenario();
  const input = structuredClone(scenario.input);
  const head = input.observations.find(
    (observation) => observation.role === "head",
  );
  const dependency = input.observations.find(
    (observation) => observation.role === "ci",
  )?.witness.dependencies?.[0];
  assert.ok(head && dependency);
  head.resource = {
    provider: "a",
    account: "b\u001fc",
    kind: "d",
    key: "e",
  };
  dependency.resource = {
    provider: "a\u001fb",
    account: "c",
    kind: "d",
    key: "e",
  };

  const result = verifyDecisionContract(input);

  assert.equal(result.verdict, "CONTRACT_VIOLATED");
  assert.match(result.requirementResults[0]?.summary ?? "", /different resource/);
});

test("requires mandatory fields and validates optional fields by presence", () => {
  const scenario = coherentDeploymentScenario();
  const missingValue = structuredClone(
    scenario.input,
  ) as unknown as VerificationInput;
  delete (
    missingValue.observations[0] as unknown as Record<string, unknown>
  ).value;
  assert.throws(
    () => verifyDecisionContract(missingValue),
    /missing required field.*value/,
  );

  const malformedValidity = structuredClone(
    scenario.input,
  ) as unknown as VerificationInput;
  (
    malformedValidity.observations[0]?.witness as unknown as Record<
      string,
      unknown
    >
  ).validity = null;
  assert.throws(
    () => verifyDecisionContract(malformedValidity),
    /validity must be a plain object/,
  );
});
