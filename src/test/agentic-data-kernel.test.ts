import assert from "node:assert/strict";
import test from "node:test";
import { WorldCutIntegrationError } from "../errors.js";
import {
  observationFromAgenticDataResolution,
  type AgenticDataResolutionLike,
} from "../integrations/agentic-data-kernel.js";

function resolution(
  overrides: Partial<AgenticDataResolutionLike> = {},
): AgenticDataResolutionLike {
  return {
    status: "known",
    validAt: "2026-09-02T12:00:00.000Z",
    systemAt: "2026-09-02T12:00:00.000Z",
    selected: {
      tenantId: "tenant-a",
      assertionId: "assertion-1",
      object: { type: "string", value: "commit-B" },
      validFrom: "2026-09-02T11:00:00.000Z",
      validTo: null,
      systemFrom: "2026-09-02T11:30:00.000Z",
      systemTo: null,
      status: "active",
      basis: {
        worldcut: {
          protocolVersion: "0.1",
          role: "head",
          resource: {
            provider: "github",
            account: "tenant-a",
            kind: "branch_head",
            key: "service/main",
          },
          provenance: "provider_asserted",
          version: "commit-B",
          acquisitionCost: 2,
        },
      },
    },
    ...overrides,
  };
}

test("maps an eligible Agentic Data Kernel resolution into an observation", () => {
  const observation = observationFromAgenticDataResolution(resolution());

  assert.equal(observation.role, "head");
  assert.equal(observation.resource.account, "tenant-a");
  assert.equal(observation.witness.version, "commit-B");
  assert.deepEqual(observation.witness.validity, {
    from: "2026-09-02T11:00:00.000Z",
    until: null,
  });
});

test("rejects unknown, conflicted, and unresolved conflict results", () => {
  for (const status of ["unknown", "conflicted"] as const) {
    assert.throws(
      () =>
        observationFromAgenticDataResolution(
          resolution({ status, selected: null }),
        ),
      WorldCutIntegrationError,
    );
  }
  assert.throws(
    () =>
      observationFromAgenticDataResolution(
        resolution({ status: "resolved_with_conflict" }),
      ),
    /allowResolvedWithConflict/,
  );
  assert.equal(
    observationFromAgenticDataResolution(
      resolution({ status: "resolved_with_conflict" }),
      { allowResolvedWithConflict: true },
    ).role,
    "head",
  );
});

test("rejects ineligible lifecycle and temporal states", () => {
  const disputed = resolution();
  assert.ok(disputed.selected);
  disputed.selected.status = "disputed";
  assert.throws(
    () => observationFromAgenticDataResolution(disputed),
    /not eligible/,
  );

  const systemClosed = resolution();
  assert.ok(systemClosed.selected);
  systemClosed.selected.systemTo = "2026-09-02T11:45:00.000Z";
  assert.throws(
    () => observationFromAgenticDataResolution(systemClosed),
    /not system-valid/,
  );

  const businessExpired = resolution();
  assert.ok(businessExpired.selected);
  businessExpired.selected.validTo = "2026-09-02T11:45:00.000Z";
  assert.throws(
    () => observationFromAgenticDataResolution(businessExpired),
    /not business-valid/,
  );
});

test("binds WorldCut resource account to the kernel tenant", () => {
  const mismatchedTenant = resolution();
  assert.ok(mismatchedTenant.selected);
  const basis = mismatchedTenant.selected.basis as {
    worldcut: { resource: { account: string } };
  };
  basis.worldcut.resource.account = "tenant-b";

  assert.throws(
    () => observationFromAgenticDataResolution(mismatchedTenant),
    /tenantId/,
  );

  const dependencyTenant = resolution();
  assert.ok(dependencyTenant.selected);
  const dependencyBasis = dependencyTenant.selected.basis as {
    worldcut: {
      dependencies?: Array<{ resource: { account: string } }>;
    };
  };
  dependencyBasis.worldcut.dependencies = [
    {
      resource: {
        account: "tenant-b",
      },
    },
  ];
  assert.throws(
    () => observationFromAgenticDataResolution(dependencyTenant),
    /Every WorldCut dependency resource account/,
  );
});

test("wraps malformed kernel metadata in the documented error code", () => {
  const malformed = resolution();
  assert.ok(malformed.selected);
  const basis = malformed.selected.basis as {
    worldcut: Record<string, unknown>;
  };
  basis.worldcut.dependencies = {};

  assert.throws(
    () => observationFromAgenticDataResolution(malformed),
    (error: unknown) =>
      error instanceof WorldCutIntegrationError &&
      error.code === "WORLDCUT_ADK_RESOLUTION_INVALID",
  );
});
