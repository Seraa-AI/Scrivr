import { describe, expect, it } from "vitest";
import { fnv1aHex, stableStringify } from "./hash";

describe("fnv1aHex", () => {
  it("is deterministic — same input, same hash", () => {
    expect(fnv1aHex("hello world")).toBe(fnv1aHex("hello world"));
  });

  it("always returns 8 hex chars", () => {
    for (const s of ["", "a", "hello world", "x".repeat(1000)]) {
      expect(fnv1aHex(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("differs for different input", () => {
    expect(fnv1aHex("clause A")).not.toBe(fnv1aHex("clause B"));
    // A one-character change flips the hash.
    expect(fnv1aHex("Indemnification")).not.toBe(fnv1aHex("indemnification"));
  });
});

describe("stableStringify", () => {
  it("is independent of object key order", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ x: { p: 1, q: 2 } })).toBe(stableStringify({ x: { q: 2, p: 1 } }));
  });

  it("preserves array order and distinguishes values", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("handles primitives and null", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("hi")).toBe('"hi"');
    expect(stableStringify(42)).toBe("42");
  });
});
