import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  sha256Digest,
  verifyDecisionContract,
  WorldCutError,
} from "../dist/index.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(projectRoot, "conformance", "0.1");
const mirrorDirectories = [
  join(projectRoot, "ports", "go", "testdata", "conformance", "0.1"),
  join(projectRoot, "ports", "python", "tests", "data", "conformance", "0.1"),
  join(
    projectRoot,
    "ports",
    "dotnet",
    "tests",
    "WorldCut.Tests",
    "data",
    "conformance",
    "0.1",
  ),
];
const writeMode = process.argv.includes("--write");

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function fixture(name) {
  return JSON.parse(
    await readFile(join(projectRoot, "examples", name), "utf8"),
  );
}

function requirement(input, type) {
  const match = input.contract.requirements.find(
    (candidate) => candidate.type === type,
  );
  if (!match) {
    throw new Error(`Fixture has no ${type} requirement`);
  }
  return match;
}

function observation(input, role) {
  const match = input.observations.find(
    (candidate) => candidate.role === role,
  );
  if (!match) {
    throw new Error(`Fixture has no ${role} observation`);
  }
  return match;
}

const coherent = await fixture("coherent-deployment.json");
const mismatch = await fixture("git-ci-mismatch.json");
const temporalGap = await fixture("temporal-gap.json");
const missingEvidence = await fixture("missing-evidence.json");

const valueMismatch = structuredClone(coherent);
valueMismatch.contract.id = "value-mismatch";
requirement(valueMismatch, "value_equals").expected = "failed";

const valuePathMissing = structuredClone(coherent);
valuePathMissing.contract.id = "value-path-missing";
requirement(valuePathMissing, "value_equals").path = ["missing"];

const arrayIndex = structuredClone(coherent);
arrayIndex.contract.id = "array-index";
arrayIndex.contract.requirements = [
  {
    id: "first-status",
    type: "value_equals",
    description: "The first array value is passed",
    role: "ci",
    path: ["0"],
    expected: "passed",
  },
];
observation(arrayIndex, "ci").value = ["passed"];

const arrayLengthMissing = structuredClone(arrayIndex);
arrayLengthMissing.contract.id = "array-length-is-not-a-value-path";
requirement(arrayLengthMissing, "value_equals").path = ["length"];

const whitespaceObjectPath = structuredClone(coherent);
whitespaceObjectPath.contract.id = "whitespace-object-path";
whitespaceObjectPath.contract.requirements = [
  {
    id: "whitespace-key",
    type: "value_equals",
    description: "Whitespace object keys remain exact",
    role: "ci",
    path: [" "],
    expected: "passed",
  },
];
observation(whitespaceObjectPath, "ci").value = { " ": "passed" };

const advisoryUnknown = structuredClone(coherent);
advisoryUnknown.contract.id = "advisory-unknown";
advisoryUnknown.contract.requirements.push({
  id: "optional-provider-note",
  type: "value_equals",
  description: "An optional provider note is present",
  required: false,
  role: "optional",
  path: ["note"],
  expected: "present",
});

const violationDominatesUnknown = structuredClone(mismatch);
violationDominatesUnknown.contract.id = "violation-dominates-unknown";
violationDominatesUnknown.contract.requirements.push({
  id: "missing-optional-system",
  type: "value_equals",
  description: "A required external approval is present",
  role: "external-approval",
  path: ["approved"],
  expected: true,
});

const openEndedOverlap = structuredClone(coherent);
openEndedOverlap.contract.id = "open-ended-overlap";
observation(openEndedOverlap, "approval").witness.validity.until = null;

const reversedOrdering = structuredClone(coherent);
reversedOrdering.contract.id = coherent.contract.id;
reversedOrdering.contract.requirements.reverse();
reversedOrdering.observations.reverse();

const requirementLimit = structuredClone(coherent);
requirementLimit.contract.id = "planner-requirement-limit";
requirementLimit.contract.requirements = Array.from(
  { length: 65 },
  (_, index) => ({
    id: `missing-${String(index).padStart(2, "0")}`,
    type: "value_equals",
    description: `Missing role ${index}`,
    role: `missing-${index}`,
    path: ["value"],
    expected: true,
  }),
);
requirementLimit.observations = [];

const combinationLimit = structuredClone(mismatch);
combinationLimit.contract.id = "planner-combination-limit";
const dependencyTemplate = structuredClone(
  requirement(combinationLimit, "dependency"),
);
combinationLimit.contract.requirements = Array.from(
  { length: 17 },
  (_, index) => ({
    ...structuredClone(dependencyTemplate),
    id: `mismatch-${String(index).padStart(2, "0")}`,
    description: `Mismatched dependency ${index}`,
  }),
);

const verificationCases = [
  ["coherent", coherent],
  ["dependency-mismatch", mismatch],
  ["temporal-gap", temporalGap],
  ["missing-dependency", missingEvidence],
  ["value-mismatch", valueMismatch],
  ["value-path-missing", valuePathMissing],
  ["array-index", arrayIndex],
  ["array-length-is-not-a-value-path", arrayLengthMissing],
  ["whitespace-object-path", whitespaceObjectPath],
  ["advisory-unknown", advisoryUnknown],
  ["violation-dominates-unknown", violationDominatesUnknown],
  ["open-ended-overlap", openEndedOverlap],
  ["planner-requirement-limit", requirementLimit],
  ["planner-combination-limit", combinationLimit],
  ["reversed-ordering", reversedOrdering],
].map(([name, input]) => ({
  name,
  input,
  expected: verifyDecisionContract(input),
}));

const coherentVector = verificationCases.find(
  (candidate) => candidate.name === "coherent",
);
const reorderedVector = verificationCases.find(
  (candidate) => candidate.name === "reversed-ordering",
);
if (
  !coherentVector ||
  !reorderedVector ||
  coherentVector.expected.verificationRecordDigest !==
    reorderedVector.expected.verificationRecordDigest
) {
  throw new Error("Reordered equivalent input changed the verification digest");
}

function invalidCase(name, input) {
  let error;
  try {
    verifyDecisionContract(input);
  } catch (candidate) {
    error = candidate;
  }
  if (!(error instanceof WorldCutError)) {
    throw new Error(`${name} did not throw a structured WorldCut error`);
  }
  return {
    name,
    input,
    expectedErrorCode: error.code,
  };
}

const invalidProtocol = structuredClone(coherent);
invalidProtocol.protocolVersion = "1.0";

const duplicateRole = structuredClone(coherent);
duplicateRole.observations[1].role = duplicateRole.observations[0].role;

const duplicateObservationId = structuredClone(coherent);
duplicateObservationId.observations[1].id =
  duplicateObservationId.observations[0].id;

const invalidInterval = structuredClone(coherent);
requirement(invalidInterval, "common_valid_time").within.until =
  requirement(invalidInterval, "common_valid_time").within.from;

const futureObservation = structuredClone(coherent);
futureObservation.observations[0].observedAt =
  "2026-09-02T18:00:00.001Z";

const excessiveCost = structuredClone(coherent);
excessiveCost.observations[0].acquisitionCost = 1_000_000_001;

const fractionalCost = structuredClone(coherent);
fractionalCost.observations[0].acquisitionCost = 1.2;

const unsupportedField = structuredClone(coherent);
unsupportedField.contract.unsupported = true;

const allAdvisory = structuredClone(coherent);
for (const candidate of allAdvisory.contract.requirements) {
  candidate.required = false;
}

const duplicateRequirementId = structuredClone(coherent);
duplicateRequirementId.contract.requirements[1].id =
  duplicateRequirementId.contract.requirements[0].id;

const duplicateDependency = structuredClone(coherent);
const dependencyObservation = observation(duplicateDependency, "ci");
dependencyObservation.witness.dependencies.push(
  structuredClone(dependencyObservation.witness.dependencies[0]),
);

const invalidTimestamp = structuredClone(coherent);
invalidTimestamp.contract.decisionTime = "2026-09-02";

const invalidUnicode = structuredClone(coherent);
observation(invalidUnicode, "ci").value = "\ud800";

const invalidCases = [
  invalidCase("unsupported-protocol", invalidProtocol),
  invalidCase("duplicate-role", duplicateRole),
  invalidCase("duplicate-observation-id", duplicateObservationId),
  invalidCase("invalid-interval", invalidInterval),
  invalidCase("future-observation", futureObservation),
  invalidCase("excessive-acquisition-cost", excessiveCost),
  invalidCase("fractional-acquisition-cost", fractionalCost),
  invalidCase("unsupported-field", unsupportedField),
  invalidCase("all-advisory", allAdvisory),
  invalidCase("duplicate-requirement-id", duplicateRequirementId),
  invalidCase("duplicate-dependency-name", duplicateDependency),
  invalidCase("invalid-timestamp", invalidTimestamp),
];

const canonicalValues = [
  ["object-key-order", { z: 1, a: 2 }],
  ["nested", { b: [true, null, { y: "two", x: "one" }], a: 0 }],
  ["unicode-key-order", { "\r": "cr", "1": "one", "€": "euro", "😀": "face", "ö": "o" }],
  ["numbers", [333333333.33333329, 1e30, 4.5, 0.002, 1e-27]],
  ["escaped-string", "€$\u000f\nA'B\"\\\\\"/"],
];
const canonicalCases = canonicalValues.map(([name, value]) => ({
  name,
  value,
  expectedCanonicalJson: canonicalJson(value),
  expectedSha256: sha256Digest(value),
}));
const rawUnicodePath = "raw/unpaired-high-surrogate.json";
const rawUnicodeContents = json(invalidUnicode);
const rawCases = [
  {
    name: "unpaired-high-surrogate",
    file: rawUnicodePath,
    sha256: createHash("sha256").update(rawUnicodeContents).digest("hex"),
    acceptedOutcomes: [
      "PARSE_ERROR",
      "WORLDCUT_INVALID_INPUT",
    ],
  },
];

const outputs = {
  "verification-vectors.json": {
    protocolVersion: "0.1",
    engineVersion: "0.1.2",
    cases: verificationCases,
  },
  "invalid-vectors.json": {
    protocolVersion: "0.1",
    cases: invalidCases,
  },
  "canonicalization-vectors.json": {
    canonicalization: "worldcut-json-v1",
    cases: canonicalCases,
  },
  "raw-vectors.json": {
    protocolVersion: "0.1",
    cases: rawCases,
  },
};

const rendered = Object.fromEntries(
  Object.entries(outputs).map(([name, value]) => [name, json(value)]),
);
rendered[rawUnicodePath] = rawUnicodeContents;
const manifest = {
  protocolVersion: "0.1",
  engineVersion: "0.1.2",
  canonicalization: "worldcut-json-v1",
  files: Object.fromEntries(
    Object.entries(rendered).map(([name, contents]) => [
      name,
      {
        sha256: createHash("sha256").update(contents).digest("hex"),
        ...(outputs[name]
          ? { cases: outputs[name].cases.length }
          : { bytes: Buffer.byteLength(contents) }),
      },
    ]),
  ),
};
rendered["manifest.json"] = json(manifest);

await mkdir(outputDirectory, { recursive: true });
let mismatched = false;
for (const [name, contents] of Object.entries(rendered)) {
  for (const directory of [outputDirectory, ...mirrorDirectories]) {
    const path = join(directory, name);
    if (writeMode) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf8");
      console.log(`wrote ${path}`);
      continue;
    }
    let existing = "";
    try {
      existing = await readFile(path, "utf8");
    } catch {
      mismatched = true;
      console.error(`missing ${path}`);
      continue;
    }
    if (existing !== contents) {
      mismatched = true;
      console.error(`out of date ${path}`);
    }
  }
}

if (mismatched) {
  throw new Error(
    "Conformance vectors are out of date; run npm run conformance:update",
  );
}
