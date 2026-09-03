import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import semver from "semver";

const tag = process.argv[2];
const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageManifest.version;

if (tag !== `v${version}`) {
  throw new Error(`Tag ${tag} does not match package version ${version}`);
}
if (!semver.valid(version)) {
  throw new Error(`Package version ${version} is not valid semantic versioning`);
}

const remoteMain = execFileSync(
  "git",
  ["rev-parse", "refs/remotes/origin/main"],
  { encoding: "utf8" },
).trim();
const taggedCommit = execFileSync("git", ["rev-parse", `${tag}^{commit}`], {
  encoding: "utf8",
}).trim();
try {
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", taggedCommit, remoteMain],
    { stdio: "ignore" },
  );
} catch {
  throw new Error(
    `Tag ${tag} commit ${taggedCommit} is not in origin/main history`,
  );
}

console.log(`Validated release tag ${tag} at ${taggedCommit}`);
