/**
 * A list in a header or footer is drawn with its numbers and bullets, on the
 * canvas as in the PDF. The band paints its blocks through core's
 * `paintBlock`, which draws a block's list marker with the block.
 */
import { describe, expect, it } from "vitest";
import {
  ExtensionManager,
  ServerEditor,
  StarterKit,
  defaultEditorTheme,
  defaultFontConfig,
  type DocumentLayout,
  type LayoutIterationContext,
  type TextMeasurerLike,
} from "@scrivr/core";
import { drawPageChrome } from "../drawPageChrome";
import { HeaderFooter } from "../HeaderFooter";
import { resolveChrome, isResolvedHeaderFooter } from "../resolveChrome";
import type { HeaderFooterPolicy } from "../types";

const widthOf = (text: string): number => text.length * 7;
const measurer: TextMeasurerLike = {
  measureWidth: widthOf,
  measureRun: (text) => ({ totalWidth: widthOf(text), charPositions: [...text].map((_, i) => i * 7) }),
  getFontMetrics: () => ({ ascent: 8, descent: 2, lineHeight: 12, xHeight: 5 }),
  invalidate: () => {},
};
const pageConfig = { pageWidth: 816, pageHeight: 1056, margins: { top: 96, bottom: 96, left: 96, right: 96 }, pageless: false };

const item = (text: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const policy: HeaderFooterPolicy = {
  enabled: true,
  differentFirstPage: false,
  differentOddEven: false,
  defaultHeader: {
    content: { type: "doc", content: [
      { type: "orderedList", content: [item("Clause")] },
      { type: "bulletList", content: [item("Point")] },
    ] },
  },
};

const flow: DocumentLayout = { pages: [{ pageNumber: 1, blocks: [] }], pageConfig, version: 1, totalContentHeight: 0 };
const iteration: LayoutIterationContext = {
  runId: 1, iteration: 1, maxIterations: 5, previousIterationPayload: null, previousRunPayload: null,
  currentFlowLayout: flow, previousRunFlowLayout: null,
};

/**
 * A stand-in 2D context (plugins run without a DOM canvas) that records what
 * was drawn — text, and the arcs a bullet is made of — and accepts every
 * other call and property.
 */
function recordingContext(drawn: string[]): CanvasRenderingContext2D {
  const recorded = new Set(["fillText", "arc", "fillRect"]);
  const state: Record<string, unknown> = {};
  const isContext = (value: unknown): value is CanvasRenderingContext2D => typeof value === "object" && value !== null;
  const context: unknown = new Proxy(state, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "measureText") return (text: string) => ({ width: widthOf(text) });
      return (...args: unknown[]) => {
        if (recorded.has(key)) drawn.push(`${key}:${String(args[0])}`);
      };
    },
    set(target, key, value) {
      if (typeof key === "string") target[key] = value;
      return true;
    },
  });
  if (!isContext(context)) throw new Error("no context");
  return context;
}

describe("a list in a header", () => {
  it("is drawn with its number and its bullet", () => {
    const { doc } = new ServerEditor({ extensions: [StarterKit, HeaderFooter] }).getState();
    const contribution = resolveChrome(policy, { doc, pageConfig, measurer, fontConfig: defaultFontConfig }, iteration, 0);
    if (!isResolvedHeaderFooter(contribution.payload)) throw new Error("no header layout");
    const resolved = contribution.payload;
    const slot = resolved.slots.defaultHeader;
    if (!slot) throw new Error("no header slot");

    const drawn: string[] = [];
    drawPageChrome({
      ctx: {
        ctx: recordingContext(drawn),
        pageNumber: 1, totalPages: 1, pageConfig, payload: resolved, measurer,
        blockRegistry: new ExtensionManager([StarterKit, HeaderFooter]).buildBlockRegistry(),
        theme: defaultEditorTheme,
        metrics: {
          pageNumber: 1, contentTop: 150, contentBottom: 900, contentHeight: 750, contentWidth: 624,
          headerTop: pageConfig.margins.top, headerHeight: slot.reservedHeight, footerTop: 900, footerHeight: 0,
        },
      },
      resolved, activeSurface: null, activePage: 1,
    });

    expect(drawn).toContain("fillText:1.");
    expect(drawn.filter((call) => call.startsWith("arc:"))).toHaveLength(1);
  });
});
