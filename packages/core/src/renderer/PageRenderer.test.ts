/**
 * PageRenderer tests — anchored objectRect correctness.
 *
 * Regression coverage for the bug where 'behind' floats ended up with 0×0
 * objectRects in the CharacterMap after renderPage.
 *
 * Root cause: drawFloat registers the real rect BEFORE block rendering (for
 * 'behind' mode), but TextBlockStrategy.render then overwrites it with 0×0
 * for the zero-width anchor span. The fix re-stamps all float rects at the
 * very end of renderPage so the final CharacterMap always has real dims.
 */
import { describe, it, expect } from "vitest";
import { renderPage } from "./PageRenderer";
import { CharacterMap } from "../layout/CharacterMap";
import { runPipeline, defaultPageConfig } from "../layout/PageLayout";
import { BlockRegistry, InlineRegistry } from "../layout/BlockRegistry";
import { Schema } from "prosemirror-model";
import { TextBlockStrategy } from "../layout/TextBlockStrategy";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import {
  buildStarterKitContext,
  createMeasurer,
} from "../test-utils";

/**
 * Real canvas context — happy-dom's `getContext("2d")` is wired in
 * `vitest.setup.ts` to return the `@napi-rs/canvas` (Skia) backend.
 * Tests here don't observe ctx calls, so a real ctx is the simplest plumbing.
 */
function makeCtx(): CanvasRenderingContext2D {
  return document.createElement("canvas").getContext("2d")!;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Runs renderPage with TextBlockStrategy registered (reproduces the overwrite bug). */
function renderWithStrategy(
  wrappingMode: string,
  floatWidth = 200,
  floatHeight = 200,
) {
  const { schema, fontConfig } = buildStarterKitContext();
  const img = schema.nodes["image"]!.create({
    src: "https://example.com/img.png",
    width: floatWidth,
    height: floatHeight,
    wrappingMode,
  });
  const para = schema.node("paragraph", null, [
    img,
    schema.text("hello world"),
  ]);
  const doc = schema.node("doc", null, [para]);

  const layout = runPipeline(doc, {
    pageConfig: defaultPageConfig,
    fontConfig,
    measurer: createMeasurer(),
  });

  const page = layout.pages[0]!;
  const floats = layout.anchoredObjects ?? [];
  const map = new CharacterMap();

  // BlockRegistry with TextBlockStrategy — this is what triggers the 0×0 overwrite
  const blockRegistry = new BlockRegistry().register(
    "paragraph",
    TextBlockStrategy,
  );

  renderPage({
    ctx: makeCtx(),
    page,
    pageConfig: defaultPageConfig,
    renderVersion: layout.version,
    currentVersion: () => layout.version,
    dpr: 1,
    measurer: createMeasurer(),
    map,
    blockRegistry,
    anchoredObjects: floats,
  });

  return { map, floats };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renderPage — anchored objectRect correctness", () => {
  it("'behind' anchoredObject: objectRect has real dimensions after renderPage", () => {
    const { map, floats } = renderWithStrategy("behind");
    const float = floats[0]!;
    const rect = map.getObjectRect(float.docPos);

    expect(rect).toBeDefined();
    expect(rect!.width).toBe(float.width);
    expect(rect!.height).toBe(float.height);
    expect(rect!.x).toBe(float.x);
    expect(rect!.y).toBe(float.y);
    expect(rect!.page).toBe(float.page);
  });

  it("'front' anchoredObject: objectRect has real dimensions after renderPage", () => {
    const { map, floats } = renderWithStrategy("front");
    const float = floats[0]!;
    const rect = map.getObjectRect(float.docPos);

    expect(rect).toBeDefined();
    expect(rect!.width).toBe(float.width);
    expect(rect!.height).toBe(float.height);
    expect(rect!.x).toBe(float.x);
    expect(rect!.y).toBe(float.y);
  });

  it("'square-left' anchoredObject: objectRect has real dimensions after renderPage", () => {
    const { map, floats } = renderWithStrategy("square-left");
    const float = floats[0]!;
    const rect = map.getObjectRect(float.docPos);

    expect(rect).toBeDefined();
    expect(rect!.width).toBe(float.width);
    expect(rect!.height).toBe(float.height);
  });

  it("'square-right' anchoredObject: objectRect has real dimensions after renderPage", () => {
    const { map, floats } = renderWithStrategy("square-right");
    const float = floats[0]!;
    const rect = map.getObjectRect(float.docPos);

    expect(rect).toBeDefined();
    expect(rect!.width).toBe(float.width);
    expect(rect!.height).toBe(float.height);
  });

  it("objectRect is not zeroed for 'behind' mode (regression: TextBlockStrategy overwrite)", () => {
    // This specifically guards the regression: before the fix, TextBlockStrategy
    // registered a 0×0 objectRect for the zero-width anchor span, overwriting
    // the real dimensions that drawFloat set for 'behind' floats.
    const { map, floats } = renderWithStrategy("behind", 300, 150);
    const float = floats[0]!;
    const rect = map.getObjectRect(float.docPos);

    // Must not be 0×0
    expect(rect!.width).not.toBe(0);
    expect(rect!.height).not.toBe(0);
    // Must match the actual float dimensions
    expect(rect!.width).toBe(300);
    expect(rect!.height).toBe(150);
  });
});

describe("renderPage — image strategy zero-size guard", () => {
  it("does not throw when image strategy is called with zero width/height", () => {
    // Before the guard was added, the strategy would call ctx.drawImage(img, x, y, 0, 0)
    // for a loaded image, which throws IndexSizeError in Chrome.
    const { schema } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({
      src: "https://example.com/img.png",
      width: 0,
      height: 0,
      wrappingMode: "behind",
    });

    const manager = new ExtensionManager([StarterKit]);
    const inlineRegistry = manager.buildInlineRegistry();

    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [img, schema.text("text")]),
    ]);
    const layout = runPipeline(doc, {
      pageConfig: defaultPageConfig,
      fontConfig: buildStarterKitContext().fontConfig,
      measurer: createMeasurer(),
    });

    // If the guard is missing, this would throw for loaded images.
    // With the guard it's a clean no-op.
    expect(() => {
      const map = new CharacterMap();
      const blockRegistry = new BlockRegistry().register(
        "paragraph",
        TextBlockStrategy,
      );
      renderPage({
        ctx: makeCtx(),
        page: layout.pages[0]!,
        pageConfig: defaultPageConfig,
        renderVersion: layout.version,
        currentVersion: () => layout.version,
        dpr: 1,
        measurer: createMeasurer(),
        map,
        blockRegistry,
        inlineRegistry,
        anchoredObjects: layout.anchoredObjects ?? [],
      });
    }).not.toThrow();
  });
});

/**
 * A paint that abandons itself has to say so.
 *
 * `renderPage` bails when the layout moves under it — the version it was
 * handed is no longer the editor's. That is correct: painting a page from a
 * layout that has already been replaced puts stale pixels on screen. What it
 * cannot do is bail silently, because the caller records the version as
 * painted either way, and a tile that believes it is current will not repaint
 * until something else moves. The user is then looking at content the document
 * no longer contains.
 */
describe("renderPage — reporting whether it painted", () => {
  function render(currentVersion: () => number): { painted: boolean; map: CharacterMap } {
    const { schema, fontConfig } = buildStarterKitContext();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello world")]),
    ]);
    const layout = runPipeline(doc, {
      pageConfig: defaultPageConfig,
      fontConfig,
      measurer: createMeasurer(),
    });
    const map = new CharacterMap();
    const painted = renderPage({
      ctx: makeCtx(),
      page: layout.pages[0]!,
      pageConfig: defaultPageConfig,
      renderVersion: layout.version,
      currentVersion,
      dpr: 1,
      measurer: createMeasurer(),
      map,
      blockRegistry: new BlockRegistry().register("paragraph", TextBlockStrategy),
      anchoredObjects: layout.anchoredObjects ?? [],
    });
    return { painted, map };
  }

  it("reports true when it painted the version it was given", () => {
    const layoutVersion = 1;
    const { painted, map } = render(() => layoutVersion);
    expect(painted).toBe(true);
    // It really did draw: glyphs reached the map.
    expect(map.coordsAtPos(1)).not.toBeNull();
  });

  it("reports false when the layout moved before it started", () => {
    const { painted, map } = render(() => 999);
    expect(painted).toBe(false);
    // Nothing was drawn, so nothing was registered.
    expect(map.coordsAtPos(1)).toBeNull();
  });

});

/**
 * An inline atom that sizes itself from a font must be painted in that font.
 *
 * A header's page-number token carries no marks, so it is measured in the
 * band's base font while the text beside it is often marked smaller. The
 * strategy draws with whatever font the context holds, so unless the renderer
 * restores the one the box was reserved against, a 14px box ends up holding
 * 10px digits — and the slack shows up as a gap before the following text.
 */
describe("the font an inline atom is painted in", () => {
  const badgeSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*" },
      text: { group: "inline" },
      badge: { group: "inline", inline: true, atom: true },
    },
    // The demo's header marks its text 10px and leaves the token unmarked,
    // which is what makes the two fonts differ in the first place.
    marks: { small: {} },
  });

  const fontModifiers = new Map([
    ["small", (font: { size: string }) => { font.size = "10px"; }],
  ]);

  it("is the one its box was measured against, not the previous span's", () => {
    const seen: string[] = [];
    const inlineRegistry = new InlineRegistry();
    inlineRegistry.register("badge", {
      measure: (_node, font, measurer) => ({
        width: measurer.measureRun("8888", font).totalWidth,
        height: 12,
      }),
      render: (ctx) => { seen.push(ctx.font); },
    });

    const para = badgeSchema.node("paragraph", null, [
      badgeSchema.text("before ", [badgeSchema.marks["small"]!.create()]),
      badgeSchema.nodes["badge"]!.create(),
    ]);
    const layout = runPipeline(badgeSchema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      inlineRegistry,
      fontModifiers,
    });

    const span = layout.pages[0]!.blocks
      .flatMap((b) => b.lines)
      .flatMap((l) => l.spans)
      .find((s) => s.kind === "object");
    expect(span?.font).toBeDefined();

    const ctx = makeCtx();
    ctx.font = "10px Arial";
    renderPage({
      ctx,
      page: layout.pages[0]!,
      pageConfig: defaultPageConfig,
      renderVersion: layout.version,
      currentVersion: () => layout.version,
      dpr: 1,
      measurer: createMeasurer(),
      map: new CharacterMap(),
      inlineRegistry,
    });

    expect(seen).toEqual([span!.font]);
  });
});
