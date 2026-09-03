import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureGitHead } from "../adapters/git.js";
import { captureHttpObservation } from "../adapters/http.js";
import { captureKubernetesObservation } from "../adapters/kubernetes.js";

test("captures an immutable Git commit as a resource version", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worldcut-git-"));
  try {
    execFileSync(
      "git",
      ["init", "--quiet", "--initial-branch=main", directory],
      {
        windowsHide: true,
      },
    );
    execFileSync(
      "git",
      ["-C", directory, "config", "user.email", "worldcut@example.invalid"],
      { windowsHide: true },
    );
    execFileSync(
      "git",
      ["-C", directory, "config", "user.name", "WorldCut Test"],
      { windowsHide: true },
    );
    execFileSync(
      "git",
      ["-C", directory, "config", "core.autocrlf", "false"],
      { windowsHide: true },
    );
    writeFileSync(join(directory, "sample.txt"), "sample\n", "utf8");
    execFileSync("git", ["-C", directory, "add", "sample.txt"], {
      windowsHide: true,
    });
    execFileSync("git", ["-C", directory, "commit", "--quiet", "-m", "init"], {
      windowsHide: true,
    });

    const observation = await captureGitHead({
      repositoryPath: directory,
      repositoryId: "fixture",
      branch: "main",
      role: "head",
    });

    assert.match(observation.witness.version ?? "", /^[0-9a-f]{40}$/);
    assert.equal(observation.witness.provenance, "client_observed");
    const secondObservation = await captureGitHead({
      repositoryPath: directory,
      repositoryId: "fixture",
      branch: "main",
      role: "second-head",
    });
    assert.notEqual(observation.id, secondObservation.id);
    await assert.rejects(
      captureGitHead({
        repositoryPath: directory,
        repositoryId: "fixture",
        branch: "does-not-exist",
        role: "wrong-head",
      }),
    );
    await assert.rejects(
      captureGitHead({
        repositoryPath: directory,
        repositoryId: "fixture",
        branch: "main~1",
        role: "revision-expression",
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("captures an HTTP ETag as an opaque resource version", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("ETag", '"fixture-v3"');
    response.statusCode = 200;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const observation = await captureHttpObservation({
      url: `http://127.0.0.1:${address.port}/resource`,
      role: "http-resource",
      resource: {
        provider: "fixture",
        account: "test",
        kind: "document",
        key: "one",
      },
    });

    assert.equal(observation.witness.version, '"fixture-v3"');
    assert.deepEqual(observation.value, {
      status: 200,
      ok: true,
      etag: '"fixture-v3"',
      lastModified: null,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("cancels unread HTTP GET response bodies", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel: () => {
      cancelled = true;
    },
  });
  const observation = await captureHttpObservation({
    url: "https://example.invalid/resource",
    method: "GET",
    role: "http-resource",
    resource: {
      provider: "fixture",
      account: "test",
      kind: "document",
      key: "stream",
    },
    fetchImplementation: async () =>
      new Response(body, {
        status: 200,
        headers: { ETag: '"stream-v1"' },
      }),
  });

  assert.equal(observation.witness.version, '"stream-v1"');
  assert.equal(cancelled, true);
});

test("does not promote weak HTTP validators to exact versions", async () => {
  const lastModifiedOnly = await captureHttpObservation({
    url: "https://example.invalid/last-modified",
    role: "last-modified",
    resource: {
      provider: "fixture",
      account: "test",
      kind: "document",
      key: "last-modified",
    },
    fetchImplementation: async () =>
      new Response(null, {
        status: 200,
        headers: {
          "Last-Modified": "Wed, 02 Sep 2026 20:00:00 GMT",
        },
      }),
  });
  const weakEtag = await captureHttpObservation({
    url: "https://example.invalid/weak-etag",
    role: "weak-etag",
    resource: {
      provider: "fixture",
      account: "test",
      kind: "document",
      key: "weak-etag",
    },
    fetchImplementation: async () =>
      new Response(null, {
        status: 200,
        headers: {
          ETag: 'W/"semantic-v1"',
        },
      }),
  });
  const wildcardEtag = await captureHttpObservation({
    url: "https://example.invalid/wildcard-etag",
    role: "wildcard-etag",
    resource: {
      provider: "fixture",
      account: "test",
      kind: "document",
      key: "wildcard-etag",
    },
    fetchImplementation: async () =>
      new Response(null, {
        status: 200,
        headers: { ETag: "*" },
      }),
  });
  const unquotedEtag = await captureHttpObservation({
    url: "https://example.invalid/unquoted-etag",
    role: "unquoted-etag",
    resource: {
      provider: "fixture",
      account: "test",
      kind: "document",
      key: "unquoted-etag",
    },
    fetchImplementation: async () =>
      new Response(null, {
        status: 200,
        headers: { ETag: "not-quoted" },
      }),
  });

  assert.equal(lastModifiedOnly.witness.version, undefined);
  assert.equal(weakEtag.witness.version, undefined);
  assert.equal(wildcardEtag.witness.version, undefined);
  assert.equal(unquotedEtag.witness.version, undefined);
});

test("captures Kubernetes resourceVersion without treating it as a timestamp", () => {
  const observation = captureKubernetesObservation({
    cluster: "fixture",
    account: "test",
    role: "deployment",
    object: {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "payments",
        namespace: "production",
        resourceVersion: "9812",
      },
    },
  });

  assert.equal(observation.witness.version, "9812");
  assert.equal(observation.resource.kind, "apps/v1/Deployment");
  assert.equal(observation.witness.validity, undefined);
  const secondObservation = captureKubernetesObservation({
    cluster: "fixture",
    account: "test",
    role: "same-deployment-again",
    object: {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "payments",
        namespace: "production",
        resourceVersion: "9812",
      },
    },
  });
  assert.notEqual(observation.id, secondObservation.id);
});
