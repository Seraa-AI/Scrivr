import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("matches the published vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("agrees with the platform implementation across lengths and scripts", () => {
    const cases = [
      "a",
      "x".repeat(55), // one block short of padding overflow
      "x".repeat(56), // forces a second block
      "x".repeat(64),
      "x".repeat(1000),
      "The liability limit is USD 122789.",
      "клаузула • 条項 • بند",
      "m²  vs  m2",
    ];
    for (const value of cases) {
      expect(sha256Hex(value)).toBe(createHash("sha256").update(value, "utf8").digest("hex"));
    }
  });
});
