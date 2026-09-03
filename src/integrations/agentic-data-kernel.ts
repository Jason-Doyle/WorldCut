import { WorldCutIntegrationError } from "../errors.js";
import { snapshotJsonData } from "../canonical.js";
import type {
  CoherenceContract,
  DependencyWitness,
  JsonValue,
  Observation,
  ResourceIdentity,
  WitnessProvenance,
} from "../types.js";
import { verifyDecisionContract } from "../verifier.js";

export interface AgenticDataAssertionLike {
  tenantId: string;
  assertionId: string;
  object: JsonValue;
  validFrom: string;
  validTo: string | null;
  systemFrom: string;
  systemTo: string | null;
  status:
    | "active"
    | "disputed"
    | "superseded"
    | "expired"
    | "quarantined"
    | "deleted";
  basis: JsonValue | null;
}

export interface AgenticDataResolutionLike {
  status: "known" | "unknown" | "conflicted" | "resolved_with_conflict";
  selected: AgenticDataAssertionLike | null;
  validAt: string;
  systemAt: string;
}

export interface AgenticDataAdapterOptions {
  allowResolvedWithConflict?: boolean;
}

interface WorldCutBasis {
  protocolVersion: "0.1";
  role: string;
  resource: ResourceIdentity;
  provenance: WitnessProvenance;
  version?: string;
  dependencies?: DependencyWitness[];
  acquisitionCost?: number;
}

function invalid(message: string): never {
  throw new WorldCutIntegrationError(
    "WORLDCUT_ADK_RESOLUTION_INVALID",
    message,
  );
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "string") {
    return invalid(`${field} must be a normalized timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    return invalid(`${field} must be normalized ISO-8601 UTC`);
  }
  return parsed;
}

function activeAt(
  start: string,
  end: string | null,
  at: string,
  field: string,
): boolean {
  const startTime = timestamp(start, `${field}.from`);
  const atTime = timestamp(at, `${field}.at`);
  const endTime = end === null ? Number.POSITIVE_INFINITY : timestamp(end, `${field}.to`);
  return startTime <= atTime && atTime < endTime;
}

function worldCutBasis(assertion: AgenticDataAssertionLike): WorldCutBasis {
  const basis = record(assertion.basis, "assertion.basis");
  const candidate = record(basis.worldcut, "assertion.basis.worldcut");
  const allowedFields = new Set([
    "protocolVersion",
    "role",
    "resource",
    "provenance",
    "version",
    "dependencies",
    "acquisitionCost",
  ]);
  const unknownFields = Object.keys(candidate).filter(
    (field) => !allowedFields.has(field),
  );
  if (unknownFields.length > 0) {
    return invalid(
      `assertion.basis.worldcut contains unsupported field(s): ${unknownFields.join(", ")}`,
    );
  }
  if (candidate.protocolVersion !== "0.1") {
    return invalid("assertion.basis.worldcut.protocolVersion must equal 0.1");
  }
  if (typeof candidate.role !== "string" || candidate.role.length === 0) {
    return invalid("assertion.basis.worldcut.role must be a non-empty string");
  }
  const resource = record(
    candidate.resource,
    "assertion.basis.worldcut.resource",
  );
  for (const field of ["provider", "account", "kind", "key"]) {
    if (typeof resource[field] !== "string" || resource[field].length === 0) {
      return invalid(
        `assertion.basis.worldcut.resource.${field} must be a non-empty string`,
      );
    }
  }
  const provenanceValues = new Set([
    "provider_asserted",
    "client_observed",
    "derived",
    "operator_supplied",
  ]);
  if (
    typeof candidate.provenance !== "string" ||
    !provenanceValues.has(candidate.provenance)
  ) {
    return invalid("assertion.basis.worldcut.provenance is unsupported");
  }
  if (
    candidate.acquisitionCost !== undefined &&
    (typeof candidate.acquisitionCost !== "number" ||
      !Number.isFinite(candidate.acquisitionCost) ||
      candidate.acquisitionCost < 0)
  ) {
    return invalid(
      "assertion.basis.worldcut.acquisitionCost must be non-negative",
    );
  }
  const snapshot = snapshotJsonData(candidate) as WorldCutBasis;
  if (
    snapshot.dependencies !== undefined &&
    !Array.isArray(snapshot.dependencies)
  ) {
    return invalid(
      "assertion.basis.worldcut.dependencies must be an array",
    );
  }
  for (const dependency of snapshot.dependencies ?? []) {
    const dependencyRecord = record(
      dependency,
      "assertion.basis.worldcut.dependencies[]",
    );
    const dependencyResource = record(
      dependencyRecord.resource,
      "assertion.basis.worldcut.dependencies[].resource",
    );
    if (dependencyResource.account !== assertion.tenantId) {
      return invalid(
        "Every WorldCut dependency resource account must equal the Agentic Data Kernel tenantId",
      );
    }
  }
  return snapshot;
}

function adaptAgenticDataResolution(
  resolutionInput: AgenticDataResolutionLike,
  options: AgenticDataAdapterOptions = {},
): Observation {
  const resolution = snapshotJsonData(
    resolutionInput,
    "resolution",
  ) as AgenticDataResolutionLike;
  if (
    ![
      "known",
      "unknown",
      "conflicted",
      "resolved_with_conflict",
    ].includes(resolution.status)
  ) {
    return invalid(
      `Agentic Data Kernel resolution status ${String(resolution.status)} is unsupported`,
    );
  }
  if (resolution.status === "unknown" || resolution.status === "conflicted") {
    return invalid(
      `Agentic Data Kernel resolution status ${resolution.status} cannot authorize an observation`,
    );
  }
  if (
    resolution.status === "resolved_with_conflict" &&
    !options.allowResolvedWithConflict
  ) {
    return invalid(
      "resolved_with_conflict requires allowResolvedWithConflict: true",
    );
  }
  const assertion = resolution.selected;
  if (!assertion) {
    return invalid("Agentic Data Kernel resolution has no selected assertion");
  }
  if (assertion.status !== "active") {
    return invalid(
      `Agentic Data Kernel assertion status ${assertion.status} is not eligible`,
    );
  }
  if (
    !activeAt(
      assertion.systemFrom,
      assertion.systemTo,
      resolution.systemAt,
      "assertion.systemTime",
    )
  ) {
    return invalid(
      "Agentic Data Kernel assertion is not system-valid at resolution.systemAt",
    );
  }
  if (
    !activeAt(
      assertion.validFrom,
      assertion.validTo,
      resolution.validAt,
      "assertion.validTime",
    )
  ) {
    return invalid(
      "Agentic Data Kernel assertion is not business-valid at resolution.validAt",
    );
  }

  const basis = worldCutBasis(assertion);
  if (basis.resource.account !== assertion.tenantId) {
    return invalid(
      "WorldCut resource account must equal the Agentic Data Kernel tenantId",
    );
  }

  const observation: Observation = {
    id: `adk-${assertion.assertionId}`,
    role: basis.role,
    resource: basis.resource,
    value: assertion.object,
    observedAt: assertion.systemFrom,
    acquisitionCost: basis.acquisitionCost ?? 1,
    witness: {
      provenance: basis.provenance,
      ...(basis.version ? { version: basis.version } : {}),
      validity: {
        from: assertion.validFrom,
        until: assertion.validTo,
      },
      ...(basis.dependencies
        ? { dependencies: basis.dependencies }
        : {}),
    },
  };
  const validationContract: CoherenceContract = {
    id: "agentic-data-kernel-observation-validation",
    version: "1",
    decisionTime: resolution.systemAt,
    assumptions: {
      clockModel: "trusted_normalized",
      intervalModel: "half_open",
      metadataModel: "honest_but_possibly_incomplete",
    },
    requirements: [
      {
        id: "selected-value-is-preserved",
        type: "value_equals",
        description: "The selected kernel value is preserved",
        role: observation.role,
        path: ["selected"],
        expected: observation.value,
      },
    ],
  };
  try {
    verifyDecisionContract({
      protocolVersion: "0.1",
      contract: validationContract,
      observations: [
        {
          ...observation,
          value: {
            selected: observation.value,
          },
        },
      ],
    });
  } catch (error) {
    throw new WorldCutIntegrationError(
      "WORLDCUT_ADK_RESOLUTION_INVALID",
      "Agentic Data Kernel WorldCut metadata is invalid",
      { cause: error },
    );
  }
  return observation;
}

export function observationFromAgenticDataResolution(
  resolutionInput: AgenticDataResolutionLike,
  options: AgenticDataAdapterOptions = {},
): Observation {
  try {
    return adaptAgenticDataResolution(resolutionInput, options);
  } catch (error) {
    if (error instanceof WorldCutIntegrationError) {
      throw error;
    }
    throw new WorldCutIntegrationError(
      "WORLDCUT_ADK_RESOLUTION_INVALID",
      "Agentic Data Kernel resolution metadata is invalid",
      { cause: error },
    );
  }
}
