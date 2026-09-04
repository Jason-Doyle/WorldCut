/**
 * Deterministic self-checks for the differential harness.
 *
 * These run before any port is executed. If the generator, the raw-lexeme
 * writer, or the comparison logic ever regresses, the suite fails immediately
 * instead of silently comparing a weaker corpus.
 */

import { DeterministicRandom, expandSeed } from "./prng.mjs";
import {
  encodeJsonString,
  members,
  raw,
  toJsonData,
  toJsonText,
} from "./json-text.mjs";
import { diffJson, jsonEquals, toRawOutcome, DIGEST_PATTERN } from "./compare.mjs";
import { selectCases } from "./corpus.mjs";
import { generateRandomCase } from "./generate.mjs";

/**
 * @param {boolean} condition
 * @param {string} message
 */
function check(condition, message) {
  if (!condition) {
    throw new Error(`harness self-check failed: ${message}`);
  }
}

/**
 * @returns {number} The number of assertions performed.
 */
function checkPrng() {
  let assertions = 0;

  const first = new DeterministicRandom("seed-a");
  const second = new DeterministicRandom("seed-a");
  const third = new DeterministicRandom("seed-b");
  const a = Array.from({ length: 64 }, () => first.next());
  const b = Array.from({ length: 64 }, () => second.next());
  const c = Array.from({ length: 64 }, () => third.next());
  check(a.join() === b.join(), "the same seed must replay the same sequence");
  check(a.join() !== c.join(), "different seeds must diverge");
  assertions += 2;

  check(
    expandSeed("seed-a").join() === expandSeed("seed-a").join(),
    "seed expansion must be pure",
  );
  assertions += 1;

  const rng = new DeterministicRandom("bounds");
  for (let index = 0; index < 500; index += 1) {
    const value = rng.below(7);
    check(value >= 0 && value < 7, "below() must stay inside its bound");
    const ranged = rng.between(-3, 3);
    check(ranged >= -3 && ranged <= 3, "between() must stay inside its bounds");
  }
  assertions += 2;

  const source = [1, 2, 3, 4, 5, 6, 7, 8];
  const shuffled = new DeterministicRandom("shuffle").shuffled(source);
  check(shuffled.length === source.length, "shuffle must preserve length");
  check(
    [...shuffled].sort((left, right) => left - right).join() === source.join(),
    "shuffle must preserve elements",
  );
  check(source.join() === "1,2,3,4,5,6,7,8", "shuffle must not mutate its input");
  check(
    new DeterministicRandom("shuffle").shuffled(source).join() ===
      shuffled.join(),
    "shuffle must be deterministic",
  );
  assertions += 4;

  const sample = new DeterministicRandom("sample").sample(source, 3);
  check(sample.length === 3, "sample must honour its count");
  check(new Set(sample).size === 3, "sample must be distinct");
  assertions += 2;

  return assertions;
}

/**
 * @returns {number}
 */
function checkJsonText() {
  let assertions = 0;

  check(
    toJsonText(raw("1e-400"), { indent: 0 }) === "1e-400",
    "raw number lexemes must survive serialization",
  );
  check(
    toJsonText(raw("-0"), { indent: 0 }) === "-0",
    "negative zero must survive serialization",
  );
  check(
    JSON.stringify(-0) === "0",
    "JSON.stringify still erases negative zero, which is why raw() exists",
  );
  assertions += 3;

  const duplicated = toJsonText(
    members([
      ["a", 1],
      ["a", 2],
    ]),
    { indent: 0 },
  );
  check(
    duplicated === '{"a":1,"a":2}',
    `duplicate member names must be preserved, got ${duplicated}`,
  );
  assertions += 1;

  const ordered = toJsonText(
    members([
      ["z", 1],
      ["a", 2],
    ]),
    { indent: 0 },
  );
  check(ordered === '{"z":1,"a":2}', "declared member order must be preserved");
  assertions += 1;

  check(
    encodeJsonString('a"b\\c\nd\te\u0000f') === '"a\\"b\\\\c\\nd\\te\\u0000f"',
    "string escaping must be JSON-legal",
  );
  check(
    encodeJsonString("Ω 𝄞") === '"Ω 𝄞"',
    "non-ASCII characters stay literal so transport bytes are real UTF-8",
  );
  assertions += 2;

  const nested = members([
    ["outer", [1, members([["inner", "x"]]), null, true]],
  ]);
  check(
    jsonEquals(toJsonData(nested), { outer: [1, { inner: "x" }, null, true] }),
    "node trees must resolve to the intended JSON data",
  );
  check(
    toJsonText(nested, { indent: 2 }).includes("\n"),
    "indentation must be applied when requested",
  );
  check(
    !toJsonText(nested, { indent: 0 }).includes("\n"),
    "compact output must have no line breaks",
  );
  assertions += 3;

  let rejected = false;
  try {
    toJsonText(-0);
  } catch {
    rejected = true;
  }
  check(rejected, "a bare -0 must be rejected so lexemes are never lost");
  assertions += 1;

  return assertions;
}

/**
 * @returns {number}
 */
function checkCompare() {
  let assertions = 0;

  check(
    jsonEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }),
    "member order must be ignored",
  );
  check(jsonEquals(0, -0), "negative zero equals zero under worldcut-json-v1");
  check(!jsonEquals([1, 2], [2, 1]), "array order must be significant");
  check(!jsonEquals({ a: 1 }, { a: 1, b: 2 }), "extra members must be reported");
  check(!jsonEquals(1, "1"), "type differences must be reported");
  check(!jsonEquals(null, false), "null and false must differ");
  assertions += 6;

  const differences = diffJson(
    { plan: { actions: [{ cost: 3 }] } },
    { plan: { actions: [{ cost: 4 }] } },
  );
  check(differences.length === 1, "one value difference must be reported once");
  check(
    differences[0]?.path === "/plan/actions/0/cost",
    `difference path must be a JSON pointer, got ${differences[0]?.path}`,
  );
  assertions += 2;

  const escaped = diffJson({ "a/b~c": 1 }, { "a/b~c": 2 });
  check(
    escaped[0]?.path === "/a~1b~0c",
    `pointer segments must be escaped, got ${escaped[0]?.path}`,
  );
  assertions += 1;

  const many = diffJson(
    { a: 1, b: 1, c: 1, d: 1 },
    { a: 2, b: 2, c: 2, d: 2 },
    { limit: 2 },
  );
  check(many.length === 2, "the difference limit must be honoured");
  assertions += 1;

  check(
    toRawOutcome("WORLDCUT_INVALID_INPUT") === "WORLDCUT_INVALID_INPUT",
    "validation failures keep their code",
  );
  check(
    toRawOutcome("WORLDCUT_INVALID_JSON") === "PARSE_ERROR",
    "parser failures map onto the PARSE_ERROR outcome",
  );
  for (const code of [
    "WORLDCUT_RUNTIME_ERROR",
    "WORLDCUT_FILE_READ_FAILED",
    "WORLDCUT_INVALID_ARGUMENT",
  ]) {
    check(
      toRawOutcome(code) === null,
      `${code} must not count as a parser rejection`,
    );
  }
  assertions += 3;

  check(
    DIGEST_PATTERN.test("f".repeat(64)) &&
      !DIGEST_PATTERN.test("F".repeat(64)) &&
      !DIGEST_PATTERN.test("f".repeat(63)),
    "the digest pattern must require 64 lowercase hex characters",
  );
  assertions += 1;

  return assertions;
}

/**
 * @returns {number}
 */
function checkGenerator() {
  let assertions = 0;

  for (const index of [0, 1, 7, 42, 199]) {
    const first = generateRandomCase("self-check", index);
    const second = generateRandomCase("self-check", index);
    check(
      first.text === second.text,
      `random case ${index} must be reproducible from its seed`,
    );
    check(
      first.id === second.id,
      `random case ${index} must have a stable identifier`,
    );
    const parsed = JSON.parse(first.text);
    check(
      parsed.protocolVersion === "0.1",
      `random case ${index} must declare protocol 0.1`,
    );
    check(
      Array.isArray(parsed.observations) && parsed.observations.length >= 2,
      `random case ${index} must bind at least two roles`,
    );
    check(
      Array.isArray(parsed.contract.requirements) &&
        parsed.contract.requirements.length >= 1,
      `random case ${index} must declare a requirement`,
    );
    check(
      parsed.contract.requirements.some(
        (/** @type {{ required?: boolean }} */ requirement) =>
          requirement.required !== false,
      ),
      `random case ${index} must keep at least one required requirement`,
    );
    const roles = parsed.observations.map(
      (/** @type {{ role: string }} */ observation) => observation.role,
    );
    check(
      new Set(roles).size === roles.length,
      `random case ${index} must not repeat a role`,
    );
    const ids = parsed.observations.map(
      (/** @type {{ id: string }} */ observation) => observation.id,
    );
    check(
      new Set(ids).size === ids.length,
      `random case ${index} must not repeat an observation id`,
    );
  }
  assertions += 7;

  const seedA = generateRandomCase("seed-a", 3).text;
  const seedB = generateRandomCase("seed-b", 3).text;
  check(seedA !== seedB, "different seeds must produce different cases");
  assertions += 1;

  const sampled = Array.from({ length: 120 }, (_, index) =>
    generateRandomCase("coverage", index).text,
  );
  check(
    new Set(sampled).size > sampled.length / 2,
    "the generator must not collapse onto a handful of documents",
  );
  const combined = sampled.join("\n");
  for (const feature of [
    "1e-400",
    "-0",
    "value_equals",
    "common_valid_time",
    "dependency",
    "dependencies",
    "validity",
    '"required": false',
    '"required":false',
  ]) {
    check(
      combined.includes(feature),
      `the generated corpus must exercise ${feature}`,
    );
  }
  for (const codePoint of ["Ω", "日", "𝄞", "Ｚ"]) {
    check(
      combined.includes(codePoint),
      `the generated corpus must exercise the ${codePoint} code point`,
    );
  }
  assertions += 3;

  return assertions;
}

/**
 * @param {import("./corpus.mjs").DifferentialCase[]} cases
 * @param {number} randomCount
 * @returns {number}
 */
function checkCorpus(cases, randomCount) {
  let assertions = 0;

  const ids = cases.map((entry) => entry.id);
  check(new Set(ids).size === ids.length, "case identifiers must be unique");
  assertions += 1;

  const categories = new Set(cases.map((entry) => entry.category));
  const required = [
    "golden",
    "invalid",
    "raw",
    "example",
    "edge",
    "transport",
  ];
  if (randomCount > 0) {
    required.push("random");
  }
  for (const name of required) {
    check(
      categories.has(name),
      `the corpus must include the ${name} category`,
    );
  }
  assertions += 1;

  for (const entry of cases) {
    check(
      Buffer.isBuffer(entry.bytes),
      `${entry.id} must carry transport bytes`,
    );
    if (entry.expect === "code") {
      check(
        typeof entry.code === "string" && entry.code.length > 0,
        `${entry.id} must name the expected error code`,
      );
    }
    if (entry.expect === "transport") {
      check(
        Array.isArray(entry.allowed) && entry.allowed.length > 0,
        `${entry.id} must list accepted outcomes`,
      );
    }
    if (entry.sameDigestAs !== undefined) {
      check(
        ids.includes(entry.sameDigestAs),
        `${entry.id} references unknown twin ${entry.sameDigestAs}`,
      );
    }
  }
  assertions += 1;

  const underflow = cases.filter((entry) =>
    entry.bytes.includes("1e-400"),
  );
  check(
    underflow.length > 0,
    "the corpus must send a finite underflow lexeme to every port",
  );
  assertions += 1;

  const digestPair = cases.find((entry) => entry.sameDigestAs !== undefined);
  check(digestPair !== undefined, "the corpus must contain a digest-equivalence pair");
  if (digestPair !== undefined) {
    const selected = selectCases(cases, {
      category: null,
      only: digestPair.id,
    });
    check(
      selected.some((entry) => entry.id === digestPair.sameDigestAs),
      "selecting one digest-equivalence case must include its twin",
    );
  }
  assertions += 1;

  return assertions;
}

/**
 * Runs every self-check.
 *
 * @param {import("./corpus.mjs").DifferentialCase[]} cases
 * @param {number} randomCount
 * @returns {{ assertions: number }}
 */
export function runSelfChecks(cases, randomCount) {
  const assertions =
    checkPrng() +
    checkJsonText() +
    checkCompare() +
    checkGenerator() +
    checkCorpus(cases, randomCount);
  return { assertions };
}
