import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { captureGitHead } from "../adapters/git.js";
import { captureHttpObservation } from "../adapters/http.js";
import { captureKubernetesObservation } from "../adapters/kubernetes.js";
import type { Observation } from "../types.js";

const execFileAsync = promisify(execFile);

interface FeasibilityResult {
  source: string;
  captured: boolean;
  versionKind: string;
  versionPresent: boolean;
  notes: string;
}

async function withEtagServer(): Promise<FeasibilityResult> {
  const server = createServer((request, response) => {
    response.setHeader("ETag", '"catalog-v7"');
    response.setHeader("Last-Modified", "Wed, 02 Sep 2026 20:00:00 GMT");
    response.statusCode = 200;
    response.end(request.method === "HEAD" ? undefined : "ok");
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Local HTTP feasibility server has no TCP address");
    }
    const observation = await captureHttpObservation({
      url: `http://127.0.0.1:${address.port}/catalog`,
      role: "catalog",
      resource: {
        provider: "local-http",
        account: "feasibility",
        kind: "catalog",
        key: "products",
      },
    });
    return {
      source: "HTTP",
      captured: true,
      versionKind: "strong ETag",
      versionPresent: Boolean(observation.witness.version),
      notes:
        "A strong ETag is usable as an opaque exact-version witness. Weak ETags and Last-Modified values remain descriptive metadata only.",
    };
  } finally {
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolvePromise();
        }
      });
    });
  }
}

async function captureGitFeasibility(
  repositoryPath: string,
): Promise<FeasibilityResult> {
  if (!existsSync(join(repositoryPath, ".git"))) {
    return {
      source: "Git",
      captured: false,
      versionKind: "commit SHA",
      versionPresent: false,
      notes: `No Git repository was available at the supplied sample path.`,
    };
  }
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryPath, "branch", "--show-current"],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const branch = stdout.trim();
  if (!branch) {
    return {
      source: "Git",
      captured: false,
      versionKind: "commit SHA",
      versionPresent: false,
      notes:
        "The sample repository is detached, so the branch-head adapter was not exercised.",
    };
  }
  const observation = await captureGitHead({
    repositoryPath,
    repositoryId: "sample-repository",
    branch,
    role: "head",
  });
  return {
    source: "Git",
    captured: true,
    versionKind: "commit SHA",
    versionPresent: Boolean(observation.witness.version),
    notes:
      "Commit identity is strong and immutable, but CI or artifact providers must still expose an explicit dependency on it.",
  };
}

function captureKubernetesFeasibility(): FeasibilityResult {
  const observation: Observation = captureKubernetesObservation({
    cluster: "sample-cluster",
    account: "feasibility",
    role: "deployment",
    object: {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "payments",
        namespace: "production",
        uid: "f5a7e3c0",
        resourceVersion: "18277",
      },
    },
  });
  return {
    source: "Kubernetes",
    captured: true,
    versionKind: "resourceVersion",
    versionPresent: Boolean(observation.witness.version),
    notes:
      "resourceVersion is an opaque change token suitable for equality and server-supported API operations; clients must not sort or interpret it as a timestamp.",
  };
}

function render(results: FeasibilityResult[], gitPath: string): string {
  return [
    "# Metadata Feasibility Probe",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This probe checks whether common systems expose native resource-version material that a WorldCut adapter can capture. It does not establish cross-provider coherence by itself.",
    "",
    "| Source | Captured | Version kind | Version present | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.source} | ${result.captured ? "yes" : "no"} | ${result.versionKind} | ${result.versionPresent ? "yes" : "no"} | ${result.notes} |`,
    ),
    "",
    "## Interpretation",
    "",
    "- Git commit SHAs, strong HTTP ETags, and Kubernetes resourceVersion values provide usable per-resource identities.",
    "- None of those values automatically states how observations from different providers depend on one another.",
    "- Most APIs do not expose continuous validity intervals. Temporal requirements may need event history, provider expiry data, bounded-read protocols, or must remain unprovable.",
    "- The sample Git path is used only to demonstrate metadata capture and is not stored in the observation output.",
    "",
    `Sample Git repository available: ${existsSync(join(gitPath, ".git")) ? "yes" : "no"}.`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const sampleGitRepository = resolve(
    process.env.WORLDCUT_SAMPLE_GIT_REPO ?? process.cwd(),
  );
  const results = [
    await captureGitFeasibility(sampleGitRepository),
    await withEtagServer(),
    captureKubernetesFeasibility(),
  ];
  const outputDirectory = join(process.cwd(), "benchmark");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "metadata-feasibility.md");
  await writeFile(outputPath, render(results, sampleGitRepository), "utf8");

  for (const result of results) {
    console.log(
      `${result.source}: captured=${result.captured}, version=${result.versionPresent}`,
    );
  }
  console.log(`Report: ${outputPath}`);
}

await main();
