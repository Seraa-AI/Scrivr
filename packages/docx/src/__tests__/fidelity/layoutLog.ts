import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import {
  TextMeasurer,
  defaultPageConfig,
  normalizeDrawNumber,
  runPipeline,
  type BaseEditor,
  type DocumentLayout,
  type LayoutPage,
  type PageConfig,
  type TextMeasurerLike,
} from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { CARET_SENTINEL } from "./wordReference";

/**
 * What Scrivr put on each page, as data.
 *
 * The log records the decisions layout makes for an imported document: the
 * page geometry, and for every block where it sits, how much space it keeps
 * around it and where its lines break. A change to spacing, page size or line
 * breaking moves a number or a line here, so the snapshot of it fails.
 *
 * Numbers go through `normalizeDrawNumber`, the PDF op log's rounding rule.
 */

export type LayoutOp =
  | { op: "page"; page: number; width: number; height: number; margins: PageConfig["margins"] }
  | {
      op: "block";
      page: number;
      /** 0 for a block on the page, 1 for one in a table cell, and so on. */
      depth: number;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      spaceBefore: number;
      spaceAfter: number;
      /** The first characters of each line, so a moved line break shows. */
      lines: string[];
    };

const LINE_PREFIX = 16;

/**
 * Lay the editor's document out the way the editor would — its block styles,
 * font modifiers and inline registry — on `pageConfig`. The body only: a
 * server editor has no header or footer to draw.
 *
 * Import does not yet carry a document's page size and margins, so the editor
 * itself would lay it out on the default page.
 */
export function layOut(editor: BaseEditor, measurer: TextMeasurerLike, pageConfig: PageConfig = defaultPageConfig): DocumentLayout {
  return runPipeline(editor.getState().doc, {
    pageConfig,
    measurer,
    fontConfig: editor.getBlockStyles(),
    fontModifiers: new Map(editor.getFontModifiers()),
    inlineRegistry: editor.inlineRegistry,
  });
}

export function recordLayout(layout: DocumentLayout): LayoutOp[] {
  const n = normalizeDrawNumber;
  const { pageWidth, pageHeight, margins } = layout.pageConfig;
  const ops: LayoutOp[] = [];
  for (const page of layout.pages) {
    ops.push({
      op: "page",
      page: page.pageNumber,
      width: n(pageWidth),
      height: n(pageHeight),
      margins: { top: n(margins.top), right: n(margins.right), bottom: n(margins.bottom), left: n(margins.left) },
    });
    for (const { block, depth } of blocksIn(page.blocks)) {
      ops.push({
        op: "block",
        page: page.pageNumber,
        depth,
        type: block.blockType,
        x: n(block.x),
        y: n(block.y),
        width: n(block.width),
        height: n(block.height),
        spaceBefore: n(block.spaceBefore),
        spaceAfter: n(block.spaceAfter),
        lines: block.lines.map((line) => lineText(line).slice(0, LINE_PREFIX)),
      });
    }
  }
  return ops;
}

/** One op per line, so a snapshot diff points at the block that moved. */
export function serializeLayout(ops: readonly LayoutOp[]): string {
  return `${ops.map((op) => JSON.stringify(op)).join("\n")}\n`;
}

type LaidBlock = LayoutPage["blocks"][number];

/** Every block in reading order, a table's cells' blocks after the table. */
function* blocksIn(blocks: readonly LaidBlock[], depth = 0): Generator<{ block: LaidBlock; depth: number }> {
  for (const block of blocks) {
    yield { block, depth };
    for (const region of block.regions ?? []) yield* blocksIn(region.blocks, depth + 1);
  }
}

/** The text a line shows, from its text spans. */
function lineText(line: LaidBlock["lines"][number]): string {
  let text = "";
  for (const span of line.spans) if (span.kind === "text") text += span.text;
  return text;
}

/**
 * The text on each page, in reading order, table cells included. Layout gives
 * an empty line a zero-width caret sentinel; it is left out, because it is
 * not text the document holds.
 */
export function pageTexts(layout: DocumentLayout): string[] {
  return layout.pages.map((page) => {
    const lines: string[] = [];
    for (const { block } of blocksIn(page.blocks)) for (const line of block.lines) lines.push(lineText(line));
    return lines.join("\n").replaceAll(CARET_SENTINEL, "");
  });
}

/** The one face every family is measured in. */
const PINNED_FACE = "FidelityInter";
const INTER_DIR = dirname(createRequire(import.meta.url).resolve("@expo-google-fonts/inter/package.json"));
let pinnedFaceRegistered = false;

/**
 * A measurer with real glyph metrics, every family set in Inter.
 *
 * Word's faces (Calibri, Times New Roman) are absent on Linux CI, and the
 * fallback differs per machine, so every family is measured in Inter, a
 * pinned dev dependency: proportional metrics, identical everywhere. A weight
 * other than regular or bold takes the nearer of the two, the same on every
 * machine.
 */
export function pinnedFaceMeasurer(): TextMeasurer {
  if (!pinnedFaceRegistered) {
    for (const file of [
      "400Regular/Inter_400Regular.ttf",
      "400Regular_Italic/Inter_400Regular_Italic.ttf",
      "700Bold/Inter_700Bold.ttf",
      "700Bold_Italic/Inter_700Bold_Italic.ttf",
    ]) {
      // A face that did not register would fall back to a machine font, silently.
      if (!GlobalFonts.registerFromPath(join(INTER_DIR, file), PINNED_FACE)) {
        throw new Error(`could not register ${file} as ${PINNED_FACE}`);
      }
    }
    pinnedFaceRegistered = true;
  }
  const canvas = createCanvas(1, 1).getContext("2d");
  return new TextMeasurer({
    context: {
      get font() {
        return canvas.font;
      },
      set font(css: string) {
        // "italic bold 16px Calibri, sans-serif" → "italic bold 16px FidelityInter"
        const pinned = css.replace(/(\d+(?:\.\d+)?px)(?:\s*\/\s*\S+)?\s+.*$/, `$1 ${PINNED_FACE}`);
        if (!pinned.endsWith(PINNED_FACE)) throw new Error(`cannot pin the family of font "${css}"`);
        canvas.font = pinned;
      },
      measureText: (text: string): TextMetrics => canvas.measureText(text),
    },
  });
}

/**
 * A measurer that gives every glyph the same advance: half the font size.
 *
 * Real metrics differ between Linux CI and a laptop, so a snapshot built on
 * them would move for reasons unrelated to the change under test. With fixed
 * widths the log isolates what layout decides — spacing, page geometry and
 * where blocks split — and is the same on every machine.
 */
export function fixedWidthMeasurer(): TextMeasurerLike {
  const sizeOf = (font: string): number => {
    const match = /(\d+(?:\.\d+)?)px/.exec(font);
    return match ? Number(match[1]) : 16;
  };
  const advance = (font: string) => sizeOf(font) / 2;
  return {
    measureWidth: (text, font) => text.length * advance(font),
    getFontMetrics: (font) => {
      const size = sizeOf(font);
      const ascent = size * 0.8;
      const descent = size * 0.2;
      return { ascent, descent, lineHeight: (ascent + descent) * 1.2, xHeight: size * 0.5 };
    },
    measureRun: (text, font) => {
      const step = advance(font);
      return {
        totalWidth: text.length * step,
        charPositions: Array.from({ length: text.length }, (_, i) => i * step),
      };
    },
    invalidate: () => {},
  };
}
