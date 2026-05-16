import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  layoutBlock,
  isHiddenAnchorLine,
  populateCharMap,
  resolveLeafBlockDimensions,
} from "./BlockLayout";
import { TextBlockStrategy } from "./TextBlockStrategy";
import { CharacterMap } from "./CharacterMap";
import type { InlineStrategy } from "./BlockRegistry";
import { InlineRegistry } from "./BlockRegistry";
import { defaultEditorTheme } from "../model/theme";
import { defaultFontConfig, applyPageFont } from "./FontConfig";
import type { FontConfig } from "./FontConfig";
import { schema } from "../model/schema";
import {
  createMeasurer,
  buildStarterKitContext,
  paragraph,
  boldParagraph,
  underlineParagraph,
  strikethroughParagraph,
  mixedParagraph,
  heading,
} from "../test-utils";

/** Sum of every line's measured height — the invariant `block.height` should equal. */
function sumLineHeights(block: { lines: ReadonlyArray<{ lineHeight: number }> }): number {
  return block.lines.reduce((acc, line) => acc + line.lineHeight, 0);
}

// StarterKit schema has the fontFamily attr on paragraph and heading nodes.
const { schema: skSchema } = buildStarterKitContext();

// Helper: paragraph node with a fontFamily attr set
function paragraphWithFamily(text: string, fontFamily: string) {
  return skSchema.node(
    "paragraph",
    { fontFamily },
    text ? [skSchema.text(text)] : [],
  );
}

// Helper: heading node with a fontFamily attr set
function headingWithFamily(level: number, text: string, fontFamily: string) {
  return skSchema.node("heading", { level, fontFamily }, [skSchema.text(text)]);
}

// lineHeight = (12+3) * 1.2 = 18

// ── Basic structure ───────────────────────────────────────────────────────────

describe("layoutBlock — basic", () => {
  it("returns a block positioned at the given x and y", () => {
    const block = layoutBlock(paragraph("Hello"), {
      nodePos: 0,
      x: 72,
      y: 100,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    expect(block.x).toBe(72);
    expect(block.y).toBe(100);
  });

  it("height equals the sum of line heights", () => {
    const block = layoutBlock(paragraph("Hello"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    expect(block.lines).toHaveLength(1);
    expect(block.height).toBeCloseTo(sumLineHeights(block));
  });

  it("exports spaceBefore and spaceAfter from FontConfig", () => {
    const block = layoutBlock(paragraph("Hello"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    // defaultFontConfig paragraph: spaceBefore=0, spaceAfter=10
    expect(block.spaceBefore).toBe(0);
    expect(block.spaceAfter).toBe(10);
  });

  it("wraps into multiple lines when text exceeds availableWidth", () => {
    // Pick an availableWidth that fits "Hello " but not "Hello world",
    // forcing a wrap regardless of exact font widths.
    const measurer = createMeasurer();
    const partial = measurer.measureWidth("Hello ", "16px sans-serif");
    const full = measurer.measureWidth("Hello world", "16px sans-serif");
    const block = layoutBlock(paragraph("Hello world"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: (partial + full) / 2,
      page: 1,
      measurer,
    });
    expect(block.lines.length).toBeGreaterThan(1);
    expect(block.height).toBeCloseTo(sumLineHeights(block));
  });

  it("uses heading font for heading nodes", () => {
    const block = layoutBlock(heading(1, "Title"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
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
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    expect(block.lines).toHaveLength(1);
  });

  it("empty paragraph has non-zero height (cursor must have a home)", () => {
    const block = layoutBlock(paragraph(""), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    expect(block.height).toBeGreaterThan(0);
  });

  it("registers a glyph in CharacterMap for empty paragraph", () => {
    const map = new CharacterMap();
    layoutBlock(paragraph(""), {
      nodePos: 0,
      x: 72,
      y: 60,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      map,
      lineIndexOffset: 0,
    });
    // Virtual span at nodePos+1 = 1
    const coords = map.coordsAtPos(1);
    expect(coords).not.toBeNull();
  });
});

// ── Mark resolution ───────────────────────────────────────────────────────────

describe("layoutBlock — mark resolution", () => {
  it("bold text is measured with a bold font string", () => {
    const m = createMeasurer();
    const spy = vi.spyOn(m, "measureWidth");

    layoutBlock(boldParagraph("Hello"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: m,
    });

    const fontUsed = spy.mock.calls[0]?.[1];
    expect(fontUsed).toContain("bold");
  });
});

// ── Mark propagation ──────────────────────────────────────────────────────────

describe("layoutBlock — mark propagation to LayoutSpan", () => {
  it("underline mark appears on layout spans", () => {
    const block = layoutBlock(underlineParagraph("Hello"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const span = block.lines[0]?.spans[0];
    const textSpan = span?.kind === "text" ? span : undefined;
    expect(textSpan?.marks).toBeDefined();
    expect(textSpan?.marks?.some((m) => m.name === "underline")).toBe(true);
  });

  it("strikethrough mark appears on layout spans", () => {
    const block = layoutBlock(strikethroughParagraph("Hello"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const span = block.lines[0]?.spans[0];
    const textSpan = span?.kind === "text" ? span : undefined;
    expect(textSpan?.marks?.some((m) => m.name === "strikethrough")).toBe(true);
  });

  it("plain text has empty marks array", () => {
    const block = layoutBlock(paragraph("Hello"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const span = block.lines[0]?.spans[0];
    const textSpan = span?.kind === "text" ? span : undefined;
    expect(textSpan?.marks).toHaveLength(0);
  });

  it("mixed paragraph: plain span has no underline, underlined span does", () => {
    const block = layoutBlock(mixedParagraph("Hello ", "World"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    // Two children → two spans on the line
    const spans = block.lines[0]?.spans ?? [];
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const plainSpan = spans.find(
      (s) => s.kind === "text" && s.text === "Hello ",
    );
    const underlinedSpan = spans.find(
      (s) => s.kind === "text" && s.text === "World",
    );
    const plainTextSpan = plainSpan?.kind === "text" ? plainSpan : undefined;
    const underlinedTextSpan =
      underlinedSpan?.kind === "text" ? underlinedSpan : undefined;
    expect(plainTextSpan?.marks?.some((m) => m.name === "underline")).toBe(
      false,
    );
    expect(underlinedTextSpan?.marks?.some((m) => m.name === "underline")).toBe(
      true,
    );
  });

  it("marks survive word-wrap: multi-word underlined text passes marks to all spans", () => {
    // Pick an availableWidth that fits "Hello " but not the full string, so
    // the wrap is forced regardless of exact font widths.
    const measurer = createMeasurer();
    const partial = measurer.measureWidth("Hello ", "16px sans-serif");
    const full = measurer.measureWidth("Hello world", "16px sans-serif");
    const block = layoutBlock(underlineParagraph("Hello world"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: (partial + full) / 2,
      page: 1,
      measurer,
    });
    expect(block.lines.length).toBeGreaterThan(1);
    for (const line of block.lines) {
      for (const span of line.spans) {
        if (span.kind === "text") {
          expect(span.marks?.some((m) => m.name === "underline")).toBe(true);
        }
      }
    }
  });
});

// ── CharacterMap population ───────────────────────────────────────────────────

describe("layoutBlock — CharacterMap", () => {
  it("registers one glyph per character", () => {
    const map = new CharacterMap();
    // "Hi" at nodePos=0 → chars at docPos 1 and 2
    layoutBlock(paragraph("Hi"), {
      nodePos: 0,
      x: 72,
      y: 60,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      map,
      lineIndexOffset: 0,
    });
    expect(map.glyphsInRange(1, 3)).toHaveLength(2);
  });

  it("glyph x includes the page left margin", () => {
    const map = new CharacterMap();
    layoutBlock(paragraph("Hi"), {
      nodePos: 0,
      x: 72,
      y: 60,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      map,
      lineIndexOffset: 0,
    });
    const coords = map.coordsAtPos(1);
    // First char x = page margin (72) + lineOffsetX (0 for left align) + 0
    expect(coords?.x).toBe(72);
  });

  it("centred line glyphs are offset by (availableWidth - lineWidth) / 2", () => {
    const map = new CharacterMap();
    const node = schema.node("paragraph", { align: "center" }, [
      schema.text("Hi"),
    ]);

    const config: FontConfig = {
      ...defaultFontConfig,
      paragraph: {
        font: "14px Georgia, serif",
        spaceBefore: 0,
        spaceAfter: 10,
        align: "center",
      },
    };

    const measurer = createMeasurer();
    const availableWidth = 400;
    layoutBlock(node, {
      nodePos: 0,
      x: 0,
      y: 60,
      availableWidth,
      page: 1,
      measurer,
      map,
      lineIndexOffset: 0,
      fontConfig: config,
    });

    // Center offset = (availableWidth − measured line width) / 2.
    const lineWidth = measurer.measureWidth("Hi", config.paragraph.font);
    const expectedX = (availableWidth - lineWidth) / 2;
    const coords = map.coordsAtPos(1);
    expect(coords?.x).toBeCloseTo(expectedX, 2);
  });
});

// ── Node attr alignment ───────────────────────────────────────────────────────

describe("layoutBlock — node attr alignment", () => {
  it("node align attr overrides FontConfig align", () => {
    // FontConfig says left, node attr says center — node attr wins
    const node = schema.nodes["paragraph"]!.create(
      { align: "center" },
      schema.text("Hi"),
    );
    const block = layoutBlock(node, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    expect(block.align).toBe("center");
  });

  it("falls back to FontConfig align when node has no align attr", () => {
    // list_item paragraph has no align attr — falls back to blockStyle
    const node = schema.nodes["paragraph"]!.create(null, schema.text("Hi"));
    const block = layoutBlock(node, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    // defaultFontConfig paragraph.align is "left"
    expect(block.align).toBe("left");
  });

  it("node align right is respected", () => {
    const node = schema.nodes["paragraph"]!.create(
      { align: "right" },
      schema.text("Hi"),
    );
    const block = layoutBlock(node, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    expect(block.align).toBe("right");
  });

  it("CharacterMap glyph x is offset for center alignment from node attr", () => {
    const map = new CharacterMap();
    const node = schema.nodes["paragraph"]!.create(
      { align: "center" },
      schema.text("Hi"),
    );
    const measurer = createMeasurer();
    const availableWidth = 400;
    layoutBlock(node, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth,
      page: 1,
      measurer,
      map,
    });
    // Default paragraph style font; center offset = (availableWidth − line width) / 2.
    const lineWidth = measurer.measureWidth("Hi", defaultFontConfig.paragraph.font);
    const expectedX = (availableWidth - lineWidth) / 2;
    const coords = map.coordsAtPos(1);
    expect(coords?.x).toBeCloseTo(expectedX, 2);
  });

  it("ignores invalid align attr values and falls back to FontConfig", () => {
    const node = schema.nodes["paragraph"]!.create(
      { align: "garbage" },
      schema.text("Hi"),
    );
    const block = layoutBlock(node, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    expect(block.align).toBe("left");
  });
});

// ── Leaf block nodes ──────────────────────────────────────────────────────────

describe("layoutBlock — leaf blocks (HR and Image)", () => {
  const { schema: fullSchema } = buildStarterKitContext();

  function hr() {
    return fullSchema.nodes["horizontalRule"]!.create();
  }

  function image(height: number | null = 200) {
    return fullSchema.nodes["image"]!.create({
      src: "http://x.com/img.png",
      height,
    });
  }

  const hrFontConfig: FontConfig = {
    ...defaultFontConfig,
    horizontalRule: {
      font: "8px Georgia, serif",
      spaceBefore: 8,
      spaceAfter: 8,
      align: "left",
    },
  };

  it("HR block — lines is always empty (leaf has no inline content)", () => {
    const block = layoutBlock(hr(), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig: hrFontConfig,
    });
    expect(block.lines).toHaveLength(0);
  });

  it("HR block — height is font-size × 1.5 (8px → 12px)", () => {
    const block = layoutBlock(hr(), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig: hrFontConfig,
    });
    expect(block.height).toBe(12); // Math.round(8 * 1.5)
  });

  it("HR block — spaceBefore and spaceAfter come from block style", () => {
    const block = layoutBlock(hr(), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig: hrFontConfig,
    });
    expect(block.spaceBefore).toBe(8);
    expect(block.spaceAfter).toBe(8);
  });

  it("HR block — registers one hit-test line in CharacterMap", () => {
    const map = new CharacterMap();
    layoutBlock(hr(), {
      nodePos: 0,
      x: 72,
      y: 50,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig: hrFontConfig,
      map,
      lineIndexOffset: 0,
    });
    expect(map.hasLine(1, 0)).toBe(true);
  });

  it("HR block — click on left half resolves to position BEFORE the block", () => {
    // nodePos=10, nodeSize=1 (leaf) → beforePos=10, afterPos=11
    // availableWidth=400 → halfWidth=200; left glyph x=72..272, right x=272..472
    const map = new CharacterMap();
    layoutBlock(hr(), {
      nodePos: 10,
      x: 72,
      y: 50,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig: hrFontConfig,
      map,
      lineIndexOffset: 0,
    });
    // Click left quarter (x=72+50=122, midpoint of left glyph=72+100=172 → 122<=172 → before)
    const pos = map.posAtCoords(72 + 50, 55, 1);
    expect(pos).toBe(10);
  });

  it("HR block — click on right half resolves to position AFTER the block", () => {
    // nodePos=10, nodeSize=1 (leaf) → afterPos=11
    const map = new CharacterMap();
    layoutBlock(hr(), {
      nodePos: 10,
      x: 72,
      y: 50,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig: hrFontConfig,
      map,
      lineIndexOffset: 0,
    });
    // Click right side (x=72+350=422, past midpoint of right glyph=72+300=372 → endDocPos=11)
    const pos = map.posAtCoords(72 + 350, 55, 1);
    expect(pos).toBe(11);
  });

  it("Image block — height comes from node height attr (200)", () => {
    const block = layoutBlock(image(200), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    expect(block.height).toBe(200);
  });

  it("Image block — explicit height attr always wins over font-size fallback", () => {
    const configWithSmallFont: FontConfig = {
      ...defaultFontConfig,
      image: {
        font: "16px sans-serif",
        spaceBefore: 8,
        spaceAfter: 8,
        align: "left",
      },
    };
    const block = layoutBlock(image(300), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig: configWithSmallFont,
    });
    // Should use the attr (300), not font-size × 1.5 (24)
    expect(block.height).toBe(300);
  });

  it("Image block — no fontConfig falls back to IMAGE_DEFAULT_HEIGHT (200)", () => {
    // Image created without height attr uses schema default 200
    const block = layoutBlock(image(200), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      // fontConfig intentionally omitted
    });
    expect(block.height).toBe(200);
  });
});

// ── resolveLeafBlockDimensions (unit) ─────────────────────────────────────────

describe("resolveLeafBlockDimensions", () => {
  const { schema: fullSchema } = buildStarterKitContext();
  const IMAGE_DEFAULT = 200;
  const IMAGE_SPACE = 8;

  it("uses node height attr when positive — ignores font", () => {
    const node = fullSchema.nodes["image"]!.create({ height: 350 });
    const cfg: FontConfig = {
      image: {
        font: "16px sans-serif",
        spaceBefore: 4,
        spaceAfter: 4,
        align: "left",
      },
    };
    const { height } = resolveLeafBlockDimensions(
      node,
      cfg,
      IMAGE_DEFAULT,
      IMAGE_SPACE,
    );
    expect(height).toBe(350);
  });

  it("falls through to font size when height attr is absent", () => {
    const node = fullSchema.nodes["horizontalRule"]!.create();
    const cfg: FontConfig = {
      horizontalRule: {
        font: "8px Georgia, serif",
        spaceBefore: 8,
        spaceAfter: 8,
        align: "left",
      },
    };
    const { height } = resolveLeafBlockDimensions(
      node,
      cfg,
      IMAGE_DEFAULT,
      IMAGE_SPACE,
    );
    expect(height).toBe(12); // Math.round(8 * 1.5)
  });

  it("uses IMAGE_DEFAULT_HEIGHT when fontConfig is undefined", () => {
    const node = fullSchema.nodes["horizontalRule"]!.create();
    const { height } = resolveLeafBlockDimensions(
      node,
      undefined,
      IMAGE_DEFAULT,
      IMAGE_SPACE,
    );
    expect(height).toBe(IMAGE_DEFAULT);
  });

  it("spaceBefore and spaceAfter come from block style when available", () => {
    const node = fullSchema.nodes["horizontalRule"]!.create();
    const cfg: FontConfig = {
      horizontalRule: {
        font: "8px Georgia, serif",
        spaceBefore: 12,
        spaceAfter: 6,
        align: "left",
      },
    };
    const { spaceBefore, spaceAfter } = resolveLeafBlockDimensions(
      node,
      cfg,
      IMAGE_DEFAULT,
      IMAGE_SPACE,
    );
    expect(spaceBefore).toBe(12);
    expect(spaceAfter).toBe(6);
  });

  it("spaceBefore and spaceAfter fall back to IMAGE_SPACE when no fontConfig", () => {
    const node = fullSchema.nodes["horizontalRule"]!.create();
    const { spaceBefore, spaceAfter } = resolveLeafBlockDimensions(
      node,
      undefined,
      IMAGE_DEFAULT,
      IMAGE_SPACE,
    );
    expect(spaceBefore).toBe(IMAGE_SPACE);
    expect(spaceAfter).toBe(IMAGE_SPACE);
  });
});

// ── End-of-line caret sentinel ─────────────────────────────────────────────────
//
// Without the sentinel, coordsAtPos(endDocPos) falls back to a
// reversed-registration-order search that can return a glyph from the wrong
// page when multiple pages are registered in non-docPos order (cursor page is
// always registered first). The sentinel provides an exact-match glyph so the
// fallback is never reached.

describe("layoutBlock — end-of-line caret sentinel (via layoutBlock map)", () => {
  it("registers sentinel glyph at docPos just past the last character", () => {
    const map = new CharacterMap();
    // "Hi" at nodePos=0 → chars at docPos 1,2 → sentinel at 3
    layoutBlock(paragraph("Hi"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      map,
      lineIndexOffset: 0,
    });
    expect(map.hasGlyph(3)).toBe(true);
  });

  it("sentinel x equals right edge of last character", () => {
    const map = new CharacterMap();
    const measurer = createMeasurer();
    layoutBlock(paragraph("Hi"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer,
      map,
      lineIndexOffset: 0,
    });
    // 'i' is at docPos 2, sentinel at docPos 3. The sentinel sits at the
    // right edge of 'i' — its x equals the glyph's x plus the glyph's width.
    const iCoords = map.coordsAtPos(2);
    const iGlyph = map.glyphsInRange(2, 3)[0];
    const sentCoords = map.coordsAtPos(3);
    expect(sentCoords?.x).toBeCloseTo(iCoords!.x + (iGlyph?.width ?? 0), 2);
  });

  it("sentinel width is 0 (it has no visual extent)", () => {
    const map = new CharacterMap();
    layoutBlock(paragraph("Hi"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      map,
      lineIndexOffset: 0,
    });
    // Access internal glyphs to verify width=0
    const glyphs = map.glyphsInRange(3, 4);
    expect(glyphs[0]?.width).toBe(0);
  });

  it("does NOT register a sentinel for an empty paragraph (ZWS)", () => {
    const map = new CharacterMap();
    layoutBlock(paragraph(""), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      map,
      lineIndexOffset: 0,
    });
    // ZWS at docPos 1 is registered; docPos 2 (past closing token) must NOT be
    expect(map.hasGlyph(1)).toBe(true);
    expect(map.hasGlyph(2)).toBe(false);
  });

  it("sentinel is only on the last line — intermediate lines are not corrupted", () => {
    const map = new CharacterMap();
    // "Hello world" wraps to 2 lines at width=80 (11 chars × 8px = 88 > 80)
    layoutBlock(paragraph("Hello world"), {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 80,
      page: 1,
      measurer: createMeasurer(),
      map,
      lineIndexOffset: 0,
    });
    // The first glyph of line 2 ('w' at docPos 7 if "Hello " is line 1)
    // must be reachable via exact match — no sentinel at that position.
    // Total glyphs = 11 chars + 1 sentinel (last line only), not 13.
    const allGlyphs = map.glyphsInRange(0, 20);
    expect(allGlyphs).toHaveLength(12); // 11 chars + 1 sentinel on last line
  });
});

describe("populateCharMap — end-of-line caret sentinel", () => {
  it("registers sentinel glyph at docPos past the last character", () => {
    const block = layoutBlock(paragraph("Hi"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const map = new CharacterMap();
    populateCharMap(block, map, 1, 0, createMeasurer());
    // "Hi" → chars at docPos 1,2 → sentinel at 3
    expect(map.hasGlyph(3)).toBe(true);
  });

  it("sentinel glyph is on the correct page", () => {
    const block = layoutBlock(paragraph("Hi"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const map = new CharacterMap();
    populateCharMap(block, map, 3, 0, createMeasurer()); // page 3
    expect(map.coordsAtPos(3)?.page).toBe(3);
  });

  it("coordsAtPos(endDocPos) returns the sentinel page even when another page's glyphs were registered first", () => {
    // Simulate the scroll-to-top bug scenario:
    // page 3 (cursor page) is registered first; page 1 is registered second.
    // Without sentinel, coordsAtPos(endDocPos_on_page1) would reverse-search
    // and find a page-3 glyph (higher docPos, registered earlier → appears
    // later in the reversed array), returning the wrong page.
    // With sentinel, the exact-match path returns page 1 correctly.
    const blockP3 = layoutBlock(paragraph("Page three text"), {
      nodePos: 20,
      x: 72,
      y: 200,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const blockP1 = layoutBlock(paragraph("Hi"), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const map = new CharacterMap();

    // Register page-3 block first (higher docPos) — mimics ensurePagePopulated(cursorPage)
    populateCharMap(blockP3, map, 3, 0, createMeasurer());
    // Then register page-1 block (lower docPos) — mimics ensurePagePopulated(cursorPage-2)
    populateCharMap(blockP1, map, 1, 0, createMeasurer());

    // docPos 3 = sentinel after "Hi" on page 1
    const coords = map.coordsAtPos(3);
    expect(coords?.page).toBe(1);
  });

  it("does NOT register sentinel for empty paragraph (ZWS only line)", () => {
    const block = layoutBlock(paragraph(""), {
      nodePos: 0,
      x: 72,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const map = new CharacterMap();
    populateCharMap(block, map, 1, 0, createMeasurer());
    expect(map.hasGlyph(1)).toBe(true); // ZWS cursor position
    expect(map.hasGlyph(2)).toBe(false); // nothing past closing token
  });

  it("sentinel is only on the last line of a wrapped paragraph", () => {
    // Pick an availableWidth that fits "Hello " but not the full string,
    // forcing a wrap regardless of exact font widths.
    const measurer = createMeasurer();
    const partial = measurer.measureWidth("Hello ", "16px sans-serif");
    const full = measurer.measureWidth("Hello world", "16px sans-serif");
    const block = layoutBlock(paragraph("Hello world"), {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: (partial + full) / 2,
      page: 1,
      measurer,
    });
    expect(block.lines).toHaveLength(2);
    const map = new CharacterMap();
    populateCharMap(block, map, 1, 0, createMeasurer());
    // 11 chars + 1 sentinel on the last line only = 12 total glyphs.
    expect(map.glyphsInRange(0, 20)).toHaveLength(12);
  });
});

// ── node.attrs.fontFamily override ────────────────────────────────────────────

describe("layoutBlock — node fontFamily attr", () => {
  it("span font uses the node fontFamily instead of the block style family", () => {
    const block = layoutBlock(paragraphWithFamily("Hello", "Arial"), {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const span = block.lines[0]?.spans[0];
    const font = span?.kind === "text" ? span.font : undefined;
    // The span font should contain "Arial", not "Georgia"
    expect(font).toContain("Arial");
    expect(font).not.toContain("Georgia");
  });

  it("preserves the block style size when substituting the family", () => {
    const block = layoutBlock(paragraphWithFamily("Hello", "Arial"), {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const span = block.lines[0]?.spans[0];
    const font = span?.kind === "text" ? span.font : undefined;
    // Paragraph base size is 14px — must be preserved after family substitution
    expect(font).toContain("14px");
  });

  it("preserves heading size and weight when substituting the family", () => {
    const block = layoutBlock(headingWithFamily(1, "Title", "Inter"), {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
    });
    const span = block.lines[0]?.spans[0];
    const font = span?.kind === "text" ? span.font : "";
    expect(font).toContain("Inter");
    expect(font).toContain("28px");
    expect(font).toContain("bold");
  });

  it("null fontFamily attr uses whatever family is in the fontConfig", () => {
    // layoutBlock is called by the pipeline after applyPageFont has injected
    // the document family. Test that passing a config with a family works.
    const fontConfig = applyPageFont(defaultFontConfig, "Arial, sans-serif");
    const block = layoutBlock(paragraph("Hello"), {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    const span = block.lines[0]?.spans[0];
    const font = span?.kind === "text" ? span.font : undefined;
    expect(font).toContain("Arial");
  });

  it("node fontFamily overrides the fontConfig family", () => {
    const customConfig: FontConfig = {
      paragraph: {
        font: "14px Verdana",
        spaceBefore: 0,
        spaceAfter: 10,
        align: "left",
      },
    };
    const block = layoutBlock(paragraphWithFamily("Hello", "Courier New"), {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig: customConfig,
    });
    const span = block.lines[0]?.spans[0];
    const font = span?.kind === "text" ? span.font : undefined;
    expect(font).toContain("Courier New");
    expect(font).not.toContain("Verdana");
  });
});

// ── Inline node handling — regression suite ───────────────────────────────────
//
// These tests lock in the correct behaviour for hardBreak (Shift-Enter) and
// inline images inside paragraphs.

describe("extractSpans — inline node handling", () => {
  const { schema: skSchema, fontConfig } = buildStarterKitContext();

  // ── hardBreak: Shift-Enter creates two lines ─────────────────────────────

  it("hardBreak inside a paragraph splits into two lines", () => {
    const hb = skSchema.nodes["hardBreak"]?.create();
    if (!hb) return;
    const para = skSchema.node("paragraph", null, [
      skSchema.text("Hello"),
      hb,
      skSchema.text("World"),
    ]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    expect(block.lines).toHaveLength(2);
    // Line 0: "Hello" text only, terminated by break
    const line0Spans = block.lines[0]!.spans;
    expect(line0Spans.every((s) => s.kind === "text")).toBe(true);
    expect(block.lines[0]!.terminalBreakDocPos).toBeDefined();
    // Line 1: "World" text only
    const line1Spans = block.lines[1]!.spans;
    expect(line1Spans.every((s) => s.kind === "text")).toBe(true);
  });

  it("hardBreak does NOT inflate line height — both lines stay at text line height", () => {
    const hb = skSchema.nodes["hardBreak"]?.create();
    if (!hb) return;
    // Control: a single-line paragraph with the same text content but no break.
    const control = layoutBlock(
      skSchema.node("paragraph", null, [skSchema.text("A")]),
      {
        nodePos: 0,
        x: 0,
        y: 0,
        availableWidth: 400,
        page: 1,
        measurer: createMeasurer(),
        fontConfig,
      },
    );
    const baselineLineHeight = control.lines[0]!.lineHeight;

    const para = skSchema.node("paragraph", null, [
      skSchema.text("A"),
      hb,
      skSchema.text("B"),
    ]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    expect(block.lines).toHaveLength(2);
    for (const line of block.lines) {
      expect(line.lineHeight).toBeCloseTo(baselineLineHeight);
    }
  });

  it("paragraph containing only a hardBreak falls back to ZWS — normal line height", () => {
    // Control: empty paragraph (also uses the ZWS fallback). The hardBreak-only
    // paragraph must produce the same line height — no inflation.
    const empty = layoutBlock(
      skSchema.node("paragraph", null, []),
      {
        nodePos: 0,
        x: 0,
        y: 0,
        availableWidth: 400,
        page: 1,
        measurer: createMeasurer(),
        fontConfig,
      },
    );
    const baseline = empty.lines[0]!.lineHeight;

    const hb = skSchema.nodes["hardBreak"]?.create();
    if (!hb) return;
    const para = skSchema.node("paragraph", null, [hb]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]?.lineHeight).toBeCloseTo(baseline);
    const spans = block.lines[0]?.spans ?? [];
    expect(spans.every((s) => s.kind === "text")).toBe(true);
  });

  it("trailing hardBreak emits a phantom second line for the cursor after the break", () => {
    const hb = skSchema.nodes["hardBreak"]?.create();
    if (!hb) return;
    const para = skSchema.node("paragraph", null, [skSchema.text("Hello"), hb]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    expect(block.lines).toHaveLength(2);
    // Line 0 ends with the break; line 1 is the phantom ZWS cursor line and
    // must keep the same height as the text line above it (no inflation).
    expect(block.lines[0]!.terminalBreakDocPos).toBeDefined();
    expect(block.lines[1]!.spans).toHaveLength(1);
    expect(block.lines[1]!.lineHeight).toBeCloseTo(block.lines[0]!.lineHeight);
  });

  // ── inline image IS an object span ───────────────────────────────────────

  it("inline image with width+height attrs produces exactly one object span", () => {
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 100,
      height: 80,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [
      skSchema.text("Before"),
      img,
      skSchema.text("After"),
    ]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 600,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    const allSpans = block.lines.flatMap((l) => l.spans);
    const objectSpans = allSpans.filter((s) => s.kind === "object");
    expect(objectSpans).toHaveLength(1);
  });

  it("line containing an inline image is as tall as the image when it exceeds text height", () => {
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 200,
      height: 150,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [img]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    expect(block.lines[0]?.lineHeight).toBe(150);
    expect(block.height).toBe(150);
  });

  it("line height is max(text, image) — small image alongside text keeps text height", () => {
    // Image (8px) is shorter than text — line height must not shrink below
    // the text-only baseline. Control: same paragraph without the image.
    const control = layoutBlock(
      skSchema.node("paragraph", null, [skSchema.text("Hi")]),
      {
        nodePos: 0,
        x: 0,
        y: 0,
        availableWidth: 400,
        page: 1,
        measurer: createMeasurer(),
        fontConfig,
      },
    );
    const textOnlyHeight = control.lines[0]!.lineHeight;

    const img = skSchema.nodes["image"]?.create({
      src: "i.png",
      width: 8,
      height: 8,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [skSchema.text("Hi"), img]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    expect(block.lines[0]?.lineHeight).toBeGreaterThanOrEqual(textOnlyHeight);
  });

  it("inline image registers a glyph in the CharacterMap at its docPos", () => {
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 50,
      height: 50,
    });
    if (!img) return;
    // doc structure: doc(para(text"Hi", img)) — image is at docPos 4
    // nodePos=0 → para opens at 0, text "Hi" at 1,2, img at 3
    const para = skSchema.node("paragraph", null, [skSchema.text("Hi"), img]);
    const map = new CharacterMap();
    layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
      map,
    });
    // "Hi" → docPos 1,2; image → docPos 3; sentinel → docPos 4
    expect(map.hasGlyph(3)).toBe(true); // the image glyph
    expect(map.hasGlyph(4)).toBe(true); // sentinel past the image
  });
});

// ── Phase 3: anchored-image sentinel does not inflate paragraph height ───────

describe("layoutBlock — anchored image sentinel (Phase 3)", () => {
  const { schema: skSchema, fontConfig } = buildStarterKitContext();

  it("paragraph with only a non-inline image is an invisible zero-height anchor flow", () => {
    const img = skSchema.nodes["image"]!.create({
      src: "a.png",
      width: 200,
      height: 200,
      wrapMode: "square",
    });
    const para = skSchema.node("paragraph", null, [img]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    // The zero-size object sentinel remains, but the paragraph does not
    // create a visible blank line behind the floating image.
    expect(block.lines).toHaveLength(1);
    expect(isHiddenAnchorLine(block.lines[0]!)).toBe(true);
    expect(block.lines[0]!.lineHeight).toBe(0);
    expect(block.lines[0]!.cursorHeight).toBe(0);
    expect(block.height).toBe(0);
    expect(block.spaceBefore).toBe(0);
    expect(block.spaceAfter).toBe(0);
  });

  it("anchor-only paragraph does not register cursor glyphs", () => {
    const map = new CharacterMap();
    const img = skSchema.nodes["image"]!.create({
      src: "a.png",
      width: 200,
      height: 200,
      wrapMode: "square",
    });
    const para = skSchema.node("paragraph", null, [img]);

    layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
      map,
      lineIndexOffset: 0,
    });

    expect(map.coordsAtPos(1)).toBeNull();
    expect(map.coordsAtPos(2)).toBeNull();
  });

  it("anchor-only paragraph stays zero-height even when it overlaps its own exclusion zone", () => {
    const img = skSchema.nodes["image"]!.create({
      src: "a.png",
      width: 200,
      height: 200,
      wrapMode: "top-bottom",
    });
    const para = skSchema.node("paragraph", null, [img]);

    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 40,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
      lineSpaceProvider: () => ({ segments: [], skipToY: 260 }),
    });

    expect(block.lines).toHaveLength(1);
    expect(isHiddenAnchorLine(block.lines[0]!)).toBe(true);
    expect(block.height).toBe(0);
    expect(block.spaceBefore).toBe(0);
    expect(block.spaceAfter).toBe(0);
  });

  it("anchored-image sentinel is preserved on the line so getAnchoredObjectAnchors finds it", () => {
    const img = skSchema.nodes["image"]!.create({
      src: "a.png",
      width: 200,
      height: 200,
      wrapMode: "square",
    });
    const para = skSchema.node("paragraph", null, [img]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    const allSpans = block.lines.flatMap((l) => l.spans);
    const sentinel = allSpans.find(
      (s) => s.kind === "object" && s.width === 0 && s.height === 0,
    );
    expect(sentinel).toBeDefined();
  });

  it("text + non-inline image: line height is text height (image contributes nothing)", () => {
    // Control: same paragraph without the anchored image — line height
    // matches text. The non-inline image must not inflate it.
    const control = layoutBlock(
      skSchema.node("paragraph", null, [
        skSchema.text("text alongside an anchored image"),
      ]),
      {
        nodePos: 0,
        x: 0,
        y: 0,
        availableWidth: 600,
        page: 1,
        measurer: createMeasurer(),
        fontConfig,
      },
    );
    const textOnlyHeight = control.lines[0]!.lineHeight;

    const img = skSchema.nodes["image"]!.create({
      src: "a.png",
      width: 200,
      height: 200,
      wrapMode: "square",
    });
    const para = skSchema.node("paragraph", null, [
      img,
      skSchema.text("text alongside an anchored image"),
    ]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 600,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    expect(block.lines[0]!.lineHeight).toBeCloseTo(textOnlyHeight);
    expect(block.lines[0]!.lineHeight).toBeLessThan(200);
  });

  it("inline image (wrapMode:inline) still inflates line height as before — Phase 3 only changes non-inline", () => {
    const img = skSchema.nodes["image"]!.create({
      src: "a.png",
      width: 200,
      height: 150,
      wrapMode: "inline",
    });
    const para = skSchema.node("paragraph", null, [img]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });
    expect(block.lines[0]!.lineHeight).toBe(150);
  });
});

// ── TextBlockStrategy — inline object rendering ───────────────────────────────
//
// Verifies that TextBlockStrategy correctly dispatches object spans to the
// InlineRegistry. This is the rendering path that was silently broken when
// StarterKit collected layoutHandlers (now empty on Image) instead of
// inlineHandlers — images appeared as blank cursors.

describe("TextBlockStrategy — inline image rendering", () => {
  const { schema: skSchema, fontConfig } = buildStarterKitContext();

  function makeMockCtx(): CanvasRenderingContext2D {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      measureText: vi.fn(() => ({ width: 8 })),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "alphabetic",
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  }

  it("calls InlineStrategy.render() for each inline image span", () => {
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 80,
      height: 60,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [skSchema.text("Hi"), img]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });

    const renderFn = vi.fn();
    const inlineStrategy: InlineStrategy = { render: renderFn };
    const inlineRegistry = new InlineRegistry();
    inlineRegistry.register("image", inlineStrategy);

    const ctx = makeMockCtx();
    TextBlockStrategy.render(
      block,
      {
        ctx,
        pageNumber: 1,
        lineIndexOffset: 0,
        dpr: 1,
        measurer: createMeasurer(),
        theme: defaultEditorTheme,
        inlineRegistry,
      },
      new CharacterMap(),
    );

    expect(renderFn).toHaveBeenCalledOnce();
    // Verify it was called with the correct node
    const [, , , w, h, node] = renderFn.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      number,
      number,
      unknown,
    ];
    expect(w).toBe(80);
    expect(h).toBe(60);
  });

  it("does NOT call InlineStrategy.render() when inlineRegistry is absent", () => {
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 80,
      height: 60,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [img]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });

    const ctx = makeMockCtx();
    // No inlineRegistry — should not throw, just silently skip drawing
    expect(() => {
      TextBlockStrategy.render(
        block,
        {
          ctx,
          pageNumber: 1,
          lineIndexOffset: 0,
          dpr: 1,
          measurer: createMeasurer(),
          theme: defaultEditorTheme,
        },
        new CharacterMap(),
      );
    }).not.toThrow();
  });

  it("still renders surrounding text when paragraph contains a mix of text and image", () => {
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 50,
      height: 50,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [
      skSchema.text("Hello"),
      img,
      skSchema.text("World"),
    ]);
    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 600,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
    });

    const renderFn = vi.fn();
    const inlineRegistry = new InlineRegistry();
    inlineRegistry.register("image", { render: renderFn });

    const ctx = makeMockCtx();
    TextBlockStrategy.render(
      block,
      {
        ctx,
        pageNumber: 1,
        lineIndexOffset: 0,
        dpr: 1,
        measurer: createMeasurer(),
        theme: defaultEditorTheme,
        inlineRegistry,
      },
      new CharacterMap(),
    );

    // Text was drawn (fillText called for "Hello" and "World" chars)
    expect(ctx.fillText).toHaveBeenCalled();
    // Image strategy was also called
    expect(renderFn).toHaveBeenCalledOnce();
  });

  it("InlineStrategy.measure() overrides node width/height attrs during layout", () => {
    // Create an inline image node with small placeholder dimensions
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 10,
      height: 10,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [skSchema.text("Hi"), img]);

    // Strategy with measure() that returns larger dimensions
    const measureFn = vi.fn(() => ({ width: 50, height: 30 }));
    const renderFn = vi.fn();
    const strategy: InlineStrategy = { measure: measureFn, render: renderFn };
    const inlineRegistry = new InlineRegistry();
    inlineRegistry.register("image", strategy);

    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
      inlineRegistry,
    });

    // measure() should have been called during layout
    expect(measureFn).toHaveBeenCalledOnce();

    // The object span should use the measured dimensions, not the attr values
    const objectSpans = block.lines.flatMap((l) => l.spans).filter((s) => s.kind === "object");
    expect(objectSpans).toHaveLength(1);
    expect(objectSpans[0]!.width).toBe(50);
    expect(objectSpans[0]!.height).toBe(30);
  });

  it("falls back to node attrs when InlineStrategy has no measure()", () => {
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 100,
      height: 80,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [img]);

    // Strategy WITHOUT measure()
    const strategy: InlineStrategy = { render: vi.fn() };
    const inlineRegistry = new InlineRegistry();
    inlineRegistry.register("image", strategy);

    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
      inlineRegistry,
    });

    const objectSpans = block.lines.flatMap((l) => l.spans).filter((s) => s.kind === "object");
    expect(objectSpans).toHaveLength(1);
    expect(objectSpans[0]!.width).toBe(100);
    expect(objectSpans[0]!.height).toBe(80);
  });

  it("falls back to node attrs when no inlineRegistry is provided", () => {
    const img = skSchema.nodes["image"]?.create({
      src: "a.png",
      width: 100,
      height: 80,
    });
    if (!img) return;
    const para = skSchema.node("paragraph", null, [img]);

    const block = layoutBlock(para, {
      nodePos: 0,
      x: 0,
      y: 0,
      availableWidth: 400,
      page: 1,
      measurer: createMeasurer(),
      fontConfig,
      // no inlineRegistry
    });

    const objectSpans = block.lines.flatMap((l) => l.spans).filter((s) => s.kind === "object");
    expect(objectSpans).toHaveLength(1);
    expect(objectSpans[0]!.width).toBe(100);
    expect(objectSpans[0]!.height).toBe(80);
  });
});
