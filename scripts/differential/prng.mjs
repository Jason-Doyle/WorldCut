/**
 * Deterministic pseudo-random source for the cross-language differential
 * harness.
 *
 * The generator must produce byte-identical corpora from the same seed on every
 * platform, so it uses only 32-bit integer arithmetic and never touches
 * `Math.random`, the clock, or the environment.
 */

/**
 * Expands an arbitrary seed string into four 32-bit state words (cyrb128).
 *
 * @param {string} seed
 * @returns {[number, number, number, number]}
 */
export function expandSeed(seed) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/**
 * A small deterministic random helper built on the sfc32 generator.
 */
export class DeterministicRandom {
  /**
   * @param {string} seed
   */
  constructor(seed) {
    const [a, b, c, d] = expandSeed(String(seed));
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    for (let index = 0; index < 12; index += 1) {
      this.next();
    }
  }

  /**
   * @returns {number} The next 32-bit unsigned integer.
   */
  next() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /**
   * @returns {number} A float in `[0, 1)`.
   */
  float() {
    return this.next() / 4294967296;
  }

  /**
   * @param {number} bound Exclusive upper bound, must be a positive integer.
   * @returns {number} An integer in `[0, bound)`.
   */
  below(bound) {
    if (!Number.isSafeInteger(bound) || bound <= 0) {
      throw new RangeError(
        `bound must be a positive integer, received ${bound}`,
      );
    }
    return this.next() % bound;
  }

  /**
   * @param {number} min Inclusive lower bound.
   * @param {number} max Inclusive upper bound.
   * @returns {number}
   */
  between(min, max) {
    if (max < min) {
      throw new RangeError(`max ${max} is below min ${min}`);
    }
    return min + this.below(max - min + 1);
  }

  /**
   * @param {number} probability A value in `[0, 1]`.
   * @returns {boolean}
   */
  chance(probability) {
    return this.float() < probability;
  }

  /**
   * @template T
   * @param {readonly T[]} items
   * @returns {T}
   */
  pick(items) {
    if (items.length === 0) {
      throw new RangeError("cannot pick from an empty list");
    }
    const chosen = items[this.below(items.length)];
    if (chosen === undefined) {
      throw new Error("deterministic pick returned nothing");
    }
    return chosen;
  }

  /**
   * Returns a shuffled copy using a Fisher-Yates pass.
   *
   * @template T
   * @param {readonly T[]} items
   * @returns {T[]}
   */
  shuffled(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = this.below(index + 1);
      const left = copy[index];
      const right = copy[swap];
      if (left === undefined || right === undefined) {
        throw new Error("deterministic shuffle lost an element");
      }
      copy[index] = right;
      copy[swap] = left;
    }
    return copy;
  }

  /**
   * Picks `count` distinct entries, preserving deterministic order.
   *
   * @template T
   * @param {readonly T[]} items
   * @param {number} count
   * @returns {T[]}
   */
  sample(items, count) {
    return this.shuffled(items).slice(0, Math.min(count, items.length));
  }
}
