/**
 * The deterministic half of the differential corpus.
 *
 * Every committed conformance vector, every published example, and a set of
 * handcrafted edge cases are turned into transport bytes here. Cases that
 * depend on a number's lexical form, on duplicate member names, or on raw
 * encoding are authored as text or bytes so that no JavaScript value ever
 * normalizes them before a CLI sees them.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { members, raw, toJsonText } from "./json-text.mjs";

const DECISION_TIME = "2026-09-02T18:00:00.000Z";
const OBSERVED_AT = "2026-09-02T17:59:00.000Z";

/**
 * @typedef {object} DifferentialCase
 * @property {string} id
 * @property {string} category
 * @property {Buffer} bytes Exact transport bytes handed to every CLI.
 * @property {"result" | "oracle" | "code" | "transport"} expect
 * @property {string} [code] Required stable error code when `expect` is `code`.
 * @property {string[]} [allowed] Accepted outcomes when `expect` is `transport`.
 * @property {unknown} [expectedResult] Committed golden result, when one exists.
 * @property {string} [sameDigestAs] Another case id that must produce the same digest.
 * @property {string} [note] Why the case exists.
 */

/**
 * @param {unknown} value
 * @param {number} [indent]
 * @returns {Buffer}
 */
function encode(value, indent = 2) {
  return Buffer.from(toJsonText(value, { indent }), "utf8");
}

/**
 * @param {string} key
 * @returns {Record<string, string>}
 */
function resource(key) {
  return {
    provider: "github",
    account: "acme",
    kind: "branch_head",
    key,
  };
}

/**
 * @param {object} options
 * @param {string} options.role
 * @param {unknown} options.value
 * @param {number} [options.cost]
 * @param {Record<string, unknown>} [options.witness]
 * @param {string} [options.observedAt]
 * @param {Record<string, string>} [options.resource]
 * @returns {Record<string, unknown>}
 */
function observation(options) {
  return {
    id: `obs-${options.role}`,
    role: options.role,
    resource: options.resource ?? resource(options.role),
    value: options.value,
    observedAt: options.observedAt ?? OBSERVED_AT,
    acquisitionCost: options.cost ?? 1,
    witness: options.witness ?? { provenance: "provider_asserted" },
  };
}

/**
 * @param {object} options
 * @param {Array<Record<string, unknown>>} options.requirements
 * @param {Array<Record<string, unknown>>} options.observations
 * @param {string} [options.id]
 * @param {string} [options.decisionTime]
 * @returns {Record<string, unknown>}
 */
function input(options) {
  return {
    protocolVersion: "0.1",
    contract: {
      id: options.id ?? "differential-edge",
      version: "1",
      decisionTime: options.decisionTime ?? DECISION_TIME,
      assumptions: {
        clockModel: "trusted_normalized",
        intervalModel: "half_open",
        metadataModel: "honest_but_possibly_incomplete",
      },
      requirements: options.requirements,
    },
    observations: options.observations,
  };
}

/**
 * @param {string} id
 * @param {string} role
 * @param {string[]} path
 * @param {unknown} expected
 * @param {boolean} [required]
 * @returns {Record<string, unknown>}
 */
function valueEquals(id, role, path, expected, required) {
  /** @type {Record<string, unknown>} */
  const requirement = {
    id,
    type: "value_equals",
    description: `Value at ${path.join("/")} for ${role}`,
    role,
    path,
    expected,
  };
  if (required === false) {
    requirement["required"] = false;
  }
  return requirement;
}

/**
 * @param {string} id
 * @param {string} dependentRole
 * @param {string} targetRole
 * @param {string} dependencyName
 * @returns {Record<string, unknown>}
 */
function dependency(id, dependentRole, targetRole, dependencyName) {
  return {
    id,
    type: "dependency",
    description: `${dependentRole} depends on ${targetRole}`,
    dependentRole,
    targetRole,
    dependencyName,
  };
}

/**
 * @param {string} id
 * @param {string[]} roles
 * @param {string} from
 * @param {string | null} until
 * @returns {Record<string, unknown>}
 */
function commonValidTime(id, roles, from, until) {
  return {
    id,
    type: "common_valid_time",
    description: `${roles.join(" and ")} share a valid time`,
    roles,
    within: { from, until },
  };
}

/**
 * Handcrafted edge cases that pin behaviour the golden vectors do not cover.
 *
 * @returns {DifferentialCase[]}
 */
function edgeCases() {
  /** @type {DifferentialCase[]} */
  const cases = [];

  /**
   * @param {string} id
   * @param {unknown} document
   * @param {Partial<DifferentialCase>} [extra]
   */
  const add = (id, document, extra = {}) => {
    cases.push({
      id: `edge/${id}`,
      category: "edge",
      bytes: Buffer.isBuffer(document) ? document : encode(document),
      expect: "result",
      ...extra,
    });
  };

  // --- Number lexical forms -------------------------------------------------

  add(
    "number-underflow-positive",
    input({
      requirements: [valueEquals("tiny", "a", ["tiny"], raw("0"))],
      observations: [
        observation({
          role: "a",
          value: members([
            ["tiny", raw("1e-400")],
            ["huge", raw("1.7976931348623157e308")],
          ]),
        }),
      ],
    }),
    {
      note: "finite IEEE-754 underflow must parse as 0 in every port",
    },
  );

  add(
    "number-underflow-negative",
    input({
      requirements: [valueEquals("tiny", "a", ["tiny"], raw("-0"))],
      observations: [
        observation({
          role: "a",
          value: members([["tiny", raw("-1e-400")]]),
        }),
      ],
    }),
    {
      note: "negative underflow must parse as negative zero and canonicalize to 0",
    },
  );

  add(
    "number-underflow-nested",
    input({
      requirements: [valueEquals("tiny", "a", ["deep", "0", "x"], raw("0"))],
      observations: [
        observation({
          role: "a",
          value: members([
            ["deep", [members([["x", raw("2e-400")]])]],
            ["also", [raw("-1e-999"), raw("1e-320")]],
          ]),
        }),
      ],
    }),
    { note: "underflow inside nested containers" },
  );

  add(
    "number-negative-zero",
    input({
      requirements: [valueEquals("zero", "a", ["z"], raw("0"))],
      observations: [
        observation({ role: "a", value: members([["z", raw("-0")]]) }),
      ],
    }),
    { note: "worldcut-json-v1 serializes negative zero as 0" },
  );

  add(
    "number-lexical-forms",
    input({
      requirements: [valueEquals("hundred", "a", ["b"], raw("100"))],
      observations: [
        observation({
          role: "a",
          value: members([
            ["a", raw("1.0")],
            ["b", raw("1E+2")],
            ["c", raw("0.1")],
            ["d", raw("1e21")],
            ["e", raw("-1.5e-7")],
            ["f", raw("3.0e0")],
          ]),
        }),
      ],
    }),
    { note: "exponent and trailing-zero spellings must be value-equal" },
  );

  add(
    "number-boundaries",
    input({
      requirements: [valueEquals("max", "a", ["max"], raw("1.7976931348623157e308"))],
      observations: [
        observation({
          role: "a",
          value: members([
            ["max", raw("1.7976931348623157e308")],
            ["minNormal", raw("2.2250738585072014e-308")],
            ["minSubnormal", raw("5e-324")],
            ["maxSafe", raw("9007199254740991")],
            ["minSafe", raw("-9007199254740991")],
            ["beyondSafe", raw("9007199254740993")],
          ]),
        }),
      ],
    }),
    { note: "IEEE-754 boundary doubles and integer precision loss" },
  );

  // --- Unicode and UTF-16 ordering -----------------------------------------

  add(
    "unicode-key-ordering",
    input({
      requirements: [
        valueEquals("k1", "a", ["Ｚ"], "fullwidth"),
        valueEquals("k2", "a", ["𝄞"], "astral"),
        valueEquals("k3", "a", ["ä"], "latin"),
      ],
      observations: [
        observation({
          role: "a",
          value: members([
            ["𝄞", "astral"],
            ["z", "lower"],
            ["Ｚ", "fullwidth"],
            ["Z", "upper"],
            ["ä", "latin"],
            ["", "empty-key"],
          ]),
        }),
      ],
    }),
    { note: "canonical member ordering by raw UTF-16 code units" },
  );

  add(
    "unicode-key-ordering-reordered",
    input({
      requirements: [
        valueEquals("k3", "a", ["ä"], "latin"),
        valueEquals("k2", "a", ["𝄞"], "astral"),
        valueEquals("k1", "a", ["Ｚ"], "fullwidth"),
      ],
      observations: [
        observation({
          role: "a",
          value: members([
            ["", "empty-key"],
            ["ä", "latin"],
            ["Z", "upper"],
            ["Ｚ", "fullwidth"],
            ["z", "lower"],
            ["𝄞", "astral"],
          ]),
        }),
      ],
    }),
    {
      sameDigestAs: "edge/unicode-key-ordering",
      note: "member and requirement order must not change the digest",
    },
  );

  add(
    "unicode-strings",
    input({
      requirements: [valueEquals("s", "a", ["text"], "line\nbreak\ttab \"q\" \\ Ω≈ç 𝄞")],
      observations: [
        observation({
          role: "a",
          value: members([
            ["text", "line\nbreak\ttab \"q\" \\ Ω≈ç 𝄞"],
            ["combining", "e\u0301 vs \u00e9"],
            ["control", "\u0001\u001f"],
          ]),
        }),
      ],
    }),
    { note: "escaping, combining marks, and control characters" },
  );

  add(
    "unicode-escaped-input",
    Buffer.from(
      toJsonText(
        input({
          requirements: [valueEquals("s", "a", ["text"], "Ω 𝄞")],
          observations: [
            observation({ role: "a", value: members([["text", "Ω 𝄞"]]) }),
          ],
        }),
        { indent: 2 },
      ).replaceAll("Ω", "\\u03a9").replaceAll("𝄞", "\\ud834\\udd1e"),
      "utf8",
    ),
    {
      sameDigestAs: "edge/unicode-escaped-literal",
      note: "\\u escapes and literal UTF-8 must be the same document",
    },
  );

  add(
    "unicode-escaped-literal",
    input({
      requirements: [valueEquals("s", "a", ["text"], "Ω 𝄞")],
      observations: [
        observation({ role: "a", value: members([["text", "Ω 𝄞"]]) }),
      ],
    }),
    { note: "literal UTF-8 counterpart of the escaped case" },
  );

  // --- value_equals path handling ------------------------------------------

  add(
    "path-whitespace-members",
    input({
      requirements: [
        valueEquals("space", "a", [" "], "single-space"),
        valueEquals("inner", "a", ["a b"], "inner-space"),
      ],
      observations: [
        observation({
          role: "a",
          value: members([
            [" ", "single-space"],
            ["a b", "inner-space"],
          ]),
        }),
      ],
    }),
    { note: "whitespace member names remain addressable" },
  );

  add(
    "path-array-index",
    input({
      requirements: [
        valueEquals("first", "a", ["items", "0"], "alpha"),
        valueEquals("nested", "a", ["items", "2", "k"], "deep"),
        valueEquals("length", "a", ["items", "length"], 3, false),
        valueEquals("leadingZero", "a", ["items", "00"], "alpha", false),
      ],
      observations: [
        observation({
          role: "a",
          value: members([
            ["items", ["alpha", "beta", members([["k", "deep"]])]],
          ]),
        }),
      ],
    }),
    { note: "array indexing, and `length` / `00` are not value paths" },
  );

  add(
    "path-missing-and-null",
    input({
      requirements: [
        valueEquals("missing", "a", ["absent"], "x"),
        valueEquals("null", "a", ["nothing"], null, false),
        valueEquals("throughNull", "a", ["nothing", "x"], "x", false),
        valueEquals("empty", "a", ["object"], members([]), false),
      ],
      observations: [
        observation({
          role: "a",
          value: members([
            ["nothing", null],
            ["object", members([])],
            ["array", []],
          ]),
        }),
      ],
    }),
    { note: "absent paths, null values, and empty containers" },
  );

  add(
    "value-equals-structural",
    input({
      requirements: [
        valueEquals(
          "reordered",
          "a",
          ["payload"],
          members([
            ["b", [1, members([["y", 2]])]],
            ["a", raw("1.0")],
          ]),
        ),
      ],
      observations: [
        observation({
          role: "a",
          value: members([
            [
              "payload",
              members([
                ["a", raw("1")],
                ["b", [raw("1e0"), members([["y", raw("2.0")]])]],
              ]),
            ],
          ]),
        }),
      ],
    }),
    { note: "structural equality is canonical, not textual" },
  );

  add(
    "deep-nesting",
    (() => {
      /** @type {unknown} */
      let value = "bottom";
      /** @type {string[]} */
      const path = [];
      for (let level = 0; level < 24; level += 1) {
        value = members([["n", value]]);
        path.unshift("n");
      }
      return input({
        requirements: [valueEquals("deep", "a", path, "bottom")],
        observations: [observation({ role: "a", value })],
      });
    })(),
    { note: "deep but legal nesting, far below the 48-level transport cap" },
  );

  // --- dependency evaluation -----------------------------------------------

  /**
   * @param {string | undefined} version
   * @param {Record<string, string>} [target]
   * @returns {Record<string, unknown>}
   */
  const dependencyWitness = (version, target) => {
    /** @type {Record<string, unknown>} */
    const record = {
      name: "tested_head",
      resource: target ?? resource("b"),
      relation: "exact",
      provenance: "provider_asserted",
    };
    if (version !== undefined) {
      record["version"] = version;
    }
    return {
      provenance: "provider_asserted",
      version: "run-1",
      dependencies: [record],
    };
  };

  add(
    "dependency-satisfied",
    input({
      requirements: [dependency("d", "a", "b", "tested_head")],
      observations: [
        observation({
          role: "a",
          value: members([["status", "passed"]]),
          witness: dependencyWitness("commit-B"),
          cost: 4,
        }),
        observation({
          role: "b",
          value: members([["commit", "commit-B"]]),
          witness: { provenance: "provider_asserted", version: "commit-B" },
        }),
      ],
    }),
    { note: "matching dependency version" },
  );

  add(
    "dependency-version-violated",
    input({
      requirements: [dependency("d", "a", "b", "tested_head")],
      observations: [
        observation({
          role: "a",
          value: members([["status", "passed"]]),
          witness: dependencyWitness("commit-A"),
          cost: 4,
        }),
        observation({
          role: "b",
          value: members([["commit", "commit-B"]]),
          witness: { provenance: "provider_asserted", version: "commit-B" },
        }),
      ],
    }),
    { note: "violated dependency produces two acquisition options" },
  );

  add(
    "dependency-resource-violated",
    input({
      requirements: [dependency("d", "a", "b", "tested_head")],
      observations: [
        observation({
          role: "a",
          value: members([["status", "passed"]]),
          witness: dependencyWitness("commit-B", resource("other")),
          cost: 4,
        }),
        observation({
          role: "b",
          value: members([["commit", "commit-B"]]),
          witness: { provenance: "provider_asserted", version: "commit-B" },
        }),
      ],
    }),
    { note: "dependency bound to a different resource" },
  );

  add(
    "dependency-unknown-version",
    input({
      requirements: [dependency("d", "a", "b", "tested_head")],
      observations: [
        observation({
          role: "a",
          value: members([["status", "passed"]]),
          witness: dependencyWitness(undefined),
          cost: 4,
        }),
        observation({
          role: "b",
          value: members([["commit", "commit-B"]]),
          witness: { provenance: "provider_asserted" },
        }),
      ],
    }),
    { note: "both versions missing produces a metadata fetch plan" },
  );

  add(
    "dependency-unknown-name",
    input({
      requirements: [dependency("d", "a", "b", "not_declared")],
      observations: [
        observation({
          role: "a",
          value: members([["status", "passed"]]),
          witness: dependencyWitness("commit-B"),
          cost: 9,
        }),
        observation({
          role: "b",
          value: members([["commit", "commit-B"]]),
          witness: { provenance: "provider_asserted", version: "commit-B" },
        }),
      ],
    }),
    { note: "declared dependency name is absent from the witness" },
  );

  add(
    "dependency-missing-roles",
    input({
      requirements: [dependency("d", "absent", "b", "tested_head")],
      observations: [
        observation({
          role: "b",
          value: members([["commit", "commit-B"]]),
          witness: { provenance: "provider_asserted", version: "commit-B" },
        }),
        anchorObservation(),
      ],
    }),
    { note: "unbound roles fail closed with an acquisition action" },
  );

  // --- temporal evaluation --------------------------------------------------

  add(
    "temporal-overlap",
    input({
      requirements: [
        commonValidTime(
          "t",
          ["a", "b"],
          "2026-09-02T17:55:00.000Z",
          "2026-09-02T18:00:00.001Z",
        ),
      ],
      observations: [
        observation({
          role: "a",
          value: members([["ok", true]]),
          witness: {
            provenance: "provider_asserted",
            validity: {
              from: "2026-09-02T17:50:00.000Z",
              until: "2026-09-02T18:10:00.000Z",
            },
          },
        }),
        observation({
          role: "b",
          value: members([["ok", true]]),
          witness: {
            provenance: "provider_asserted",
            validity: {
              from: "2026-09-02T17:58:00.000Z",
              until: null,
            },
          },
        }),
      ],
    }),
    { note: "open-ended and closed validity overlap" },
  );

  add(
    "temporal-gap",
    input({
      requirements: [
        commonValidTime(
          "t",
          ["a", "b"],
          "2026-09-02T17:00:00.000Z",
          "2026-09-02T18:00:00.000Z",
        ),
      ],
      observations: [
        observation({
          role: "a",
          value: members([["ok", true]]),
          witness: {
            provenance: "provider_asserted",
            validity: {
              from: "2026-09-02T17:00:00.000Z",
              until: "2026-09-02T17:30:00.000Z",
            },
          },
        }),
        observation({
          role: "b",
          value: members([["ok", true]]),
          witness: {
            provenance: "provider_asserted",
            validity: {
              from: "2026-09-02T17:30:00.000Z",
              until: "2026-09-02T17:59:00.000Z",
            },
          },
        }),
      ],
    }),
    { note: "half-open intervals that touch but never overlap" },
  );

  add(
    "temporal-missing-validity",
    input({
      requirements: [
        commonValidTime(
          "t",
          ["a", "b", "c"],
          "2026-09-02T17:00:00.000Z",
          null,
        ),
      ],
      observations: [
        observation({
          role: "a",
          value: members([["ok", true]]),
          cost: 12,
        }),
        observation({
          role: "b",
          value: members([["ok", true]]),
          cost: 40,
          witness: {
            provenance: "provider_asserted",
            validity: {
              from: "2026-09-02T17:00:00.000Z",
              until: null,
            },
          },
        }),
        observation({ role: "c", value: members([["ok", true]]), cost: 3 }),
      ],
    }),
    { note: "missing validity metadata drives a fetch plan" },
  );

  // --- planning, dedup, and aggregation ------------------------------------

  add(
    "plan-deduplicates-actions",
    input({
      requirements: [
        valueEquals("v1", "a", ["missing1"], "x"),
        valueEquals("v2", "a", ["missing2"], "y"),
        valueEquals("v3", "b", ["missing3"], "z"),
      ],
      observations: [
        observation({
          role: "a",
          value: members([["status", "passed"]]),
          cost: 7,
        }),
        observation({
          role: "b",
          value: members([["status", "passed"]]),
          cost: 11,
        }),
      ],
    }),
    { note: "identical refresh actions must be counted once" },
  );

  add(
    "aggregation-advisory-only",
    input({
      requirements: [
        valueEquals("required-ok", "a", ["status"], "passed"),
        valueEquals("advisory-bad", "a", ["status"], "failed", false),
        valueEquals("advisory-unknown", "a", ["absent"], "x", false),
      ],
      observations: [
        observation({ role: "a", value: members([["status", "passed"]]) }),
      ],
    }),
    { note: "advisory failures must not change the verdict" },
  );

  add(
    "aggregation-violation-dominates",
    input({
      requirements: [
        valueEquals("violated", "a", ["status"], "failed"),
        valueEquals("unknown", "a", ["absent"], "x"),
      ],
      observations: [
        observation({ role: "a", value: members([["status", "passed"]]) }),
      ],
    }),
    { note: "a violation outranks an unknown" },
  );

  add(
    "cost-boundaries",
    input({
      requirements: [
        valueEquals("v1", "a", ["absent"], "x"),
        valueEquals("v2", "b", ["absent"], "x"),
      ],
      observations: [
        observation({
          role: "a",
          value: members([["status", "passed"]]),
          cost: 1000000000,
        }),
        observation({
          role: "b",
          value: members([["status", "passed"]]),
          cost: 0,
        }),
      ],
    }),
    { note: "maximum and zero acquisition costs" },
  );

  // --- ordering independence ------------------------------------------------

  const orderingRequirements = [
    valueEquals("z-last", "a", ["status"], "passed"),
    dependency("m-mid", "a", "b", "tested_head"),
    commonValidTime(
      "a-first",
      ["a", "b"],
      "2026-09-02T17:00:00.000Z",
      "2026-09-02T18:00:00.001Z",
    ),
  ];
  const orderingObservations = [
    observation({
      role: "a",
      value: members([["status", "passed"]]),
      cost: 5,
      witness: {
        provenance: "provider_asserted",
        version: "run-1",
        validity: {
          from: "2026-09-02T17:30:00.000Z",
          until: null,
        },
        dependencies: [
          {
            name: "tested_head",
            resource: resource("b"),
            relation: "exact",
            version: "commit-B",
            provenance: "provider_asserted",
          },
        ],
      },
    }),
    observation({
      role: "b",
      value: members([["commit", "commit-B"]]),
      cost: 2,
      witness: {
        provenance: "provider_asserted",
        version: "commit-B",
        validity: {
          from: "2026-09-02T17:40:00.000Z",
          until: "2026-09-02T18:40:00.000Z",
        },
      },
    }),
  ];

  add(
    "ordering-declared",
    input({
      requirements: orderingRequirements,
      observations: orderingObservations,
    }),
    { note: "baseline ordering for the reordered twin" },
  );

  add(
    "ordering-reversed",
    input({
      requirements: [...orderingRequirements].reverse(),
      observations: [...orderingObservations].reverse(),
    }),
    {
      sameDigestAs: "edge/ordering-declared",
      note: "input array order must not affect the verification record",
    },
  );

  return cases;
}

/**
 * A second observation used to keep an unbound-role case otherwise valid.
 *
 * @returns {Record<string, unknown>}
 */
function anchorObservation() {
  return observation({
    role: "anchor",
    value: members([["status", "passed"]]),
    cost: 3,
  });
}

/**
 * Malformed or ambiguous transport bytes.
 *
 * `spec/0.1/CONFORMANCE.md` lets an implementation reject these either in its
 * JSON parser or in protocol validation, so the harness asserts that every port
 * fails with one of the accepted outcomes rather than with identical prose.
 *
 * @param {string} repoRoot
 * @returns {DifferentialCase[]}
 */
function transportCases(repoRoot) {
  const parseOrInvalid = ["PARSE_ERROR", "WORLDCUT_INVALID_INPUT"];

  const valid = toJsonText(
    input({
      requirements: [valueEquals("v", "a", ["status"], "passed")],
      observations: [
        observation({ role: "a", value: members([["status", "passed"]]) }),
      ],
    }),
    { indent: 2 },
  );

  /** @type {DifferentialCase[]} */
  const cases = [];

  /**
   * @param {string} id
   * @param {Buffer} bytes
   * @param {string} note
   * @param {string[]} [allowed]
   */
  const add = (id, bytes, note, allowed = parseOrInvalid) => {
    cases.push({
      id: `transport/${id}`,
      category: "transport",
      bytes,
      expect: "transport",
      allowed,
      note,
    });
  };

  add("empty", Buffer.alloc(0), "an empty file is not a JSON document");
  add(
    "whitespace-only",
    Buffer.from("   \n\t\r\n", "utf8"),
    "whitespace without a value",
  );
  add(
    "truncated-object",
    Buffer.from(valid.slice(0, Math.floor(valid.length / 2)), "utf8"),
    "a document cut in half",
  );
  add(
    "trailing-value",
    Buffer.from(`${valid}\n{}\n`, "utf8"),
    "a second JSON value after the input",
  );
  add(
    "trailing-comma",
    Buffer.from(`${valid.slice(0, -1)},}`, "utf8"),
    "a trailing comma is not JSON",
  );
  add(
    "byte-order-mark",
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(valid, "utf8")]),
    "a UTF-8 byte-order mark before the document",
  );
  add(
    "invalid-utf8",
    Buffer.concat([
      Buffer.from(valid.slice(0, valid.indexOf("passed")), "utf8"),
      Buffer.from([0xff, 0xfe]),
      Buffer.from(valid.slice(valid.indexOf("passed")), "utf8"),
    ]),
    "bytes that are not valid UTF-8",
  );
  add(
    "raw-control-character",
    Buffer.from(valid.replace('"passed"', '"pas\u0001sed"'), "utf8"),
    "an unescaped control character inside a string",
  );
  add(
    "nul-byte",
    Buffer.concat([Buffer.from(valid, "utf8"), Buffer.from([0x00])]),
    "a NUL byte after the document",
  );
  add(
    "lone-high-surrogate",
    Buffer.from(valid.replace('"passed"', '"\\ud834"'), "utf8"),
    "an unpaired high surrogate escape",
  );
  add(
    "lone-low-surrogate",
    Buffer.from(valid.replace('"passed"', '"\\udd1e"'), "utf8"),
    "an unpaired low surrogate escape",
  );
  add(
    "nan-literal",
    Buffer.from(valid.replace('"acquisitionCost": 1', '"acquisitionCost": NaN'), "utf8"),
    "NaN is not a JSON number",
  );
  add(
    "infinity-literal",
    Buffer.from(
      valid.replace('"acquisitionCost": 1', '"acquisitionCost": Infinity'),
      "utf8",
    ),
    "Infinity is not a JSON number",
  );
  add(
    "number-overflow",
    Buffer.from(
      toJsonText(
        input({
          requirements: [valueEquals("v", "a", ["big"], raw("1"))],
          observations: [
            observation({ role: "a", value: members([["big", raw("1e400")]]) }),
          ],
        }),
        { indent: 2 },
      ),
      "utf8",
    ),
    "a number that overflows to infinity must be rejected",
    ["WORLDCUT_INVALID_INPUT", "PARSE_ERROR"],
  );
  add(
    "number-overflow-negative",
    Buffer.from(
      toJsonText(
        input({
          requirements: [valueEquals("v", "a", ["big"], raw("1"))],
          observations: [
            observation({ role: "a", value: members([["big", raw("-1e400")]]) }),
          ],
        }),
        { indent: 2 },
      ),
      "utf8",
    ),
    "negative overflow must be rejected",
    ["WORLDCUT_INVALID_INPUT", "PARSE_ERROR"],
  );
  add(
    "leading-zero-number",
    Buffer.from(valid.replace('"acquisitionCost": 1', '"acquisitionCost": 01'), "utf8"),
    "leading zeros are not JSON numbers",
  );
  add(
    "hex-number",
    Buffer.from(valid.replace('"acquisitionCost": 1', '"acquisitionCost": 0x1'), "utf8"),
    "hexadecimal is not a JSON number",
  );
  add(
    "single-quoted-string",
    Buffer.from(valid.replace('"passed"', "'passed'"), "utf8"),
    "single quotes are not JSON strings",
  );
  add(
    "top-level-array",
    Buffer.from("[]\n", "utf8"),
    "the protocol input must be an object",
  );
  add(
    "top-level-string",
    Buffer.from('"0.1"\n', "utf8"),
    "a bare string is not a verification input",
  );

  const raws = JSON.parse(
    readFileSync(join(repoRoot, "conformance", "0.1", "raw-vectors.json"), "utf8"),
  );
  for (const vector of raws.cases) {
    cases.push({
      id: `raw/${vector.name}`,
      category: "raw",
      bytes: readFileSync(
        join(repoRoot, "conformance", "0.1", ...vector.file.split("/")),
      ),
      expect: "transport",
      allowed: vector.acceptedOutcomes,
      note: "committed raw conformance vector",
    });
  }

  return cases;
}

/**
 * Verifies the committed conformance files before they become differential
 * inputs. This prevents a stale or locally corrupted corpus from weakening the
 * comparison while still looking like a successful run.
 *
 * @param {string} repoRoot
 * @returns {void}
 */
function verifyConformanceCorpus(repoRoot) {
  const root = join(repoRoot, "conformance", "0.1");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  for (const [name, metadata] of Object.entries(manifest.files)) {
    const bytes = readFileSync(join(root, ...name.split("/")));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== metadata.sha256) {
      throw new Error(
        `conformance file ${name} has SHA-256 ${digest}, expected ${metadata.sha256}`,
      );
    }
    if (metadata.bytes !== undefined && bytes.length !== metadata.bytes) {
      throw new Error(
        `conformance file ${name} has ${bytes.length} bytes, expected ${metadata.bytes}`,
      );
    }
    if (metadata.cases !== undefined) {
      const parsed = JSON.parse(bytes.toString("utf8"));
      if (!Array.isArray(parsed.cases) || parsed.cases.length !== metadata.cases) {
        throw new Error(
          `conformance file ${name} has ${String(parsed.cases?.length)} cases, expected ${metadata.cases}`,
        );
      }
    }
  }
}

/**
 * Applies user filters while keeping canonical-equivalence pairs together.
 * Selecting either side of a `sameDigestAs` relationship automatically pulls
 * in the other side so a focused reproduction cannot silently skip the digest
 * assertion it is meant to exercise.
 *
 * @param {DifferentialCase[]} cases
 * @param {{ category: string | null, only: string | null }} filters
 * @returns {DifferentialCase[]}
 */
export function selectCases(cases, filters) {
  const selectedIds = new Set(
    cases
      .filter((entry) => {
        if (filters.category !== null && entry.category !== filters.category) {
          return false;
        }
        return filters.only === null || entry.id.includes(filters.only);
      })
      .map((entry) => entry.id),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of cases) {
      if (
        selectedIds.has(entry.id) &&
        entry.sameDigestAs !== undefined &&
        !selectedIds.has(entry.sameDigestAs)
      ) {
        selectedIds.add(entry.sameDigestAs);
        changed = true;
      }
      if (
        entry.sameDigestAs !== undefined &&
        selectedIds.has(entry.sameDigestAs) &&
        !selectedIds.has(entry.id)
      ) {
        selectedIds.add(entry.id);
        changed = true;
      }
    }
  }

  return cases.filter((entry) => selectedIds.has(entry.id));
}

/**
 * Assembles every deterministic case.
 *
 * @param {string} repoRoot
 * @returns {DifferentialCase[]}
 */
export function deterministicCases(repoRoot) {
  verifyConformanceCorpus(repoRoot);

  /** @type {DifferentialCase[]} */
  const cases = [];

  const verification = JSON.parse(
    readFileSync(
      join(repoRoot, "conformance", "0.1", "verification-vectors.json"),
      "utf8",
    ),
  );
  for (const vector of verification.cases) {
    cases.push({
      id: `golden/${vector.name}`,
      category: "golden",
      bytes: Buffer.from(JSON.stringify(vector.input, null, 2), "utf8"),
      expect: "result",
      expectedResult: vector.expected,
      note: "committed verification vector",
    });
  }

  const invalid = JSON.parse(
    readFileSync(
      join(repoRoot, "conformance", "0.1", "invalid-vectors.json"),
      "utf8",
    ),
  );
  for (const vector of invalid.cases) {
    cases.push({
      id: `invalid/${vector.name}`,
      category: "invalid",
      bytes: Buffer.from(JSON.stringify(vector.input, null, 2), "utf8"),
      expect: "code",
      code: vector.expectedErrorCode,
      note: "committed invalid vector",
    });
  }

  for (const name of [
    "coherent-deployment",
    "git-ci-mismatch",
    "missing-evidence",
    "temporal-gap",
  ]) {
    cases.push({
      id: `example/${name}`,
      category: "example",
      bytes: readFileSync(join(repoRoot, "examples", `${name}.json`)),
      expect: "result",
      note: "published example",
    });
  }

  cases.push(...edgeCases());
  cases.push(...transportCases(repoRoot));

  return cases;
}
