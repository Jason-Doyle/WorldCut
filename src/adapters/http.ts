import { randomUUID } from "node:crypto";
import type { Observation, ResourceIdentity } from "../types.js";

export interface CaptureHttpObservationOptions {
  url: string;
  role: string;
  resource: ResourceIdentity;
  method?: "GET" | "HEAD";
  acquisitionCost?: number;
  fetchImplementation?: typeof fetch;
}

function strongEtag(etag: string | null): string | undefined {
  if (!etag) {
    return undefined;
  }
  const candidate = etag.trim();
  return /^"(?:[\x21\x23-\x7e\x80-\xff]*)"$/.test(candidate)
    ? candidate
    : undefined;
}

export async function captureHttpObservation(
  options: CaptureHttpObservationOptions,
): Promise<Observation> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const response = await fetchImplementation(options.url, {
    method: options.method ?? "HEAD",
    redirect: "error",
  });
  try {
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    const version = strongEtag(etag);

    return {
      id: `http-${randomUUID()}`,
      role: options.role,
      resource: options.resource,
      value: {
        status: response.status,
        ok: response.ok,
        etag,
        lastModified,
      },
      observedAt: new Date().toISOString(),
      acquisitionCost: options.acquisitionCost ?? 1,
      witness: {
        provenance: "provider_asserted",
        ...(version ? { version } : {}),
      },
    };
  } finally {
    await response.body?.cancel();
  }
}
