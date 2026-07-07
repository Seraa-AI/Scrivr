import { describe, expect, it } from "vitest";
import { fnv1aHex } from "./hash";

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
