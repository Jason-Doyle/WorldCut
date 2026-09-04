/**
 * A JSON writer that preserves the exact lexical form of chosen tokens.
 *
 * `JSON.stringify` normalizes numbers before any port can observe them, so
 * `1e-400` becomes `0` and `-0` becomes `0`. The differential corpus has to send
 * the original lexeme to every CLI, so cases are built from these node types and
 * serialized here instead.
 */

/** A literal JSON token that is emitted exactly as written. */
export class RawJson {
  /**
   * @param {string} text Valid JSON token text, for example `1e-400`.
   */
  constructor(text) {
    this.text = text;
  }
}

/**
 * An object whose members are emitted in the given order, allowing repeated
 * member names for transport-level cases.
 */
export class OrderedMembers {
  /**
   * @param {ReadonlyArray<readonly [string, unknown]>} entries
   */
  constructor(entries) {
    /** @type {Array<[string, unknown]>} */
    this.entries = entries.map(([key, value]) => [key, value]);
  }
}

/**
 * @param {string} text
 * @returns {RawJson}
 */
export function raw(text) {
  return new RawJson(text);
}

/**
 * @param {ReadonlyArray<readonly [string, unknown]>} entries
 * @returns {OrderedMembers}
 */
export function members(entries) {
  return new OrderedMembers(entries);
}

const ESCAPES = new Map([
  ['"', '\\"'],
  ["\\", "\\\\"],
  ["\b", "\\b"],
  ["\f", "\\f"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
]);

/**
 * Escapes a JavaScript string into a JSON string token.
 *
 * Non-ASCII characters are emitted literally so the corpus exercises real UTF-8
 * transport bytes rather than `\u` escapes.
 *
 * @param {string} value
 * @returns {string}
 */
export function encodeJsonString(value) {
  let out = '"';
  for (const character of value) {
    const escape = ESCAPES.get(character);
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += character;
  }
  return `${out}"`;
}

/**
 * Serializes a node tree to JSON text.
 *
 * @param {unknown} value
 * @param {{ indent?: number }} [options]
 * @returns {string}
 */
export function toJsonText(value, options = {}) {
  const indent = options.indent ?? 2;
  return write(value, indent, 0);
}

/**
 * @param {unknown} value
 * @param {number} indent
 * @param {number} depth
 * @returns {string}
 */
function write(value, indent, depth) {
  if (value instanceof RawJson) {
    return value.text;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`cannot serialize non-finite number ${value}`);
    }
    if (Object.is(value, -0)) {
      throw new TypeError("use raw(\"-0\") so the lexeme survives serialization");
    }
    return String(value);
  }
  if (typeof value === "string") {
    return encodeJsonString(value);
  }
  if (Array.isArray(value)) {
    return writeItems(
      value.map((item) => write(item, indent, depth + 1)),
      "[",
      "]",
      indent,
      depth,
    );
  }
  if (value instanceof OrderedMembers) {
    return writeItems(
      value.entries.map(
        ([key, item]) =>
          `${encodeJsonString(key)}:${indent > 0 ? " " : ""}${write(item, indent, depth + 1)}`,
      ),
      "{",
      "}",
      indent,
      depth,
    );
  }
  if (typeof value === "object") {
    return writeItems(
      Object.entries(value).map(
        ([key, item]) =>
          `${encodeJsonString(key)}:${indent > 0 ? " " : ""}${write(item, indent, depth + 1)}`,
      ),
      "{",
      "}",
      indent,
      depth,
    );
  }
  throw new TypeError(`cannot serialize ${typeof value}`);
}

/**
 * @param {string[]} pieces
 * @param {string} open
 * @param {string} close
 * @param {number} indent
 * @param {number} depth
 * @returns {string}
 */
function writeItems(pieces, open, close, indent, depth) {
  if (pieces.length === 0) {
    return `${open}${close}`;
  }
  if (indent <= 0) {
    return `${open}${pieces.join(",")}${close}`;
  }
  const inner = " ".repeat(indent * (depth + 1));
  const outer = " ".repeat(indent * depth);
  return `${open}\n${inner}${pieces.join(`,\n${inner}`)}\n${outer}${close}`;
}

/**
 * Converts a node tree into plain JSON data by resolving raw tokens.
 *
 * Used by self-checks to confirm that a generated case is the JSON value the
 * generator intended.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function toJsonData(value) {
  return JSON.parse(toJsonText(value, { indent: 0 }));
}
