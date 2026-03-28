import type { Node } from "prosemirror-model";
import { TextMeasurer } from "./TextMeasurer";
import type { CharacterMap } from "./CharacterMap";
import { normalizeFont } from "./StyleResolver";

// ── InputSpan ─────────────────────────────────────────────────────────────────

/**
 * A run of content with a known ProseMirror start position.
 * Produced by extractSpans() when walking the ProseMirror doc tree.
 */
/**
 * How an inline object aligns vertically within its line box.
 *
 *   "baseline" — bottom of the object sits on the text baseline (Google Docs default).
 *                The line ascent expands to fit the object above the baseline.
 *   "middle"   — object is centered in the line height.
 *   "top"      — top of the object sits at the line top.
 */
export type InlineObjectVerticalAlign = "baseline" | "middle" | "top";

export type InputSpan =
  | {
      kind: "text";
      text: string;
      font: string;
      /** ProseMirror doc position of the first character in this span */
      docPos: number;
      /** Mark info for canvas decorators (underline, strikethrough, highlight) */
      marks?: Array<{ name: string; attrs: Record<string, unknown> }>;
    }
  | {
      kind: "object";
      /** The inline ProseMirror node (image, widget, …) */
      node: Node;
      /** Fixed width in CSS pixels */
      width: number;
      /** Fixed height in CSS pixels */
      height: number;
      /** ProseMirror doc position of this node */
      docPos: number;
      /** Vertical alignment within the line — sourced from the node's verticalAlign attr */
      verticalAlign: InlineObjectVerticalAlign;
    };

// ── LayoutSpan ────────────────────────────────────────────────────────────────

/**
 * A span that has been placed on a line — x position resolved, width finalised.
 */
export type LayoutSpan =
  | {
      kind: "text";
      text: string;
      font: string;
      /** X position relative to the line's left origin (not the page margin) */
      x: number;
      width: number;
      /** ProseMirror doc position of the first character */
      docPos: number;
      marks?: Array<{ name: string; attrs: Record<string, unknown> }>;
    }
  | {
      kind: "object";
      node: Node;
      x: number;
      width: number;
      height: number;
      docPos: number;
      verticalAlign: InlineObjectVerticalAlign;
    };

// ── LayoutLine ────────────────────────────────────────────────────────────────

export interface LayoutLine {
  spans: LayoutSpan[];
  /** Total measured width of all spans on this line */
  width: number;
  /**
   * Line ascent from the top of the line to the text baseline.
   * Inflated by baseline-aligned inline objects taller than the text ascent.
   */
  ascent: number;
  descent: number;
  /** Total vertical space this line occupies (ascent + descent, or more for top/middle objects) */
  lineHeight: number;
  /**
   * Text-only ascent — the ascent value derived from text spans alone.
   * Used to position text glyphs correctly when an inline object has inflated `ascent`.
   * Zero on object-only lines.
   */
  textAscent: number;
  /**
   * Height to use for cursor / caret drawing — derived from text spans only,
   * so the cursor stays text-sized even when an inline image inflates lineHeight.
   * For object-only lines (no text) falls back to DEFAULT_CURSOR_HEIGHT (16px).
   */
  cursorHeight: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the ProseMirror doc position just past the end of a span.
 * Text spans: docPos + text.length; object spans: docPos + 1 (nodeSize = 1).
 */
export function spanEndDocPos(span: LayoutSpan | InputSpan): number {
  return span.kind === "text" ? span.docPos + span.text.length : span.docPos + 1;
}

/**
 * Computes the canvas y coordinate for the top of an inline object's render rectangle.
 *
 * The result is an absolute y — pass lineY (top of the line strip) and the
 * LayoutLine produced by buildLine so the correct alignment mode is applied.
 *
 *   "baseline" — bottom of object on text baseline  (lineY + ascent - height)
 *   "top"      — top of object at line top          (lineY)
 *   "middle"   — object centered in line height     (lineY + (lineHeight - height) / 2)
 */
export function computeObjectRenderY(
  lineY: number,
  line: LayoutLine,
  span: Extract<LayoutSpan, { kind: "object" }>,
): number {
  switch (span.verticalAlign) {
    case "baseline":
      return lineY + line.ascent - span.height;
    case "top":
      return lineY;
    case "middle":
    default:
      return lineY + Math.max(0, line.lineHeight - span.height) / 2;
  }
}

/**
 * LineBreaker — greedy word-wrap algorithm.
 *
 * Converts a paragraph's InputSpans into LayoutLines that fit within maxWidth.
 *
 * Performance design (O(n²) warning addressed):
 *   - measureWidth()  for line-break DECISIONS  → O(1) amortised (cached)
 *   - measureRun()    for CharacterMap POPULATION → O(word_length²) per word
 *
 * measureRun is never called on a full paragraph — only on individual words
 * after the line-break decision is already made. The worst case is the longest
 * word in the document, not the longest paragraph.
 */
export class LineBreaker {
  constructor(private measurer: TextMeasurer) {}

  /**
   * Break a paragraph's spans into lines that fit within maxWidth.
   *
   * @param spans   — text runs / inline objects from the ProseMirror doc tree
   * @param maxWidth — available width in CSS pixels (page width minus margins)
   * @param map     — optional CharacterMap to populate with glyph positions
   * @param pageContext — page + lineIndex offset for CharacterMap registration
   */
  breakIntoLines(
    spans: InputSpan[],
    maxWidth: number,
    map?: CharacterMap,
    pageContext?: { page: number; lineIndexOffset: number; lineY: number }
  ): LayoutLine[] {
    if (!spans.length) return [];

    const lines: LayoutLine[] = [];
    let currentLine: LayoutSpan[] = [];
    let currentWidth = 0;

    // Tokenise all spans. Text spans → word tokens (space-split).
    // Object spans → single atomic tokens (cannot be split).
    const rawWords = tokenise(spans);
    const words: Token[] = [];
    for (const word of rawWords) {
      if (word.kind === "object") {
        words.push(word);
      } else {
        const wordWidth = this.measurer.measureWidth(word.text, word.font);
        if (wordWidth > maxWidth) {
          words.push(...this.splitWideWord(word, maxWidth));
        } else {
          words.push(word);
        }
      }
    }

    for (const word of words) {
      const wordWidth =
        word.kind === "object"
          ? word.width
          : this.measurer.measureWidth(word.text, word.font);

      const fitsOnCurrentLine = currentWidth + wordWidth <= maxWidth;
      const lineIsEmpty = currentLine.length === 0;

      if (!fitsOnCurrentLine && !lineIsEmpty) {
        lines.push(buildLine(currentLine, this.measurer));
        currentLine = [];
        currentWidth = 0;
      }

      if (word.kind === "object") {
        currentLine.push({
          kind: "object",
          node: word.node,
          x: currentWidth,
          width: word.width,
          height: word.height,
          docPos: word.docPos,
          verticalAlign: word.verticalAlign,
        });
      } else {
        currentLine.push({
          kind: "text",
          text: word.text,
          font: word.font,
          x: currentWidth,
          width: wordWidth,
          docPos: word.docPos,
          ...(word.marks !== undefined ? { marks: word.marks } : {}),
        });
      }

      currentWidth += wordWidth;
    }

    if (currentLine.length) {
      lines.push(buildLine(currentLine, this.measurer));
    }

    if (map && pageContext) {
      this.populateCharacterMap(lines, map, pageContext);
    }

    return lines;
  }

  /**
   * Splits a text token that is wider than maxWidth into the largest
   * character-level chunks that each fit within maxWidth (greedy, left to right).
   */
  private splitWideWord(word: TextToken, maxWidth: number): TextToken[] {
    const result: TextToken[] = [];
    let start = 0;

    while (start < word.text.length) {
      let end = start + 1;
      while (end < word.text.length) {
        const w = this.measurer.measureWidth(word.text.slice(start, end + 1), word.font);
        if (w > maxWidth) break;
        end++;
      }
      result.push({
        kind: "text",
        text: word.text.slice(start, end),
        font: word.font,
        docPos: word.docPos + start,
        ...(word.marks !== undefined ? { marks: word.marks } : {}),
      });
      start = end;
    }

    return result;
  }

  /**
   * Populates the CharacterMap with per-character glyph entries for text spans
   * and single glyph entries for object spans.
   */
  private populateCharacterMap(
    lines: LayoutLine[],
    map: CharacterMap,
    ctx: { page: number; lineIndexOffset: number; lineY: number }
  ): void {
    let y = ctx.lineY;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const lineIndex = ctx.lineIndexOffset + li;
      const lastSpan = line.spans[line.spans.length - 1];

      // textY: where text cursor rectangles start vertically.
      // When a baseline image inflates line.ascent, text sits at the bottom of
      // the line (baseline = y + ascent). We align the cursor to the text, not
      // the full line height.
      const textY = line.textAscent > 0
        ? y + line.ascent - line.textAscent
        : y + Math.max(0, line.lineHeight - line.cursorHeight) / 2;

      map.registerLine({
        page: ctx.page,
        lineIndex,
        y,
        height: line.lineHeight,
        x: 0,
        contentWidth: 0,
        startDocPos: line.spans[0]?.docPos ?? 0,
        endDocPos: lastSpan ? spanEndDocPos(lastSpan) : 0,
      });

      for (const span of line.spans) {
        if (span.kind === "object") {
          // Full-width glyph → cursor before the object; midpoint at image
          // center gives a 50/50 left/right click split.
          // y = textY so cursor draws at the text baseline, not image top.
          map.registerGlyph({
            docPos: span.docPos,
            x: span.x,
            y: textY,
            lineY: y,
            width: span.width,
            height: line.cursorHeight,
            page: ctx.page,
            lineIndex,
          });
          // Zero-width sentinel at right edge → coordsAtPos draws cursor at
          // the right edge of the image, not its center.
          map.registerGlyph({
            docPos: span.docPos + 1,
            x: span.x + span.width,
            y: textY,
            lineY: y,
            width: 0,
            height: line.cursorHeight,
            page: ctx.page,
            lineIndex,
          });
          continue;
        }

        const run = this.measurer.measureRun(span.text, span.font);
        for (let ci = 0; ci < span.text.length; ci++) {
          map.registerGlyph({
            docPos: span.docPos + ci,
            x: span.x + run.charPositions[ci]!,
            y: textY,
            lineY: y,
            width: ci < span.text.length - 1
              ? run.charPositions[ci + 1]! - run.charPositions[ci]!
              : run.totalWidth - run.charPositions[ci]!,
            height: line.cursorHeight,
            page: ctx.page,
            lineIndex,
          });
        }
      }

      y += line.lineHeight;
    }
  }
}

// ── Internal token types ──────────────────────────────────────────────────────

interface TextToken {
  kind: "text";
  text: string;
  font: string;
  docPos: number;
  marks?: Array<{ name: string; attrs: Record<string, unknown> }>;
}

interface ObjectToken {
  kind: "object";
  node: Node;
  width: number;
  height: number;
  docPos: number;
  verticalAlign: InlineObjectVerticalAlign;
}

type Token = TextToken | ObjectToken;

/**
 * Splits InputSpans into word-level tokens.
 *
 * Text spans → space-split word tokens (trailing space attached to preceding word).
 * Object spans → single atomic tokens (cannot be word-split).
 *
 * A new token is created whenever the font changes, so "bold" and "normal"
 * text in the same paragraph are never merged into a single token.
 */
function tokenise(spans: InputSpan[]): Token[] {
  const tokens: Token[] = [];

  for (const span of spans) {
    if (span.kind === "object") {
      tokens.push({ kind: "object", node: span.node, width: span.width, height: span.height, docPos: span.docPos, verticalAlign: span.verticalAlign });
      continue;
    }

    const parts = span.text.split(/(?<= )/);
    let offset = 0;
    for (const part of parts) {
      if (!part.length) continue;
      tokens.push({
        kind: "text",
        text: part,
        font: span.font,
        docPos: span.docPos + offset,
        ...(span.marks !== undefined ? { marks: span.marks } : {}),
      });
      offset += part.length;
    }
  }

  return tokens;
}

/**
 * Converts placed LayoutSpans into a LayoutLine with correct vertical metrics.
 *
 * For text spans: ascent/descent/lineHeight come from font metrics (size only,
 * weight/style stripped so bold doesn't cause line-height jumps).
 *
 * For object spans: height contributes to lineHeight directly.
 * ascent/descent are derived from text spans only; if no text spans are present
 * on the line, ascent = lineHeight (object fills the line) and descent = 0.
 */
/** Fallback cursor height for lines that contain only inline objects (no text). */
const DEFAULT_CURSOR_HEIGHT = 16;

function buildLine(spans: LayoutSpan[], measurer: TextMeasurer): LayoutLine {
  // Pass 1: collect text-only metrics.
  let textAscent = 0;
  let textDescent = 0;
  let textLineHeight = 0;
  let width = 0;
  const seenFonts = new Set<string>();

  for (const span of spans) {
    width += span.width;
    if (span.kind !== "text") continue;
    const normFont = normalizeFont(span.font);
    if (seenFonts.has(normFont)) continue;
    seenFonts.add(normFont);
    const m = measurer.getFontMetrics(normFont);
    if (m.ascent > textAscent) textAscent = m.ascent;
    if (m.descent > textDescent) textDescent = m.descent;
    if (m.lineHeight > textLineHeight) textLineHeight = m.lineHeight;
  }

  // Pass 2: expand line metrics to accommodate object spans.
  //
  //   "baseline" — image bottom on text baseline → expand ascent so the image
  //                fits above the baseline. lineHeight = ascent + descent.
  //   "top"      — image stacked from the line top → expand lineHeight directly.
  //   "middle"   — image centered in line height → expand lineHeight directly.
  let ascent = textAscent;
  let descent = textDescent;
  let lineHeight = textLineHeight;

  for (const span of spans) {
    if (span.kind !== "object") continue;
    if (span.verticalAlign === "baseline") {
      if (span.height > ascent) ascent = span.height;
    } else {
      // "top" and "middle" expand the total line height but don't move the baseline.
      if (span.height > lineHeight) lineHeight = span.height;
    }
  }

  // Baseline images may have inflated ascent beyond textLineHeight.
  // Ensure lineHeight covers ascent + descent.
  lineHeight = Math.max(lineHeight, ascent + descent);

  // Object-only line: no text ascent — use lineHeight as ascent so baseline
  // calculations (lineY + ascent) still produce a sensible result.
  if (ascent === 0 && lineHeight > 0) ascent = lineHeight;

  // cursorHeight is text-derived so the caret stays text-sized even when an
  // inline image inflates lineHeight. Falls back to DEFAULT_CURSOR_HEIGHT
  // for object-only lines (no text spans present).
  const cursorHeight = textLineHeight > 0 ? textLineHeight : DEFAULT_CURSOR_HEIGHT;

  return { spans, width, ascent, descent, lineHeight, textAscent, cursorHeight };
}
