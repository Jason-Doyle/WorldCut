import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let archivePath;
let installDirectory;
let removeArchive = false;

try {
  let packResults;
  if (process.argv[2] && process.argv[3]) {
    archivePath = resolve(process.argv[2]);
    packResults = JSON.parse(readFileSync(resolve(process.argv[3]), "utf8"));
  } else {
    const packOutput = runNpm(["pack", "--json"], {
      cwd: projectRoot,
      capture: true,
    });
    packResults = JSON.parse(packOutput);
    removeArchive = true;
  }
  const packageResult = Array.isArray(packResults)
    ? packResults[0]
    : Object.values(packResults)[0];
  if (!packageResult?.filename || !Array.isArray(packageResult.files)) {
    throw new Error("npm pack did not return a package manifest");
  }
  archivePath ??= resolve(projectRoot, packageResult.filename);
  const packagedPaths = new Set(
    packageResult.files.map((entry) => entry.path),
  );
  for (const requiredPath of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/cli.js",
    "dist/github-ci-cli.js",
    "dist/integrations/github-actions.js",
    "dist/integrations/agentic-data-kernel.js",
    "schema/0.1/verification-input.schema.json",
    "schema/0.1/verification-result.schema.json",
    "examples/coherent-deployment.json",
    "docs/PROTOCOL.md",
    "docs/PRODUCTION.md",
    "docs/INTEGRATIONS.md",
    "docs/AGENTIC_DATA_KERNEL.md",
    "docs/VALIDATION.md",
    "spec/0.1/PROTOCOL.md",
    "spec/0.1/CANONICALIZATION.md",
    "spec/0.1/CONFORMANCE.md",
    "spec/0.1/RESULTS.md",
    "conformance/0.1/manifest.json",
    "conformance/0.1/raw-vectors.json",
    "conformance/0.1/raw/unpaired-high-surrogate.json",
    "README.md",
    "LICENSE",
  ]) {
    if (!packagedPaths.has(requiredPath)) {
      throw new Error(`Package is missing ${requiredPath}`);
    }
  }
  for (const forbiddenPath of [
    ".env",
    "docs/ASSUMPTIONS.md",
    "scripts/test-package.mjs",
    "src/index.ts",
  ]) {
    if (packagedPaths.has(forbiddenPath)) {
      throw new Error(`Package unexpectedly contains ${forbiddenPath}`);
    }
  }
  for (const forbiddenPrefix of [
    ".github/",
    "dist/benchmark/",
    "dist/test/",
    "src/",
  ]) {
    if ([...packagedPaths].some((path) => path.startsWith(forbiddenPrefix))) {
      throw new Error(
        `Package unexpectedly contains ${forbiddenPrefix} content`,
      );
    }
  }

  installDirectory = mkdtempSync(join(tmpdir(), "worldcut-package-"));
  writeFileSync(
    join(installDirectory, "package.json"),
    JSON.stringify({ name: "worldcut-package-smoke", private: true }),
  );
  runNpm(
    [
      "install",
      archivePath,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: installDirectory },
  );

  const installedPackage = join(
    installDirectory,
    "node_modules",
    "worldcut",
  );
  const installedManifest = JSON.parse(
    readFileSync(join(installedPackage, "package.json"), "utf8"),
  );
  if (installedManifest.dependencies) {
    throw new Error("Published package must not have runtime dependencies");
  }
  for (const binary of ["worldcut", "worldcut-github-ci"]) {
    if (!installedManifest.bin?.[binary]) {
      throw new Error(`Installed package is missing ${binary}`);
    }
  }

  const smokeModule = join(installDirectory, "smoke.mjs");
  writeFileSync(
    smokeModule,
    `import {
  WorldCutInputError,
  observationFromAgenticDataResolution,
  verifyDecisionContract,
  verifyLatestGitHubWorkflow,
} from "worldcut";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const inputSchemaPath = require.resolve(
  "worldcut/schemas/0.1/verification-input.json",
);
const resultSchemaPath = require.resolve(
  "worldcut/schemas/0.1/verification-result.json",
);
if (
  typeof verifyDecisionContract !== "function" ||
  typeof verifyLatestGitHubWorkflow !== "function" ||
  typeof observationFromAgenticDataResolution !== "function" ||
  typeof WorldCutInputError !== "function" ||
  !inputSchemaPath.endsWith(".json") ||
  !resultSchemaPath.endsWith(".json")
) {
  throw new Error("Published exports are unavailable");
}
`,
  );
  run(process.execPath, [smokeModule], { cwd: installDirectory });

  const typeSmokeModule = join(installDirectory, "smoke.mts");
  const typeConfig = join(installDirectory, "tsconfig.json");
  writeFileSync(
    typeSmokeModule,
    `import {
  type VerificationInput,
  type VerificationResult,
  verifyDecisionContract,
} from "worldcut";
import {
  type GitHubWorkflowVerification,
  verifyLatestGitHubWorkflow,
} from "worldcut/integrations/github-actions";
import {
  type AgenticDataResolutionLike,
  observationFromAgenticDataResolution,
} from "worldcut/integrations/agentic-data-kernel";

declare const input: VerificationInput;
const result: VerificationResult = verifyDecisionContract(input);
const githubVerifier: typeof verifyLatestGitHubWorkflow =
  verifyLatestGitHubWorkflow;
const adkAdapter: typeof observationFromAgenticDataResolution =
  observationFromAgenticDataResolution;
declare const githubResult: GitHubWorkflowVerification;
declare const resolution: AgenticDataResolutionLike;
void result;
void githubVerifier;
void adkAdapter;
void githubResult;
void resolution;
`,
  );
  writeFileSync(
    typeConfig,
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: "ES2023",
      },
      include: ["smoke.mts"],
    }),
  );
  const typescriptCli = join(
    projectRoot,
    "node_modules",
    "typescript",
    "bin",
    "tsc",
  );
  if (!existsSync(typescriptCli)) {
    throw new Error("TypeScript compiler is unavailable");
  }
  run(process.execPath, [typescriptCli, "--project", typeConfig], {
    cwd: installDirectory,
  });

  runNpm(["exec", "--offline", "--", "worldcut", "--help"], {
    cwd: installDirectory,
  });
  runNpm(["exec", "--offline", "--", "worldcut-github-ci", "--help"], {
    cwd: installDirectory,
  });

  console.log(
    `Package smoke test passed for ${installedManifest.name}@${installedManifest.version}`,
  );
} finally {
  if (archivePath && removeArchive) {
    try {
      unlinkSync(archivePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  if (installDirectory) {
    rmSync(installDirectory, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result.stdout ?? "";
}

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    return run(process.execPath, [npmCli, ...args], options);
  }
  const bundledNpmCli = resolve(
    dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (existsSync(bundledNpmCli)) {
    return run(process.execPath, [bundledNpmCli, ...args], options);
  }
  return run("npm", args, options);
}
