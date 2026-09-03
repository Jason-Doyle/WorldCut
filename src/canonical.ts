import { createHash } from "node:crypto";

export function compareCanonicalText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function assertValidUnicode(value: string, field: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${field} contains an unpaired high surrogate`);
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${field} contains an unpaired low surrogate`);
    }
  }
}

function snapshot(
  value: unknown,
  field: string,
  ancestors: Set<object>,
): unknown {
  if (
    value === null ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    assertValidUnicode(value, field);
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${field} contains a non-finite number`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${field} must use the standard Array prototype`);
    }
    if (ancestors.has(value)) {
      throw new TypeError(`${field} must not contain cycles`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${field} must not contain symbol properties`);
    }
    const propertyNames = Object.getOwnPropertyNames(value);
    const extraProperties = propertyNames.filter((name) => {
      if (name === "length") {
        return false;
      }
      const index = Number(name);
      return (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= value.length ||
        String(index) !== name
      );
    });
    if (extraProperties.length > 0) {
      throw new TypeError(
        `${field} contains unsupported array properties: ${extraProperties.join(", ")}`,
      );
    }
    ancestors.add(value);
    const result = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor) {
        throw new TypeError(`${field} must not be a sparse array`);
      }
      if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
        throw new TypeError(`${field}[${index}] must be enumerable data`);
      }
      Object.defineProperty(result, String(index), {
        value: snapshot(
          descriptor.value,
          `${field}[${index}]`,
          ancestors,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    ancestors.delete(value);
    return result;
  }

  if (typeof value === "object") {
    const objectValue = value as object;
    const prototype = Object.getPrototypeOf(objectValue);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${field} must be a plain object`);
    }
    if (ancestors.has(objectValue)) {
      throw new TypeError(`${field} must not contain cycles`);
    }
    if (Object.getOwnPropertySymbols(objectValue).length > 0) {
      throw new TypeError(`${field} must not contain symbol properties`);
    }
    ancestors.add(objectValue);
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(objectValue)) {
      assertValidUnicode(key, `${field} key`);
      const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        !descriptor.enumerable
      ) {
        throw new TypeError(`${field}.${key} must be enumerable data`);
      }
      Object.defineProperty(result, key, {
        value: snapshot(descriptor.value, `${field}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    ancestors.delete(objectValue);
    return result;
  }

  throw new TypeError(`${field} contains unsupported ${typeof value} data`);
}

export function snapshotJsonData(
  value: unknown,
  field = "value",
): unknown {
  return snapshot(value, field, new Set());
}

function serializeCanonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    let serialized = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        serialized += ",";
      }
      serialized += serializeCanonical(value[index]);
    }
    return `${serialized}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareCanonicalText);
  let serialized = "{";
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) {
      throw new Error("Canonical key ordering failed");
    }
    if (index > 0) {
      serialized += ",";
    }
    serialized += `${JSON.stringify(key)}:${serializeCanonical(record[key])}`;
  }
  return `${serialized}}`;
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(snapshotJsonData(value));
}

export function sha256Digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
