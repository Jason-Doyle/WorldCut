import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  compareCanonicalText,
  sha256Digest,
} from "../canonical.js";

test("canonical ordering uses fixed Unicode code-unit order", () => {
  assert.equal(compareCanonicalText("z", "ä"), -1);
  assert.equal(canonicalJson({ ä: 2, z: 1 }), '{"z":1,"ä":2}');
});

test("canonical JSON rejects non-finite numbers instead of collapsing them to null", () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), /finite/);
  assert.throws(
    () => sha256Digest({ value: Number.POSITIVE_INFINITY }),
    /finite/,
  );
  assert.notEqual(sha256Digest({ value: 0 }), sha256Digest({ value: null }));
});

test("canonical JSON rejects accessors, hidden fields, and sparse arrays", () => {
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get: () => 1,
  });
  assert.throws(() => canonicalJson(accessor), /enumerable data/);

  const hidden = { visible: true };
  Object.defineProperty(hidden, "hidden", {
    enumerable: false,
    value: "different",
  });
  assert.throws(() => canonicalJson(hidden), /enumerable data/);

  assert.throws(() => canonicalJson(new Array(1)), /sparse array/);
});

test("canonical JSON preserves enumerable __proto__ as data", () => {
  const withProtoField: Record<string, unknown> = {};
  Object.defineProperty(withProtoField, "__proto__", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: "declared",
  });

  assert.equal(canonicalJson(withProtoField), '{"__proto__":"declared"}');
  assert.notEqual(sha256Digest(withProtoField), sha256Digest({}));
});

test("canonical JSON ignores inherited Array toJSON hooks", () => {
  Object.defineProperty(Array.prototype, "toJSON", {
    configurable: true,
    value: () => ["polluted"],
  });
  try {
    assert.equal(canonicalJson([1, 2]), "[1,2]");
    assert.notEqual(sha256Digest([1, 2]), sha256Digest([3, 4]));
  } finally {
    delete (Array.prototype as { toJSON?: unknown }).toJSON;
  }
});
