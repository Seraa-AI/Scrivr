import { TextMeasurer } from "./TextMeasurer";
import type { CharacterMap } from "./CharacterMap";

/**
 * A span of text with a consistent font and a known ProseMirror start position.
 * This is what the layout engine produces by walking the ProseMirror doc tree.
 */
export interface InputSpan {
  text: string;
  font: string;
  /** ProseMirror doc position of the first character in this span */
  docPos: number;
  /** Mark info for canvas decorators (underline, strikethrough, highlight) */
  marks?: Array<{ name: string; attrs: Record<string, unknown> }>;
}

/**
 * A span that has been placed on a line — x position resolved, width measured.
 */
export interface LayoutSpan {
  text: string;
  font: string;
  /** X position relative to the line's left origin (not the page margin) */
  x: number;
  width: number;
  /** ProseMirror doc position of the first character */
  docPos: number;
  marks?: Array<{ name: string; attrs: Record<string, unknown> }>;
}

export interface LayoutLine {
  spans: LayoutSpan[];
  /** Total measured width of all spans on this line */
  width: number;
  /** Font ascent — draw baseline at lineY + ascent */
  ascent: number;
  descent: number;
  /** Total vertical space this line occupies (includes lineHeightMultiplier) */
  lineHeight: number;
}

/**
 * LineBreaker — greedy word-wrap algorithm.
 *
 * Converts a paragraph's InputSpans into LayoutLines that fit within maxWidth.
 *
 * Performance design (Gemini's O(n²) warning addressed):
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
   * @param spans   — text runs with consistent font from the ProseMirror doc
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
    if (spans.length === 0) return [];

    const lines: LayoutLine[] = [];
    let currentLine: LayoutSpan[] = [];
    let currentWidth = 0;

    // Tokenise all spans into words, preserving font and docPos per word.
    // Pre-process: any word wider than maxWidth is split into character-level
    // chunks so the main loop never has to deal with unbreakable overflow.
    const rawWords = tokenise(spans);
    const words: Token[] = [];
    for (const word of rawWords) {
      const wordWidth = this.measurer.measureWidth(word.text, word.font);
      if (wordWidth > maxWidth) {
        words.push(...this.splitWideWord(word, maxWidth));
      } else {
        words.push(word);
      }
    }

    for (const word of words) {
      const wordWidth = this.measurer.measureWidth(word.text, word.font);

      const fitsOnCurrentLine = currentWidth + wordWidth <= maxWidth;
      const lineIsEmpty = currentLine.length === 0;

      if (!fitsOnCurrentLine && !lineIsEmpty) {
        // Flush current line
        lines.push(buildLine(currentLine, this.measurer));
        currentLine = [];
        currentWidth = 0;
      }

      // Place word on current line
      currentLine.push({
        text: word.text,
        font: word.font,
        x: currentWidth,
        width: wordWidth,
        docPos: word.docPos,
        ...(word.marks !== undefined ? { marks: word.marks } : {}),
      });

      currentWidth += wordWidth;
    }

    // Flush final line
    if (currentLine.length > 0) {
      lines.push(buildLine(currentLine, this.measurer));
    }

    // Populate CharacterMap if provided
    if (map && pageContext) {
      this.populateCharacterMap(lines, map, pageContext);
    }

    return lines;
  }

  /**
   * Splits a token that is wider than maxWidth into the largest character-level
   * chunks that each fit within maxWidth (greedy, left to right).
   *
   * This is the canvas equivalent of CSS `overflow-wrap: break-word` —
   * a word only breaks at the character level when it cannot fit on any line.
   */
  private splitWideWord(word: Token, maxWidth: number): Token[] {
    const result: Token[] = [];
    let start = 0;

    while (start < word.text.length) {
      // Greedily extend the chunk as far as it fits
      let end = start + 1;
      while (end < word.text.length) {
        const w = this.measurer.measureWidth(word.text.slice(start, end + 1), word.font);
        if (w > maxWidth) break;
        end++;
      }
      result.push({
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
   * Populates the CharacterMap with per-character glyph entries.
   *
   * Called after line-break decisions are finalised.
   * measureRun() is called per word — O(word_length²) per word, not per paragraph.
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

      map.registerLine({
        page: ctx.page,
        lineIndex,
        y,
        height: line.lineHeight,
        x: 0,
        contentWidth: 0,
        startDocPos: line.spans[0]?.docPos ?? 0,
        endDocPos: (line.spans[line.spans.length - 1]?.docPos ?? 0) + (line.spans[line.spans.length - 1]?.text.length ?? 0),
      });

      for (const span of line.spans) {
        // measureRun per span (bounded to span/word length — not paragraph length)
        const run = this.measurer.measureRun(span.text, span.font);

        for (let ci = 0; ci < span.text.length; ci++) {
          map.registerGlyph({
            docPos: span.docPos + ci,
            x: span.x + run.charPositions[ci]!,
            y,
            width: ci < span.text.length - 1
              ? run.charPositions[ci + 1]! - run.charPositions[ci]!
              : run.totalWidth - run.charPositions[ci]!,
            height: line.lineHeight,
            page: ctx.page,
            lineIndex,
          });
        }
      }

      y += line.lineHeight;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Token {
  text: string;
  font: string;
  docPos: number;
  marks?: Array<{ name: string; attrs: Record<string, unknown> }>;
}

/**
 * Splits InputSpans into word-level tokens.
 *
 * Keeps trailing spaces attached to their preceding word so that:
 *   "Hello world" → ["Hello ", "world"]
 *
 * This means measureWidth("Hello ") includes the space, which matters for
 * line-break decisions — the space is not free width.
 *
 * A new token is created whenever the font changes, so "bold" and "normal"
 * text in the same paragraph are never merged into a single token.
 */
function tokenise(spans: InputSpan[]): Token[] {
  const tokens: Token[] = [];

  for (const span of spans) {
    // Split on spaces but keep the space attached to the preceding word
    const parts = span.text.split(/(?<= )/);
    let offset = 0;

    for (const part of parts) {
      if (part.length === 0) continue;
      tokens.push({
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
 * Uses the tallest font on the line to determine line height.
 */
function buildLine(spans: LayoutSpan[], measurer: TextMeasurer): LayoutLine {
  let ascent = 0;
  let descent = 0;
  let lineHeight = 0;
  let width = 0;

  const seenFonts = new Set<string>();

  for (const span of spans) {
    if (!seenFonts.has(span.font)) {
      seenFonts.add(span.font);
      const m = measurer.getFontMetrics(span.font);
      if (m.ascent > ascent) ascent = m.ascent;
      if (m.descent > descent) descent = m.descent;
      if (m.lineHeight > lineHeight) lineHeight = m.lineHeight;
    }
    width += span.width;
  }

  return { spans, width, ascent, descent, lineHeight };
}
