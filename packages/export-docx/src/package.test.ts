import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { zipDocxPackage } from "./package";

describe("zipDocxPackage", () => {
  it("round-trips string + binary parts", () => {
    const bytes = zipDocxPackage({
      parts: [
        { path: "[Content_Types].xml", data: "<types/>" },
        { path: "word/document.xml", data: "<doc/>" },
        { path: "word/media/image1.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      ],
    });

    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual([
      "[Content_Types].xml",
      "word/document.xml",
      "word/media/image1.png",
    ]);
    expect(strFromU8(entries["[Content_Types].xml"]!)).toBe("<types/>");
    expect(strFromU8(entries["word/document.xml"]!)).toBe("<doc/>");
    expect(Array.from(entries["word/media/image1.png"]!)).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
  });

  it("produces deterministic bytes for the same input", () => {
    const parts = {
      parts: [
        { path: "[Content_Types].xml", data: "<types/>" },
        { path: "word/document.xml", data: "<doc/>" },
      ],
    };
    // fflate does not embed a timestamp by default with `mtime: 0`, so two
    // calls with the same input should produce identical bytes — important
    // for content-addressable storage and golden tests.
    const a = zipDocxPackage(parts);
    const b = zipDocxPackage(parts);
    expect(a).toEqual(b);
  });

  it("returns a Uint8Array", () => {
    const out = zipDocxPackage({ parts: [{ path: "x", data: "y" }] });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it("starts with the ZIP local file header signature (PK\\x03\\x04)", () => {
    const out = zipDocxPackage({ parts: [{ path: "x.xml", data: "<x/>" }] });
    expect(out[0]).toBe(0x50);
    expect(out[1]).toBe(0x4b);
    expect(out[2]).toBe(0x03);
    expect(out[3]).toBe(0x04);
  });
});
