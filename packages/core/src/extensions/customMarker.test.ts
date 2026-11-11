/**
 * A node's look belongs to its extension. This one is written only against
 * `@scrivr/core`'s public surface: a task item that indents its text and hangs
 * a checkbox before it, with no engine change.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CharacterMap,
  Extension,
  ExtensionManager,
  StarterKit,
  defaultEditorTheme,
  defaultPageConfig,
  markerAnchorOf,
  paintBlock,
  runPipeline,
  type BlockMarker,
  type LayoutBlock,
  type WrapperLayout,
} from "../index";
import { createMeasurer } from "../test-utils";

const BOX = 12;
const INDENT = 32;
const HANGING = 20;

const checkbox = (checked: boolean): BlockMarker => ({
  painter: "checkbox",
  data: checked,
  hanging: HANGING,
  width: () => BOX,
});

const taskItem: WrapperLayout = {
  enter: (node, outer) => ({ ...outer, checked: node.attrs["checked"] === true }),
  place: (_child, index, scope) => ({
    indent: INDENT,
    ...(index === 0 ? { marker: checkbox(scope["checked"] === true) } : {}),
  }),
};

const TaskList = Extension.create({
  name: "taskList",
  addNodes() {
    return {
      taskList: { group: "block", content: "taskItem+", layout: { kind: "transparent" } },
      taskItem: {
        content: "paragraph+",
        attrs: { checked: { default: false } },
        layout: { kind: "transparent", wrap: taskItem },
      },
    };
  },
  addMarkerPainters() {
    return {
      checkbox: {
        canvas: (ctx, marker) => {
          const top = marker.baseline - BOX;
          if (marker.data === true) ctx.fillRect(marker.x, top, BOX, BOX);
          else ctx.strokeRect(marker.x, top, BOX, BOX);
        },
        pdf: (marker, ctx) => {
          ctx.draw.rect({ x: marker.x, y: marker.baseline - BOX, width: BOX, height: BOX, border: { color: { r: 0, g: 0, b: 0 }, widthPx: 1 } });
        },
      },
    };
  },
});

const manager = new ExtensionManager([StarterKit, TaskList]);

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const task = (checked: boolean, ...content: Json[]): Json => ({ type: "taskItem", attrs: { checked }, content });

function laidOut(content: Json[]): LayoutBlock[] {
  const doc = manager.schema.nodeFromJSON({ type: "doc", content });
  const layout = runPipeline(doc, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() });
  return layout.pages.flatMap((page) => page.blocks);
}

const blockOf = (blocks: LayoutBlock[], text: string): LayoutBlock => {
  const block = blocks.find((b) => b.node.textContent === text);
  if (!block) throw new Error(`no block "${text}"`);
  return block;
};

describe("a wrapper from outside core", () => {
  const blocks = laidOut([{ type: "taskList", content: [task(true, p("done"), p("note")), task(false, p("todo"))] }]);
  const plain = laidOut([p("plain")]);

  it("indents every block it wraps", () => {
    const left = blockOf(plain, "plain").x;
    expect(blocks.map((block) => block.x - left)).toEqual([INDENT, INDENT, INDENT]);
  });

  it("hangs its marker before the first block of each item only", () => {
    const done = blockOf(blocks, "done");
    expect(done.marker).toMatchObject({ painter: "checkbox", data: true, x: done.x - HANGING });
    expect(blockOf(blocks, "note").marker).toBeUndefined();
    expect(blockOf(blocks, "todo").marker).toMatchObject({ painter: "checkbox", data: false });
  });

  it("is painted on the canvas by its extension's painter, on the first line's baseline", () => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const strokeRect = vi.spyOn(ctx, "strokeRect");
    const todo = blockOf(blocks, "todo");
    paintBlock(todo, {
      ctx, pageNumber: 1, lineIndexOffset: 0, dpr: 1, measurer: createMeasurer(), theme: defaultEditorTheme,
      blockRegistry: manager.buildBlockRegistry(),
    }, new CharacterMap());
    const anchor = markerAnchorOf(todo);
    expect(anchor).not.toBeNull();
    expect(strokeRect.mock.calls).toEqual([[anchor?.x, (anchor?.baseline ?? 0) - BOX, BOX, BOX]]);
  });
});
