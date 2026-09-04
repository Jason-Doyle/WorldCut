/**
 * Outcome normalization and structural comparison for the differential
 * harness.
 *
 * The harness compares *parsed* verification results, so indentation, member
 * order, line endings, `\u` escaping, and number spelling are all irrelevant by
 * construction. Everything else is treated as a semantic difference.
 */

/** Matches the `verificationRecordDigest` shape required by `spec/0.1`. */
export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The conformance suite allows a port to reject malformed transport bytes
 * either in its JSON parser or in protocol validation. This maps a port's
 * stable error code onto the outcome names used by
 * `conformance/0.1/raw-vectors.json`.
 *
 * @param {string} code
 * @returns {string | null}
 */
export function toRawOutcome(code) {
  if (code === "WORLDCUT_INVALID_INPUT") {
    return code;
  }
  if (code === "WORLDCUT_INVALID_JSON") {
    return "PARSE_ERROR";
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function kindOf(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * @param {string} segment
 * @returns {string}
 */
function pointerSegment(segment) {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * Collects the semantic differences between two parsed JSON documents.
 *
 * Numbers are compared with `===`, so `-0` and `0` are equal. That matches
 * `worldcut-json-v1`, which serializes negative zero as `0`, meaning the two
 * spellings can never produce different digests.
 *
 * @param {unknown} expected The TypeScript oracle value.
 * @param {unknown} actual The port value.
 * @param {{ limit?: number }} [options]
 * @returns {Array<{ path: string, expected: unknown, actual: unknown, reason: string }>}
 */
export function diffJson(expected, actual, options = {}) {
  const limit = options.limit ?? 20;
  /** @type {Array<{ path: string, expected: unknown, actual: unknown, reason: string }>} */
  const differences = [];

  /**
   * @param {unknown} left
   * @param {unknown} right
   * @param {string} path
   */
  const walk = (left, right, path) => {
    if (differences.length >= limit) {
      return;
    }
    const leftKind = kindOf(left);
    const rightKind = kindOf(right);
    if (leftKind !== rightKind) {
      differences.push({
        path,
        expected: left,
        actual: right,
        reason: `type ${leftKind} vs ${rightKind}`,
      });
      return;
    }
    if (leftKind === "array") {
      const leftItems = /** @type {unknown[]} */ (left);
      const rightItems = /** @type {unknown[]} */ (right);
      if (leftItems.length !== rightItems.length) {
        differences.push({
          path,
          expected: leftItems.length,
          actual: rightItems.length,
          reason: "array length",
        });
        return;
      }
      for (let index = 0; index < leftItems.length; index += 1) {
        walk(leftItems[index], rightItems[index], `${path}/${index}`);
      }
      return;
    }
    if (leftKind === "object") {
      const leftRecord = /** @type {Record<string, unknown>} */ (left);
      const rightRecord = /** @type {Record<string, unknown>} */ (right);
      const keys = [
        ...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]),
      ].sort();
      for (const key of keys) {
        const hasLeft = Object.hasOwn(leftRecord, key);
        const hasRight = Object.hasOwn(rightRecord, key);
        if (!hasLeft || !hasRight) {
          differences.push({
            path: `${path}/${pointerSegment(key)}`,
            expected: hasLeft ? leftRecord[key] : "<absent>",
            actual: hasRight ? rightRecord[key] : "<absent>",
            reason: hasLeft ? "member missing in port" : "member absent in oracle",
          });
          if (differences.length >= limit) {
            return;
          }
          continue;
        }
        walk(leftRecord[key], rightRecord[key], `${path}/${pointerSegment(key)}`);
        if (differences.length >= limit) {
          return;
        }
      }
      return;
    }
    if (left !== right) {
      differences.push({
        path,
        expected: left,
        actual: right,
        reason: "value",
      });
    }
  };

  walk(expected, actual, "");
  return differences;
}

/**
 * @param {unknown} expected
 * @param {unknown} actual
 * @returns {boolean}
 */
export function jsonEquals(expected, actual) {
  return diffJson(expected, actual, { limit: 1 }).length === 0;
}

/**
 * Renders a value for a failure report without dumping an entire document.
 *
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function preview(value, maxLength = 160) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) {
    return "undefined";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
