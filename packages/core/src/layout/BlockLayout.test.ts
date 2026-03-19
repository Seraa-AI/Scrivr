import { describe, it, expect, vi, beforeEach } from "vitest";
import { layoutBlock } from "./BlockLayout";
import { TextMeasurer } from "./TextMeasurer";
import { CharacterMap } from "./CharacterMap";
import { defaultFontConfig } from "./FontConfig";
import { schema } from "../model/schema";

const CHAR_WIDTH = 8;
const ASCENT = 12;
const DESCENT = 3;
// lineHeight = (12+3) * 1.2 = 18

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: vi.fn((text: string) => ({
      width: text.length * CHAR_WIDTH,
      actualBoundingBoxAscent: ASCENT,
      actualBoundingBoxDescent: DESCENT,
      fontBoundingBoxAscent: ASCENT,
      fontBoundingBoxDescent: DESCENT,
    })),
    font: "",
  } as unknown as CanvasRenderingContext2D);
});

function measurer() {
  return new TextMeasurer({ lineHeightMultiplier: 1.2 });
}

function paragraph(text: string) {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

function boldParagraph(text: string) {
  return schema.node("paragraph", null, [
    schema.text(text, [schema.marks["bold"]!.create()]),
  ]);
}

function heading(level: number, text: string) {
  return schema.node("heading", { level }, [schema.text(text)]);
}

// ── Basic structure ───────────────────────────────────────────────────────────

describe("layoutBlock — basic", () => {
  it("returns a block positioned at the given x and y", () => {
    const block = layoutBlock(paragraph("Hello"), {
      nodePos: 0, x: 72, y: 100, availableWidth: 400, page: 1, measurer: measurer(),
    });
    expect(block.x).toBe(72);
    expect(block.y).toBe(100);
  });

  it("height equals the sum of line heights", () => {
    const block = layoutBlock(paragraph("Hello"), {
      nodePos: 0, x: 72, y: 0, availableWidth: 400, page: 1, measurer: measurer(),
    });
    // "Hello" fits on one line, lineHeight ≈ 18
    expect(block.height).toBeCloseTo(18);
  });

  it("exports spaceBefore and spaceAfter from FontConfig", () => {
    const block = layoutBlock(paragraph("Hello"), {
      nodePos: 0, x: 72, y: 0, availableWidth: 400, page: 1, measurer: measurer(),
    });
    // defaultFontConfig paragraph: spaceBefore=0, spaceAfter=10
    expect(block.spaceBefore).toBe(0);
    expect(block.spaceAfter).toBe(10);
  });

  it("wraps into multiple lines when text exceeds availableWidth", () => {
    // availableWidth=80, "Hello world" = 88px → 2 lines
    const block = layoutBlock(paragraph("Hello world"), {
      nodePos: 0, x: 72, y: 0, availableWidth: 80, page: 1, measurer: measurer(),
    });
    expect(block.lines.length).toBeGreaterThan(1);
    expect(block.height).toBeCloseTo(18 * block.lines.length);
  });

  it("uses heading font for heading nodes", () => {
    const block = layoutBlock(heading(1, "Title"), {
      nodePos: 0, x: 72, y: 0, availableWidth: 400, page: 1, measurer: measurer(),
    });
    // h1 spaceBefore=24, spaceAfter=12
    expect(block.spaceBefore).toBe(24);
    expect(block.spaceAfter).toBe(12);
    expect(block.blockType).toBe("heading");
  });
});

// ── Empty nodes ───────────────────────────────────────────────────────────────

describe("layoutBlock — empty node", () => {
  it("produces one line for an empty paragraph", () => {
    const block = layoutBlock(paragraph(""), {
      nodePos: 0, x: 72, y: 0, availableWidth: 400, page: 1, measurer: measurer(),
    });
    expect(block.lines).toHaveLength(1);
  });

  it("empty paragraph has non-zero height (cursor must have a home)", () => {
    const block = layoutBlock(paragraph(""), {
      nodePos: 0, x: 72, y: 0, availableWidth: 400, page: 1, measurer: measurer(),
    });
    expect(block.height).toBeGreaterThan(0);
  });

  it("registers a glyph in CharacterMap for empty paragraph", () => {
    const map = new CharacterMap();
    layoutBlock(paragraph(""), {
      nodePos: 0, x: 72, y: 60, availableWidth: 400, page: 1,
      measurer: measurer(), map, lineIndexOffset: 0,
    });
    // Virtual span at nodePos+1 = 1
    const coords = map.coordsAtPos(1);
    expect(coords).not.toBeNull();
  });
});

// ── Mark resolution ───────────────────────────────────────────────────────────

describe("layoutBlock — mark resolution", () => {
  it("bold text is measured with a bold font string", () => {
    const m = measurer();
    const spy = vi.spyOn(m, "measureWidth");

    layoutBlock(boldParagraph("Hello"), {
      nodePos: 0, x: 72, y: 0, availableWidth: 400, page: 1, measurer: m,
    });

    const fontUsed = spy.mock.calls[0]?.[1];
    expect(fontUsed).toContain("bold");
  });
});

// ── CharacterMap population ───────────────────────────────────────────────────

describe("layoutBlock — CharacterMap", () => {
  it("registers one glyph per character", () => {
    const map = new CharacterMap();
    // "Hi" at nodePos=0 → chars at docPos 1 and 2
    layoutBlock(paragraph("Hi"), {
      nodePos: 0, x: 72, y: 60, availableWidth: 400, page: 1,
      measurer: measurer(), map, lineIndexOffset: 0,
    });
    expect(map.glyphsInRange(1, 3)).toHaveLength(2);
  });

  it("glyph x includes the page left margin", () => {
    const map = new CharacterMap();
    layoutBlock(paragraph("Hi"), {
      nodePos: 0, x: 72, y: 60, availableWidth: 400, page: 1,
      measurer: measurer(), map, lineIndexOffset: 0,
    });
    const coords = map.coordsAtPos(1);
    // First char x = page margin (72) + lineOffsetX (0 for left align) + 0
    expect(coords?.x).toBe(72);
  });

  it("centred line glyphs are offset by (availableWidth - lineWidth) / 2", () => {
    const map = new CharacterMap();
    const node = schema.node("paragraph", { align: "center" }, [schema.text("Hi")]);

    const config = {
      ...defaultFontConfig,
      paragraph: { ...defaultFontConfig.paragraph, align: "center" as const },
    };

    layoutBlock(node, {
      nodePos: 0, x: 0, y: 60, availableWidth: 400, page: 1,
      measurer: measurer(), map, lineIndexOffset: 0, fontConfig: config,
    });

    // "Hi" = 2 chars × 8px = 16px. center offset = (400 - 16) / 2 = 192
    const coords = map.coordsAtPos(1);
    expect(coords?.x).toBeCloseTo(192);
  });
});
