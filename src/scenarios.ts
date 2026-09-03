import type {
  CoherenceContract,
  Observation,
  ResourceIdentity,
  VerificationInput,
} from "./types.js";

const BASE_TIME = Date.parse("2026-09-02T12:00:00.000Z");

function iso(offsetMilliseconds: number): string {
  return new Date(BASE_TIME + offsetMilliseconds).toISOString();
}

function resource(
  provider: string,
  account: string,
  kind: string,
  key: string,
): ResourceIdentity {
  return { provider, account, kind, key };
}

const headResource = resource(
  "github",
  "acme",
  "branch_head",
  "payments/main",
);
const ciResource = resource("ci.example", "acme", "ci_run", "latest-success");
const approvalResource = resource(
  "crm.example",
  "acme",
  "approval",
  "change-42",
);
const quoteResource = resource(
  "pricing.example",
  "acme",
  "quote",
  "change-42",
);

function deploymentContract(): CoherenceContract {
  return {
    id: "deploy-current-tested-head",
    version: "1",
    decisionTime: iso(60_000),
    assumptions: {
      clockModel: "trusted_normalized",
      intervalModel: "half_open",
      metadataModel: "honest_but_possibly_incomplete",
    },
    requirements: [
      {
        id: "ci-tested-current-head",
        type: "dependency",
        description: "The passing CI run tested the selected branch head",
        dependentRole: "ci",
        targetRole: "head",
        dependencyName: "tested_head",
      },
    ],
  };
}

function headObservation(version: string): Observation {
  return {
    id: `head-${version}`,
    role: "head",
    resource: headResource,
    value: { head: version },
    observedAt: iso(59_000),
    acquisitionCost: 1,
    witness: {
      provenance: "provider_asserted",
      version,
    },
  };
}

function ciObservation(
  testedVersion: string | null,
  runId: string,
): Observation {
  return {
    id: runId,
    role: "ci",
    resource: ciResource,
    value: { status: "passed" },
    observedAt: iso(59_500),
    acquisitionCost: 4,
    witness: {
      provenance: "provider_asserted",
      version: runId,
      dependencies:
        testedVersion === null
          ? []
          : [
              {
                name: "tested_head",
                resource: headResource,
                relation: "exact",
                version: testedVersion,
                provenance: "provider_asserted",
              },
            ],
    },
  };
}

export interface Scenario {
  id: string;
  description: string;
  input: VerificationInput;
  groundTruthSafe: boolean;
  metadataComplete: boolean;
}

export function coherentDeploymentScenario(): Scenario {
  return {
    id: "coherent-deployment",
    description: "The passing CI run is bound to the current branch head.",
    input: {
      protocolVersion: "0.1",
      contract: deploymentContract(),
      observations: [headObservation("B"), ciObservation("B", "ci-101")],
    },
    groundTruthSafe: true,
    metadataComplete: true,
  };
}

export function mismatchedDeploymentScenario(): Scenario {
  return {
    id: "mismatched-deployment",
    description:
      "The current branch head is B, but the selected passing CI run tested A.",
    input: {
      protocolVersion: "0.1",
      contract: deploymentContract(),
      observations: [headObservation("B"), ciObservation("A", "ci-100")],
    },
    groundTruthSafe: false,
    metadataComplete: true,
  };
}

export function missingDependencyScenario(): Scenario {
  return {
    id: "missing-dependency",
    description:
      "The CI provider reports PASS without identifying the tested revision.",
    input: {
      protocolVersion: "0.1",
      contract: deploymentContract(),
      observations: [headObservation("B"), ciObservation(null, "ci-unknown")],
    },
    groundTruthSafe: false,
    metadataComplete: false,
  };
}

export function nonOverlappingValidityScenario(): Scenario {
  const contract: CoherenceContract = {
    id: "approval-and-quote-coexisted",
    version: "1",
    decisionTime: iso(60_000),
    assumptions: {
      clockModel: "trusted_normalized",
      intervalModel: "half_open",
      metadataModel: "honest_but_possibly_incomplete",
    },
    requirements: [
      {
        id: "approval-quote-common-time",
        type: "common_valid_time",
        description:
          "The approval and quoted terms were simultaneously valid during the decision window",
        roles: ["approval", "quote"],
        within: {
          from: iso(0),
          until: iso(60_001),
        },
      },
    ],
  };
  const approval: Observation = {
    id: "approval-1",
    role: "approval",
    resource: approvalResource,
    value: { approved: true },
    observedAt: iso(59_000),
    acquisitionCost: 2,
    witness: {
      provenance: "provider_asserted",
      version: "approval-v1",
      validity: {
        from: iso(0),
        until: iso(30_000),
      },
    },
  };
  const quote: Observation = {
    id: "quote-1",
    role: "quote",
    resource: quoteResource,
    value: { price: 1250, currency: "USD" },
    observedAt: iso(59_500),
    acquisitionCost: 3,
    witness: {
      provenance: "provider_asserted",
      version: "quote-v1",
      validity: {
        from: iso(30_001),
        until: iso(90_000),
      },
    },
  };
  return {
    id: "fresh-but-never-concurrent",
    description:
      "Both records were fetched recently, but their declared validity intervals never overlap.",
    input: {
      protocolVersion: "0.1",
      contract,
      observations: [approval, quote],
    },
    groundTruthSafe: false,
    metadataComplete: true,
  };
}
