export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WitnessProvenance =
  | "provider_asserted"
  | "client_observed"
  | "derived"
  | "operator_supplied";

export interface ResourceIdentity {
  provider: string;
  account: string;
  kind: string;
  key: string;
}

export interface ValidityInterval {
  from: string;
  until: string | null;
}

export interface DependencyWitness {
  name: string;
  resource: ResourceIdentity;
  relation: "exact";
  version?: string;
  provenance: WitnessProvenance;
}

export interface ObservationWitness {
  provenance: WitnessProvenance;
  version?: string;
  validity?: ValidityInterval;
  dependencies?: DependencyWitness[];
}

export interface Observation {
  id: string;
  role: string;
  resource: ResourceIdentity;
  value: JsonValue;
  observedAt: string;
  acquisitionCost: number;
  witness: ObservationWitness;
}

interface RequirementBase {
  id: string;
  description: string;
  required?: boolean;
}

export interface DependencyRequirement extends RequirementBase {
  type: "dependency";
  dependentRole: string;
  targetRole: string;
  dependencyName: string;
}

export interface CommonValidTimeRequirement extends RequirementBase {
  type: "common_valid_time";
  roles: string[];
  within: ValidityInterval;
}

export interface ValueEqualsRequirement extends RequirementBase {
  type: "value_equals";
  role: string;
  path: string[];
  expected: JsonValue;
}

export type ContractRequirement =
  | DependencyRequirement
  | CommonValidTimeRequirement
  | ValueEqualsRequirement;

export interface ContractAssumptions {
  clockModel: "trusted_normalized";
  intervalModel: "half_open";
  metadataModel: "honest_but_possibly_incomplete";
}

export interface CoherenceContract {
  id: string;
  version: string;
  decisionTime: string;
  assumptions: ContractAssumptions;
  requirements: ContractRequirement[];
}

export type RequirementStatus = "SATISFIED" | "VIOLATED" | "UNKNOWN";

export type ContractVerdict =
  | "CONTRACT_SATISFIED"
  | "CONTRACT_VIOLATED"
  | "INSUFFICIENT_EVIDENCE";

export type AcquisitionActionType =
  | "REFRESH_OBSERVATION"
  | "FETCH_REQUIRED_METADATA"
  | "ACQUIRE_COMPATIBLE_EVIDENCE";

export interface AcquisitionAction {
  id: string;
  type: AcquisitionActionType;
  role: string;
  cost: number;
  description: string;
  expected: JsonValue | null;
}

export interface AcquisitionOption {
  id: string;
  description: string;
  actions: AcquisitionAction[];
}

export interface RequirementResult {
  requirementId: string;
  requirementType: ContractRequirement["type"];
  required: boolean;
  status: RequirementStatus;
  summary: string;
  details: JsonValue;
  acquisitionOptions: AcquisitionOption[];
}

export interface VerificationCoverage {
  required: number;
  satisfied: number;
  violated: number;
  unknown: number;
  advisory: number;
}

export interface AcquisitionPlan {
  status: "NOT_NEEDED" | "AVAILABLE" | "INCOMPLETE";
  reason: string | null;
  actions: AcquisitionAction[];
  selectedOptionIds: string[];
  totalCost: number;
  coveredRequirementIds: string[];
  unresolvedRequirementIds: string[];
}

export interface VerificationResult {
  protocolVersion: "0.1";
  engineVersion: string;
  canonicalization: "worldcut-json-v1";
  contractId: string;
  contractVersion: string;
  verdict: ContractVerdict;
  coverage: VerificationCoverage;
  requirementResults: RequirementResult[];
  acquisitionPlan: AcquisitionPlan;
  verificationRecordDigest: string;
}

export interface VerificationInput {
  protocolVersion: "0.1";
  contract: CoherenceContract;
  observations: Observation[];
}

export interface BaselineResult {
  name: string;
  verdict: ContractVerdict;
  reason: string;
}
