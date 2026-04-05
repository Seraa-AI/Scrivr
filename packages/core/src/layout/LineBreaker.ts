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
 *   "baseline"    — bottom of the object sits on the text baseline (Google Docs default).
 *                  The line ascent expands to fit the object above the baseline.
 *   "middle"      — center of the object aligns with the parent font's x-height midpoint
 *                   (matches CSS vertical-align: middle and Word/Docs behaviour).
 *   "top"         — top of the object sits at the line top.
 *   "bottom"      — bottom of the object sits at the line bottom.
 *   "text-top"    — top of the object aligns with the top of the parent font's ascent.
 *   "text-bottom" — bottom of the object aligns with the bottom of the parent font's descent.
 */
export type InlineObjectVerticalAlign =
  | "baseline"
  | "middle"
  | "top"
  | "bottom"
  | "text-top"
  | "text-bottom";

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
    }
  | {
      /**
       * Hard line break (Shift-Enter / hard_break node).
       * Flushes the current line and starts a new one. Does not contribute
       * any visible width or height — the break itself is invisible.
       */
      kind: "break";
      /** ProseMirror doc position of the hard_break node */
      docPos: number;
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
  /**
   * X-height of the dominant font on this line — height of a lowercase "x".
   * Used by vertical-align: middle to align element centers to the x-height
   * midpoint rather than the full line height midpoint (matches CSS spec).
   * Zero on object-only lines.
   */
  xHeight: number;
  /**
   * The actual available width used when breaking this line.
   * For lines constrained by a float, this is narrower than block.availableWidth.
   * Used by justify to spread text only to the constrained width, not the full column.
   * Undefined when no constraint applies (use block.availableWidth as fallback).
   */
  effectiveWidth?: number;
  /**
   * Left-offset delta (from the block's content left edge) for float-constrained lines.
   * Non-zero for square-left floats where text must start to the right of the float.
   * Add this to block.x when computing absolute span positions.
   * Undefined (= 0) when no constraint applies.
   */
  constraintX?: number;
  /**
   * When this line ends with a hard_break node, the ProseMirror doc position of
   * that break. Used by CharacterMap registration to expose the break position as
   * a clickable cursor target — without this, coordsAtPos(breakPos) has no anchor.
   * Undefined for lines that end due to normal word-wrap.
   */
  terminalBreakDocPos?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the ProseMirror doc position just past the end of a span.
 * Text spans: docPos + text.length; object spans: docPos + 1 (nodeSize = 1).
 */
export function spanEndDocPos(span: LayoutSpan | InputSpan): number {
  return span.kind === "text"
    ? span.docPos + span.text.length
    : span.docPos + 1;
}

/**
 * Computes the canvas y coordinate for the top of an inline object's render rectangle.
 *
 * The result is an absolute y — pass lineY (top of the line strip) and the
 * LayoutLine produced by buildLine so the correct alignment mode is applied.
 *
 *   "baseline"    — bottom of object on text baseline      (lineY + ascent - height)
 *   "top"         — top of object at line top              (lineY)
 *   "bottom"      — bottom of object at line bottom        (lineY + lineHeight - height)
 *   "middle"      — center of object at x-height midpoint  baseline - xHeight/2 - height/2
 *                   (matches CSS spec and Word/Docs; falls back to line-center if no text)
 *   "text-top"    — top of object at parent font ascent top (lineY + ascent - textAscent)
 *   "text-bottom" — bottom of object at parent font descent (lineY + ascent + descent - height)
 */
export function computeObjectRenderY(
  lineY: number,
  line: LayoutLine,
  span: Extract<LayoutSpan, { kind: "object" }>,
): number {
  const baseline = lineY + line.ascent;
  switch (span.verticalAlign) {
    case "baseline":
      return baseline - span.height;
    case "top":
      return lineY;
    case "bottom":
      return lineY + line.lineHeight - span.height;
    case "middle":
      if (line.xHeight > 0) {
        // CSS spec: center of element aligns with midpoint of parent x-height.
        // midpoint = baseline - xHeight/2  →  top = midpoint - height/2
        return baseline - line.xHeight / 2 - span.height / 2;
      }
      // Object-only line (no text) — fall back to centering in line height.
      return lineY + Math.max(0, line.lineHeight - span.height) / 2;
    case "text-top":
      // Top of object at the top of the parent font's ascender.
      return baseline - line.textAscent;
    case "text-bottom":
      // Bottom of object at the bottom of the parent font's descender.
      return baseline + line.descent - span.height;
    default:
      return baseline - span.height;
  }
}

/**
 * A ConstraintProvider narrows the available line area based on floated images.
 *
 * @param absoluteLineY — absolute Y of the line top in page coordinates
 * @returns { x, width } where x is a left-offset delta from the block's
 *          content left and width is the available text width, or null if
 *          no constraint applies at this Y.
 */
export type ConstraintProvider = (
  absoluteLineY: number,
) => { x: number; width: number; skipToY?: number } | null;

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
   * @param options — required options including defaultFontFamily, defaultFontSize,
   *                  and optional map, pageContext, constraintProvider, startY
   */
  breakIntoLines(
    spans: InputSpan[],
    maxWidth: number,
    options: {
      /** Font family for phantom ZWS lines emitted on hard_break tokens, e.g. "Georgia". */
      defaultFontFamily: string;
      /** Font size in CSS pixels for phantom ZWS lines, e.g. 14. */
      defaultFontSize: number;
      map?: CharacterMap;
      pageContext?: { page: number; lineIndexOffset: number; lineY: number };
      constraintProvider?: ConstraintProvider;
      startY?: number;
    },
  ): LayoutLine[] {
    if (!spans.length) return [];

    const { defaultFontFamily, defaultFontSize, map, pageContext, constraintProvider, startY = 0 } = options;

    const lines: LayoutLine[] = [];
    let currentLine: LayoutSpan[] = [];
    let currentWidth = 0;
    let cumulativeLineY = 0;
    // Tracks the most recently seen text font — used to size the phantom ZWS
    // line emitted after a trailing hard_break.
    let lastSeenFont: string | undefined = undefined;
    // Track the effective width and x-offset constraint active when this line started.
    // Needed by justify (effectiveWidth) and square-left rendering (constraintX).
    let currentLineEffectiveWidth: number | undefined = undefined;
    let currentLineConstraintX: number | undefined = undefined;

    // Tokenise all spans. Text spans → word tokens (space-split).
    // Object spans → single atomic tokens (cannot be split).
    // Break spans → break tokens (force a line flush).
    const rawWords = tokenise(spans);
    // Pre-tokenise with the default maxWidth for wide-word splitting.
    const words: Token[] = [];
    for (const word of rawWords) {
      if (word.kind === "object" || word.kind === "break") {
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
      // Determine the effective width for the current line, applying any
      // float constraint from the ConstraintProvider.
      let absoluteLineY = startY + cumulativeLineY;
      let constraint = constraintProvider
        ? constraintProvider(absoluteLineY)
        : null;

      // Handle top-bottom ('full') float: flush any partial line then emit a
      // spacer line whose lineHeight equals the remaining gap to skipToY. The
      // spacer has no spans so the renderer draws nothing, but BlockLayout's
      // height = lines.reduce(sum + lineHeight) correctly reserves the space,
      // and the renderer's lineY advances past the image before drawing the
      // next real line.
      if (
        constraint?.skipToY !== undefined &&
        constraint.skipToY > absoluteLineY
      ) {
        if (currentLine.length > 0) {
          const fl = buildLine(currentLine, this.measurer);
          if (currentLineEffectiveWidth !== undefined)
            fl.effectiveWidth = currentLineEffectiveWidth;
          if (currentLineConstraintX !== undefined)
            fl.constraintX = currentLineConstraintX;
          lines.push(fl);
          cumulativeLineY += fl.lineHeight;
          currentLine = [];
          currentWidth = 0;
        }
        const gapHeight = constraint.skipToY - startY - cumulativeLineY;
        if (gapHeight > 0) {
          lines.push({
            spans: [],
            width: 0,
            ascent: 0,
            descent: 0,
            lineHeight: gapHeight,
            textAscent: 0,
            cursorHeight: 0,
            xHeight: 0,
          });
          cumulativeLineY += gapHeight;
        }
        absoluteLineY = startY + cumulativeLineY;
        constraint = constraintProvider
          ? constraintProvider(absoluteLineY)
          : null;
      }

      const effectiveMaxWidth = constraint ? constraint.width : maxWidth;

      // Record constraint on the first word of a new line.
      if (currentLine.length === 0) {
        currentLineEffectiveWidth = constraint ? constraint.width : undefined;
        currentLineConstraintX =
          constraint && constraint.x > 0 ? constraint.x : undefined;
      }

      // Hard line break: flush the current line and start a new one.
      // Handled before wordWidth because BreakToken has no text/font.
      if (word.kind === "break") {
        if (currentLine.length > 0) {
          // Normal case: flush the content line terminated by this break.
          const finishedLine = buildLine(currentLine, this.measurer);
          if (currentLineEffectiveWidth !== undefined)
            finishedLine.effectiveWidth = currentLineEffectiveWidth;
          if (currentLineConstraintX !== undefined)
            finishedLine.constraintX = currentLineConstraintX;
          finishedLine.terminalBreakDocPos = word.docPos;
          lines.push(finishedLine);
          cumulativeLineY += finishedLine.lineHeight;
          currentLine = [];
          currentWidth = 0;
          currentLineEffectiveWidth = undefined;
          currentLineConstraintX = undefined;
        } else {
          // currentLine is empty: this is either a leading break or a consecutive
          // break immediately following another break. Emit a phantom ZWS line so
          // every break produces exactly one line box — N breaks → N new lines.
          // font is always defined here: either a prior text span set lastSeenFont,
          // or we fall back to the caller-provided default font (always defined).
          const font = lastSeenFont ?? `${defaultFontSize}px ${defaultFontFamily}`;
          const phantomLine = buildLine(
            [{ kind: "text", text: "\u200B", font, x: 0, width: 0, docPos: word.docPos }],
            this.measurer,
          );
          lines.push(phantomLine);
          cumulativeLineY += phantomLine.lineHeight;
        }
        continue;
      }

      const wordWidth =
        word.kind === "object"
          ? word.width
          : this.measurer.measureWidth(word.text, word.font);

      const fitsOnCurrentLine = currentWidth + wordWidth <= effectiveMaxWidth;
      const lineIsEmpty = currentLine.length === 0;

      if (!fitsOnCurrentLine && !lineIsEmpty) {
        const finishedLine = buildLine(currentLine, this.measurer);
        if (currentLineEffectiveWidth !== undefined)
          finishedLine.effectiveWidth = currentLineEffectiveWidth;
        if (currentLineConstraintX !== undefined)
          finishedLine.constraintX = currentLineConstraintX;
        lines.push(finishedLine);
        cumulativeLineY += finishedLine.lineHeight;
        currentLine = [];
        currentWidth = 0;
        // Sample constraint for the new line that's about to start.
        const newAbsoluteLineY = startY + cumulativeLineY;
        const newConstraint = constraintProvider
          ? constraintProvider(newAbsoluteLineY)
          : null;
        currentLineEffectiveWidth = newConstraint
          ? newConstraint.width
          : undefined;
        currentLineConstraintX =
          newConstraint && newConstraint.x > 0 ? newConstraint.x : undefined;
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
        lastSeenFont = word.font;
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
      const lastLine = buildLine(currentLine, this.measurer);
      if (currentLineEffectiveWidth !== undefined)
        lastLine.effectiveWidth = currentLineEffectiveWidth;
      if (currentLineConstraintX !== undefined)
        lastLine.constraintX = currentLineConstraintX;
      lines.push(lastLine);
    } else if (words.length > 0 && words[words.length - 1]!.kind === "break") {
      // Trailing break: the paragraph ends with a hard_break and currentLine is empty.
      // Emit a phantom ZWS line so the cursor after the break is reachable.
      // Use the font of the last text token seen (guaranteed to exist because the
      // ZWS fallback in BlockLayout replaces span-less paragraphs before we get here).
      const trailingBreak = words[words.length - 1]! as BreakToken;
      const font = lastSeenFont ?? `${defaultFontSize}px ${defaultFontFamily}`;
      const phantomLine = buildLine(
        [
          {
            kind: "text",
            text: "\u200B",
            font,
            x: 0,
            width: 0,
            docPos: trailingBreak.docPos + 1,
          },
        ],
        this.measurer,
      );
      lines.push(phantomLine);
    }

    if (map && pageContext) {
      this.populateCharacterMap(lines, map, pageContext);
    }

    return lines;
  }

  /**
   * Splits a text token that is wider than maxWidth into the largest
   * grapheme-cluster chunks that each fit within maxWidth (greedy, left to right).
   *
   * Uses Intl.Segmenter to iterate grapheme clusters so surrogate pairs and
   * ZWJ sequences (e.g. emoji with skin-tone modifiers) are never split —
   * the original character-index loop would break UTF-16 surrogate pairs when
   * the split point landed inside a multi-code-unit character.
   */
  private splitWideWord(word: TextToken, maxWidth: number): TextToken[] {
    const result: TextToken[] = [];
    const graphemes = [...new Intl.Segmenter().segment(word.text)];
    let startSeg = 0;

    while (startSeg < graphemes.length) {
      const chunkStart = graphemes[startSeg]!.index;
      let endSeg = startSeg; // last included grapheme (inclusive)

      // Greedily extend the chunk one grapheme at a time.
      while (endSeg + 1 < graphemes.length) {
        const next = graphemes[endSeg + 1]!;
        // Measure from chunkStart through the END of the next grapheme.
        const tentativeEnd = next.index + next.segment.length;
        if (this.measurer.measureWidth(word.text.slice(chunkStart, tentativeEnd), word.font) > maxWidth) break;
        endSeg++;
      }

      // chunkEnd = start of the first grapheme NOT included in this chunk.
      const chunkEnd =
        endSeg + 1 < graphemes.length
          ? graphemes[endSeg + 1]!.index
          : word.text.length;

      result.push({
        kind: "text",
        text: word.text.slice(chunkStart, chunkEnd),
        font: word.font,
        docPos: word.docPos + chunkStart,
        ...(word.marks !== undefined ? { marks: word.marks } : {}),
      });
      startSeg = endSeg + 1;
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
    ctx: { page: number; lineIndexOffset: number; lineY: number },
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
      const textY =
        line.textAscent > 0
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
        endDocPos:
          line.terminalBreakDocPos !== undefined
            ? line.terminalBreakDocPos + 1
            : lastSpan
              ? spanEndDocPos(lastSpan)
              : 0,
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
            width:
              ci < span.text.length - 1
                ? run.charPositions[ci + 1]! - run.charPositions[ci]!
                : run.totalWidth - run.charPositions[ci]!,
            height: line.cursorHeight,
            page: ctx.page,
            lineIndex,
          });
        }
      }

      // Register a zero-width glyph at the hard_break's doc position so
      // coordsAtPos(breakDocPos) returns a valid cursor location at the end
      // of this line rather than falling back to the wrong-page heuristic.
      if (line.terminalBreakDocPos !== undefined) {
        map.registerGlyph({
          docPos: line.terminalBreakDocPos,
          x: line.width,
          y: textY,
          lineY: y,
          width: 0,
          height: line.cursorHeight,
          page: ctx.page,
          lineIndex,
        });
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

interface BreakToken {
  kind: "break";
  docPos: number;
}

type Token = TextToken | ObjectToken | BreakToken;

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
      tokens.push({
        kind: "object",
        node: span.node,
        width: span.width,
        height: span.height,
        docPos: span.docPos,
        verticalAlign: span.verticalAlign,
      });
      continue;
    }

    if (span.kind === "break") {
      tokens.push({ kind: "break", docPos: span.docPos });
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
  let xHeight = 0;
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
    if (m.xHeight > xHeight) xHeight = m.xHeight;
  }

  // Pass 2: expand line metrics to accommodate object spans.
  //
  //   "baseline"    — image bottom on text baseline → expand ascent.
  //   "top"/"bottom"/"middle" — expand lineHeight but don't move the baseline.
  //   "text-top"    — top of object at parent font top (ascent - textAscent).
  //                   Expand descent if object extends below text bottom.
  //   "text-bottom" — bottom of object at parent font bottom (ascent + descent).
  //                   Expand ascent if object extends above text top.
  let ascent = textAscent;
  let descent = textDescent;
  let lineHeight = textLineHeight;

  for (const span of spans) {
    if (span.kind !== "object") continue;
    switch (span.verticalAlign) {
      case "baseline":
        if (span.height > ascent) ascent = span.height;
        break;
      case "top":
      case "bottom":
      case "middle":
        if (span.height > lineHeight) lineHeight = span.height;
        break;
      case "text-top": {
        // Object top = ascent - textAscent. Object bottom = ascent - textAscent + height.
        // Needs lineHeight >= (ascent - textAscent) + height.
        const needed = ascent - textAscent + span.height;
        if (needed > lineHeight) lineHeight = needed;
        break;
      }
      case "text-bottom": {
        // Object bottom = ascent + descent. Object top = ascent + descent - height.
        // If height > textAscent + descent, object pokes above text top → expand ascent.
        const overflow = span.height - (textAscent + descent);
        if (overflow > 0) ascent = Math.max(ascent, ascent + overflow);
        break;
      }
    }
  }

  // Baseline/text-bottom objects may have inflated ascent beyond textLineHeight.
  // Ensure lineHeight always covers ascent + descent.
  lineHeight = Math.max(lineHeight, ascent + descent);

  // Object-only line: no text ascent — use lineHeight as ascent so baseline
  // calculations (lineY + ascent) still produce a sensible result.
  if (ascent === 0 && lineHeight > 0) ascent = lineHeight;

  // cursorHeight is text-derived so the caret stays text-sized even when an
  // inline image inflates lineHeight. Falls back to DEFAULT_CURSOR_HEIGHT
  // for object-only lines (no text spans present).
  const cursorHeight =
    textLineHeight > 0 ? textLineHeight : DEFAULT_CURSOR_HEIGHT;

  return {
    spans,
    width,
    ascent,
    descent,
    lineHeight,
    textAscent,
    cursorHeight,
    xHeight,
  };
}
