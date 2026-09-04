#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [port, tag] = process.argv.slice(2);
if (!port || !tag || !["python", "dotnet"].includes(port)) {
  throw new Error(
    "Usage: node scripts/validate-port-release-tag.mjs <python|dotnet> <tag>",
  );
}

const root = resolve(import.meta.dirname, "..");
const version =
  port === "python" ? pythonVersion(root) : dotnetVersion(root);
const expectedTag = `ports/${port}/v${version}`;
if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} must equal ${expectedTag}`);
}

if (git(["cat-file", "-t", tag]) !== "tag") {
  throw new Error(`${tag} must be an annotated tag`);
}

const taggedSha = git(["rev-parse", `${tag}^{commit}`]);
const checkedOutSha = git(["rev-parse", "HEAD"]);
if (taggedSha !== checkedOutSha) {
  throw new Error(
    `Checked out commit ${checkedOutSha} does not match ${tag} at ${taggedSha}`,
  );
}

execFileSync(
  "git",
  ["merge-base", "--is-ancestor", taggedSha, "origin/main"],
  { cwd: root, stdio: "inherit" },
);

console.log(`Validated ${port} release tag ${tag} at ${taggedSha}`);

function pythonVersion(projectRoot) {
  const pyproject = readFileSync(
    join(projectRoot, "ports", "python", "pyproject.toml"),
    "utf8",
  );
  const init = readFileSync(
    join(projectRoot, "ports", "python", "src", "worldcut", "__init__.py"),
    "utf8",
  );
  const packageVersion = match(pyproject, /^version = "([^"]+)"$/m, "pyproject");
  const runtimeVersion = match(
    init,
    /^__version__ = "([^"]+)"$/m,
    "Python runtime",
  );
  if (packageVersion !== runtimeVersion) {
    throw new Error(
      `Python package version ${packageVersion} does not match runtime version ${runtimeVersion}`,
    );
  }
  return packageVersion;
}

function dotnetVersion(projectRoot) {
  const props = readFileSync(
    join(projectRoot, "ports", "dotnet", "Directory.Build.props"),
    "utf8",
  );
  const smoke = readFileSync(
    join(projectRoot, "ports", "dotnet", "scripts", "package-smoke.ps1"),
    "utf8",
  );
  const packageVersion = match(props, /<Version>([^<]+)<\/Version>/, ".NET props");
  const smokeVersion = match(
    smoke,
    /\$packageVersion = '([^']+)'/,
    ".NET package smoke",
  );
  if (packageVersion !== smokeVersion) {
    throw new Error(
      `.NET package version ${packageVersion} does not match smoke version ${smokeVersion}`,
    );
  }
  return packageVersion;
}

function match(text, pattern, field) {
  const result = pattern.exec(text)?.[1];
  if (!result) {
    throw new Error(`Unable to read ${field} version`);
  }
  return result;
}

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim();
}
