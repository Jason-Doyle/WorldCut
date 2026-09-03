import { randomUUID } from "node:crypto";
import type { JsonValue, Observation } from "../types.js";

export interface KubernetesObjectMetadata {
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
}

export interface KubernetesObject {
  apiVersion: string;
  kind: string;
  metadata: KubernetesObjectMetadata;
}

export interface CaptureKubernetesObservationOptions {
  cluster: string;
  account: string;
  role: string;
  object: KubernetesObject;
  value?: JsonValue;
  acquisitionCost?: number;
}

export function captureKubernetesObservation(
  options: CaptureKubernetesObservationOptions,
): Observation {
  const namespace = options.object.metadata.namespace ?? "default";
  const resourceVersion = options.object.metadata.resourceVersion;

  return {
    id: `kubernetes-${randomUUID()}`,
    role: options.role,
    resource: {
      provider: "kubernetes",
      account: options.account,
      kind: `${options.object.apiVersion}/${options.object.kind}`,
      key: `${options.cluster}/${namespace}/${options.object.metadata.name}`,
    },
    value:
      options.value ??
      {
        apiVersion: options.object.apiVersion,
        kind: options.object.kind,
        name: options.object.metadata.name,
        namespace,
        uid: options.object.metadata.uid ?? null,
      },
    observedAt: new Date().toISOString(),
    acquisitionCost: options.acquisitionCost ?? 1,
    witness: {
      provenance: "provider_asserted",
      ...(resourceVersion ? { version: resourceVersion } : {}),
    },
  };
}
