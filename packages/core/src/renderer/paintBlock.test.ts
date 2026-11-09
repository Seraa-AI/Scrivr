import { afterEach, describe, expect, it, vi } from "vitest";
import * as painter from "./paintBlock";
import { renderPage } from "./PageRenderer";
import { TileManager } from "./TileManager";
import { CharacterMap } from "../layout/CharacterMap";
import { BlockRegistry } from "../layout/BlockRegistry";
import { defaultPageConfig, defaultPagelessConfig, runPipeline } from "../layout/PageLayout";
import type { LayoutBlock } from "../layout/BlockLayout";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { Table } from "../extensions/built-in/Table";
import { defaultEditorTheme } from "../model/theme";
import { createMeasurer, createTestEditor } from "../test-utils";

/**
 * Every surface paints a block through `paintBlock`, which draws the block's
 * list marker as well as the block. A surface that calls a strategy itself
 * paints the block and silently drops its number.
 */

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const list = (...texts: string[]): Json => ({
  type: "orderedList",
  content: texts.map((text) => ({ type: "listItem", content: [p(text)] })),
});

const manager = new ExtensionManager([StarterKit]);
const canvas = () => {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return ctx;
};
/** Blocks `paintBlock` was handed that carry a list marker. */
const markedBlocksPainted = (spy: { mock: { calls: Array<[LayoutBlock, ...unknown[]]> } }) =>
  spy.mock.calls.map(([block]) => block).filter((block) => block.listMarker !== undefined).map((block) => block.listMarker);

afterEach(() => vi.restoreAllMocks());

describe("painting a block", () => {
  it("draws the marker over the block, so a painter's background cannot hide it", () => {
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [
      { type: "orderedList", attrs: { order: 10 }, content: [{ type: "listItem", content: [p("shaded")] }] },
    ] });
    const layout = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() });
    const block = layout.pages[0]?.blocks.find((b) => b.node.textContent === "shaded");
    if (!block) throw new Error("no block");
    expect(block.listMarker).toBe("10.");

    const ctx = canvas();
    const fillRect = vi.spyOn(ctx, "fillRect");
    const fillText = vi.spyOn(ctx, "fillText");
    // A painter that fills the block's box before its text, as a shaded block does.
    const shaded = new BlockRegistry().register("paragraph", {
      render: (painted, renderCtx) => {
        renderCtx.ctx.fillRect(0, painted.y, 1000, painted.height);
        return renderCtx.lineIndexOffset;
      },
    });
    painter.paintBlock(block, {
      ctx, pageNumber: 1, lineIndexOffset: 0, dpr: 1, measurer: createMeasurer(), theme: defaultEditorTheme,
      blockRegistry: shaded,
    }, new CharacterMap());

    const background = Math.max(...fillRect.mock.invocationCallOrder);
    const numberAt = fillText.mock.calls.findIndex(([text]) => text === "10.");
    expect(numberAt).toBeGreaterThanOrEqual(0);
    expect(fillText.mock.invocationCallOrder[numberAt]).toBeGreaterThan(background);
  });
});

/**
 * Text drawn on any canvas while `paint` runs. Spied on the context's
 * prototype, so it also sees the canvases a surface creates for itself.
 */
function textDrawnWhile(paint: () => void): string[] {
  const fillText = vi.spyOn(Object.getPrototypeOf(canvas()), "fillText");
  paint();
  return fillText.mock.calls.map(([text]) => String(text));
}

describe("every surface draws a list's numbers", () => {
  it("a page", () => {
    const spy = vi.spyOn(painter, "paintBlock");
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [list("one", "two")] });
    const layout = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() });
    const page = layout.pages[0];
    if (!page) throw new Error("no page");
    const drawn = textDrawnWhile(() => renderPage({
      ctx: canvas(), page, pageConfig: defaultPageConfig, renderVersion: layout.version,
      currentVersion: () => layout.version, dpr: 1, measurer: createMeasurer(), map: new CharacterMap(),
      blockRegistry: manager.buildBlockRegistry(),
    }));
    expect(drawn).toEqual(expect.arrayContaining(["1.", "2."]));
    expect(markedBlocksPainted(spy)).toEqual(["1.", "2."]);
  });

  it("a pageless document's tiles", () => {
    const spy = vi.spyOn(painter, "paintBlock");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({
      pageConfig: defaultPagelessConfig,
      content: { type: "doc", content: [list("one", "two")] },
    });
    const tiles = new TileManager(editor, container);
    const drawn = textDrawnWhile(() => tiles.update());
    expect(drawn).toEqual(expect.arrayContaining(["1.", "2."]));
    expect(markedBlocksPainted(spy)).toEqual(expect.arrayContaining(["1.", "2."]));
    tiles.destroy();
    editor.destroy();
    container.remove();
  });

  it("a table cell", () => {
    const withTables = new ExtensionManager([StarterKit, Table]);
    const docNode = withTables.schema.nodeFromJSON({ type: "doc", content: [
      { type: "table", attrs: { grid: [300] }, content: [{ type: "tableRow", content: [
        { type: "tableCell", content: [list("in a cell")] },
      ] }] },
      { type: "paragraph" },
    ] });
    const layout = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: withTables.buildBlockStyles() });
    const page = layout.pages[0];
    if (!page) throw new Error("no page");
    const drawn = textDrawnWhile(() => renderPage({
      ctx: canvas(), page, pageConfig: defaultPageConfig, renderVersion: layout.version,
      currentVersion: () => layout.version, dpr: 1, measurer: createMeasurer(), map: new CharacterMap(),
      blockRegistry: withTables.buildBlockRegistry(),
    }));
    expect(drawn).toEqual(expect.arrayContaining(["1."]));
  });
});
