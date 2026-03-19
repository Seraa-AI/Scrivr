import { Node } from "prosemirror-model";
import { TextMeasurer } from "./TextMeasurer";
import { LineBreaker, LayoutLine, InputSpan } from "./LineBreaker";
import { CharacterMap } from "./CharacterMap";
import { FontConfig, defaultFontConfig, getBlockStyle, BlockStyle } from "./FontConfig";
import { resolveFont } from "./StyleResolver";

export interface LayoutBlock {
  /** Absolute x position — left margin, set by caller */
  x: number;
  /** Absolute y position — top of this block, set by PageLayout */
  y: number;
  width: number;
  /** Total height of lines only — excludes spaceBefore/spaceAfter */
  height: number;
  /** Lines with 0-based indices — PageLayout adds global offset */
  lines: LayoutLine[];
  /** Exported as metadata — PageLayout uses these for margin collapsing */
  spaceBefore: number;
  spaceAfter: number;
  blockType: string;
  /** Text alignment — needed by renderer to offset line x */
  align: BlockStyle["align"];
  /** Available width — renderer needs this to compute alignment offsets */
  availableWidth: number;
}

export interface BlockLayoutOptions {
  /** Absolute doc position of this node — used to resolve child positions */
  nodePos: number;
  /** Left edge in CSS pixels (the page's left margin) */
  x: number;
  /** Top edge in CSS pixels — set by PageLayout */
  y: number;
  /** Content width: page width minus left and right margins */
  availableWidth: number;
  /** Which page this block sits on — passed to CharacterMap */
  page: number;
  fontConfig?: FontConfig;
  measurer: TextMeasurer;
  /** Optional — populate if you want hit-testing on this block */
  map?: CharacterMap;
  /**
   * Global line index offset — the total number of lines registered into
   * the CharacterMap before this block. LineBreaker uses 0-based indices;
   * PageLayout increments this counter as it stacks blocks.
   */
  lineIndexOffset?: number;
}

/**
 * BlockLayout — positions a single ProseMirror block node.
 *
 * Responsibilities:
 *   1. Extract InputSpans from inline children (resolving mark → font)
 *   2. Handle empty nodes via a virtual zero-width-space span
 *   3. Call LineBreaker to wrap spans into lines
 *   4. Apply alignment offset to CharacterMap glyph x positions
 *   5. Return a positioned LayoutBlock (relative line indices, no spacing baked in)
 *
 * Does NOT:
 *   - Decide page breaks
 *   - Handle margin collapsing
 *   - Render anything
 */
export function layoutBlock(node: Node, options: BlockLayoutOptions): LayoutBlock {
  const {
    nodePos,
    x,
    y,
    availableWidth,
    page,
    measurer,
    map,
    lineIndexOffset = 0,
  } = options;

  const fontConfig = options.fontConfig ?? defaultFontConfig;
  const level = node.attrs["level"] as number | undefined;
  const blockStyle = getBlockStyle(fontConfig, node.type.name, level);

  // ── 1. Extract spans ──────────────────────────────────────────────────────
  const spans = extractSpans(node, nodePos, blockStyle.font, fontConfig);

  // ── 2. Empty node fallback ────────────────────────────────────────────────
  // An empty paragraph has no spans. We create a virtual zero-width-space span
  // so LineBreaker returns one line and CharacterMap registers a cursor position.
  const inputSpans: InputSpan[] =
    spans.length > 0
      ? spans
      : [{ text: "\u200B", font: blockStyle.font, docPos: nodePos + 1 }];

  // ── 3. Break into lines ───────────────────────────────────────────────────
  const breaker = new LineBreaker(measurer);

  // We pass the CharacterMap only after we know the alignment offset.
  // If alignment is left (no offset), we can pass it directly.
  // For center/right we populate the map manually below after offsetting.
  const lines = breaker.breakIntoLines(inputSpans, availableWidth);

  // ── 4. Compute height ─────────────────────────────────────────────────────
  const height = lines.reduce((sum, l) => sum + l.lineHeight, 0);

  // ── 5. Populate CharacterMap with alignment-corrected positions ───────────
  if (map && lines.length > 0) {
    let lineY = y;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const lineIndex = lineIndexOffset + li;

      // Alignment offset — critical: without this, click positions are wrong
      // for centered/right-aligned text
      const lineOffsetX = computeAlignmentOffset(
        blockStyle.align,
        availableWidth,
        line.width
      );

      map.registerLine({
        page,
        lineIndex,
        y: lineY,
        height: line.lineHeight,
        startDocPos: line.spans[0]?.docPos ?? nodePos + 1,
        endDocPos:
          (line.spans[line.spans.length - 1]?.docPos ?? nodePos + 1) +
          (line.spans[line.spans.length - 1]?.text.length ?? 0),
      });

      for (const span of line.spans) {
        const run = measurer.measureRun(span.text, span.font);

        for (let ci = 0; ci < span.text.length; ci++) {
          const charX =
            x +                          // page left margin
            lineOffsetX +                // alignment offset
            span.x +                     // span's x within the line
            run.charPositions[ci]!;      // char's x within the span (kerning-aware)

          const charWidth =
            ci < span.text.length - 1
              ? run.charPositions[ci + 1]! - run.charPositions[ci]!
              : run.totalWidth - run.charPositions[ci]!;

          map.registerGlyph({
            docPos: span.docPos + ci,
            x: charX,
            y: lineY,
            width: charWidth,
            height: line.lineHeight,
            page,
            lineIndex,
          });
        }
      }

      lineY += line.lineHeight;
    }
  }

  return {
    x,
    y,
    width: availableWidth,
    height,
    lines,
    spaceBefore: blockStyle.spaceBefore,
    spaceAfter: blockStyle.spaceAfter,
    blockType: node.type.name,
    align: blockStyle.align,
    availableWidth,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Walks a block node's inline children and produces InputSpan[].
 *
 * ProseMirror position arithmetic:
 *   - nodePos is the position BEFORE the node's opening token
 *   - nodePos + 1 is inside the node (after the opening token)
 *   - nodePos + 1 + offset is the absolute position of a child at `offset`
 */
function extractSpans(
  node: Node,
  nodePos: number,
  baseFont: string,
  _fontConfig: FontConfig
): InputSpan[] {
  const spans: InputSpan[] = [];

  node.forEach((child, offset) => {
    if (!child.isText || !child.text) return;

    const font = resolveFont(baseFont, child.marks);
    spans.push({
      text: child.text,
      font,
      docPos: nodePos + 1 + offset,
    });
  });

  return spans;
}

/**
 * Computes the x offset to apply to a line for text alignment.
 * justify is not yet implemented — falls back to left.
 */
function computeAlignmentOffset(
  align: BlockStyle["align"],
  availableWidth: number,
  lineWidth: number
): number {
  switch (align) {
    case "center":
      return Math.max(0, (availableWidth - lineWidth) / 2);
    case "right":
      return Math.max(0, availableWidth - lineWidth);
    case "justify":
    case "left":
    default:
      return 0;
  }
}
