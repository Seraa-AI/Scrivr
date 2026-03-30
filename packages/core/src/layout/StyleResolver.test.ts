import { describe, it, expect } from "vitest";
import { resolveFont, substituteFamily, normalizeFont } from "./StyleResolver";
import { schema } from "../model/schema";

// Helper — create a ProseMirror mark by name
function mark(name: string, attrs?: Record<string, unknown>) {
  return schema.marks[name]!.create(attrs);
}

describe("resolveFont — no marks", () => {
  it("returns base font unchanged when no marks", () => {
    expect(resolveFont("14px Georgia", [])).toBe("14px Georgia");
  });

  it("handles bold base font", () => {
    expect(resolveFont("bold 28px Georgia", [])).toBe("bold 28px Georgia");
  });

  it("handles italic base font", () => {
    expect(resolveFont("italic 14px Georgia", [])).toBe("italic 14px Georgia");
  });

  it("handles multi-word font family", () => {
    expect(resolveFont("14px Times New Roman", [])).toBe("14px Times New Roman");
  });
});

describe("resolveFont — bold mark", () => {
  it("adds bold to a normal weight font", () => {
    expect(resolveFont("14px Georgia", [mark("bold")])).toBe("bold 14px Georgia");
  });

  it("bold on already-bold base font stays bold", () => {
    expect(resolveFont("bold 28px Georgia", [mark("bold")])).toBe("bold 28px Georgia");
  });
});

describe("resolveFont — italic mark", () => {
  it("adds italic to a normal style font", () => {
    expect(resolveFont("14px Georgia", [mark("italic")])).toBe("italic 14px Georgia");
  });
});

describe("resolveFont — combined marks", () => {
  it("bold + italic produces canonical order: italic bold size family", () => {
    const result = resolveFont("14px Georgia", [mark("bold"), mark("italic")]);
    expect(result).toBe("italic bold 14px Georgia");
  });

  it("italic + bold (reversed order) produces the same canonical result", () => {
    const result = resolveFont("14px Georgia", [mark("italic"), mark("bold")]);
    expect(result).toBe("italic bold 14px Georgia");
  });

  it("never duplicates bold", () => {
    const result = resolveFont("bold 14px Georgia", [mark("bold"), mark("italic")]);
    expect(result).toBe("italic bold 14px Georgia");
    expect(result.match(/bold/g)).toHaveLength(1);
  });
});

describe("resolveFont — font_size mark", () => {
  it("overrides the base font size", () => {
    expect(resolveFont("14px Georgia", [mark("font_size", { size: 18 })])).toBe("18px Georgia");
  });
});

describe("resolveFont — font_family mark", () => {
  it("overrides the base font family", () => {
    expect(resolveFont("14px Georgia", [mark("font_family", { family: "Arial" })])).toBe("14px Arial");
  });

  it("handles multi-word override family", () => {
    expect(
      resolveFont("14px Georgia", [mark("font_family", { family: "Times New Roman" })])
    ).toBe("14px Times New Roman");
  });
});

describe("substituteFamily", () => {
  it("replaces the family, preserves size", () => {
    expect(substituteFamily("14px Georgia", "Arial")).toBe("14px Arial");
  });

  it("replaces the family, preserves bold weight", () => {
    expect(substituteFamily("bold 28px Georgia, serif", "Inter")).toBe("bold 28px Inter");
  });

  it("replaces the family, preserves italic style", () => {
    expect(substituteFamily("italic 14px Georgia", "Verdana")).toBe("italic 14px Verdana");
  });

  it("replaces the family, preserves bold+italic", () => {
    expect(substituteFamily("italic bold 14px Georgia", "Courier New")).toBe("italic bold 14px Courier New");
  });

  it("handles multi-word family in input", () => {
    expect(substituteFamily("14px Times New Roman", "Arial")).toBe("14px Arial");
  });

  it("handles multi-word family in replacement", () => {
    expect(substituteFamily("14px Georgia", "Times New Roman")).toBe("14px Times New Roman");
  });
});

describe("normalizeFont", () => {
  it("strips bold, keeps size and family", () => {
    expect(normalizeFont("bold 14px Georgia")).toBe("14px Georgia");
  });

  it("strips italic, keeps size and family", () => {
    expect(normalizeFont("italic 14px Georgia")).toBe("14px Georgia");
  });

  it("strips bold+italic", () => {
    expect(normalizeFont("italic bold 28px Georgia, serif")).toBe("28px Georgia, serif");
  });

  it("leaves normal-weight font unchanged", () => {
    expect(normalizeFont("14px Georgia")).toBe("14px Georgia");
  });

  it("preserves font size change (font_size mark scenario)", () => {
    // "bold 32px Georgia" and "32px Georgia" both normalize to "32px Georgia"
    // — they share the same line height, which is what we want
    expect(normalizeFont("bold 32px Georgia")).toBe("32px Georgia");
    expect(normalizeFont("32px Georgia")).toBe("32px Georgia");
  });
});
