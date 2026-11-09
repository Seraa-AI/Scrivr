/**
 * A header or footer is styled by the editor's block styles, as the body is:
 * a heading in a header is measured and painted in the heading's font, which
 * `Heading` registers. The band only drops a paragraph's spacing.
 */
import { describe, expect, it } from "vitest";
import {
  ExtensionManager,
  ServerEditor,
  StarterKit,
  defaultEditorTheme,
  type DocumentLayout,
  type LayoutIterationContext,
  type TextMeasurerLike,
} from "@scrivr/core";
import { drawPageChrome } from "../drawPageChrome";
import { HeaderFooter } from "../HeaderFooter";
import { resolveChrome, isResolvedHeaderFooter } from "../resolveChrome";
import { HeaderFooterSurfaceCache } from "../surfaces";
import type { HeaderFooterPolicy } from "../types";

const widthOf = (text: string): number => text.length * 7;
const measurer: TextMeasurerLike = {
  measureWidth: widthOf,
  measureRun: (text) => ({ totalWidth: widthOf(text), charPositions: [...text].map((_, i) => i * 7) }),
  getFontMetrics: () => ({ ascent: 8, descent: 2, lineHeight: 12, xHeight: 5 }),
  invalidate: () => {},
};
const pageConfig = { pageWidth: 816, pageHeight: 1056, margins: { top: 96, bottom: 96, left: 96, right: 96 }, pageless: false };

const policy: HeaderFooterPolicy = {
  enabled: true,
  differentFirstPage: false,
  differentOddEven: false,
  defaultHeader: {
    content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }] },
  },
};

const flow: DocumentLayout = { pages: [{ pageNumber: 1, blocks: [] }], pageConfig, version: 1, totalContentHeight: 0 };
const iteration: LayoutIterationContext = {
  runId: 1, iteration: 1, maxIterations: 5, previousIterationPayload: null, previousRunPayload: null,
  currentFlowLayout: flow, previousRunFlowLayout: null,
};

/** A stand-in 2D context that records the font each text is filled in. */
function recordingContext(drawn: string[]): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  const isContext = (value: unknown): value is CanvasRenderingContext2D => typeof value === "object" && value !== null;
  const context: unknown = new Proxy(state, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "measureText") return (text: string) => ({ width: widthOf(text) });
      return (...args: unknown[]) => {
        if (key === "fillText") drawn.push(`${String(args[0])} in ${String(target["font"])}`);
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

describe("a heading in a header", () => {
  const manager = new ExtensionManager([StarterKit, HeaderFooter]);
  const fontConfig = manager.buildBlockStyles();
  const { doc } = new ServerEditor({ extensions: [StarterKit, HeaderFooter] }).getState();
  const contribution = resolveChrome(policy, { doc, pageConfig, measurer, fontConfig }, iteration, 0);
  if (!isResolvedHeaderFooter(contribution.payload)) throw new Error("no header layout");
  const resolved = contribution.payload;
  const slot = resolved.slots.defaultHeader;
  if (!slot) throw new Error("no header slot");

  it("is measured in the heading's font", () => {
    const span = slot.layout.pages[0]?.blocks[0]?.lines[0]?.spans[0];
    expect(span?.kind === "text" ? span.font : "").toMatch(/^bold 28px /);
  });

  it.each([false, true])("is painted in the heading's font (while edited: %s)", (edited) => {
    const header = policy.defaultHeader;
    if (!header) throw new Error("no header");
    const surface = edited ? new HeaderFooterSurfaceCache(doc.type.schema).getOrCreate("defaultHeader", header) : null;
    const drawn: string[] = [];
    drawPageChrome({
      ctx: {
        ctx: recordingContext(drawn),
        pageNumber: 1, totalPages: 1, pageConfig, payload: resolved, measurer,
        blockRegistry: manager.buildBlockRegistry(),
        theme: defaultEditorTheme,
        metrics: {
          pageNumber: 1, contentTop: 150, contentBottom: 900, contentHeight: 750, contentWidth: 624,
          headerTop: pageConfig.margins.top, headerHeight: slot.reservedHeight, footerTop: 900, footerHeight: 0,
        },
      },
      resolved, activeSurface: surface, activePage: 1,
    });
    expect(drawn.find((call) => call.startsWith("Title"))).toMatch(/^Title in bold 28px /);
  });
});
