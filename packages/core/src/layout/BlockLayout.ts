import { Node } from "prosemirror-model";
import { TextMeasurer } from "./TextMeasurer";
import { LineBreaker, LayoutLine, InputSpan } from "./LineBreaker";
import { CharacterMap } from "./CharacterMap";
import { FontConfig, defaultFontConfig, getBlockStyle, BlockStyle } from "./FontConfig";
import { resolveFont } from "./StyleResolver";

// ── Table layout types ────────────────────────────────────────────────────────

/** A single laid-out cell inside a table. */
export interface TableCellLayout {
  /** Absolute ProseMirror position of the tableCell node. */
  nodePos: number;
  /** Left edge of the cell (border-box, includes left border). */
  x: number;
  /** Top edge of the cell (border-box, includes top border). */
  y: number;
  /** Cell width (content + padding, excludes borders). */
  width: number;
  /** Cell height (content + padding, normalised to row max). */
  height: number;
  /** Laid-out content blocks inside the cell (one per child paragraph/block). */
  contentBlocks: LayoutBlock[];
  rowIndex: number;
  colIndex: number;
}

/** Attached to a "table" LayoutBlock so the render strategy can access grid data. */
export interface TableData {
  cells: TableCellLayout[];
  numRows: number;
  numCols: number;
  colWidths: number[];
  rowHeights: number[];
}

// ─────────────────────────────────────────────────────────────────────────────

export interface LayoutBlock {
  /** The original ProseMirror node — used by BlockStrategy.render() */
  node: Node;
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
  /** Bullet character or ordered number string (e.g. "•", "1."). Present on list item blocks only. */
  listMarker?: string;
  /** Absolute x position to draw the list marker — to the left of the indented text. */
  listMarkerX?: number;
  /** Grid data attached by layoutTable(). Present on "table" blocks only. */
  tableData?: TableData;
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
  /** Mark name → font modifier. When provided, resolveFont uses it instead of the built-in switch. */
  fontModifiers?: Map<string, import("../extensions/types").FontModifier>;
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
    fontModifiers,
  } = options;

  const fontConfig = options.fontConfig ?? defaultFontConfig;
  const level = node.attrs["level"] as number | undefined;
  const blockStyle = getBlockStyle(fontConfig, node.type.name, level);

  // Per-node alignment attr overrides the static BlockStyle default.
  // Guards against garbage values — only the four known align strings are accepted.
  const VALID_ALIGNS = new Set(["left", "center", "right", "justify"]);
  const rawAlign = node.attrs["align"];
  const resolvedAlign: BlockStyle["align"] =
    (typeof rawAlign === "string" && VALID_ALIGNS.has(rawAlign))
      ? (rawAlign as BlockStyle["align"])
      : blockStyle.align;

  // ── 1. Extract spans ──────────────────────────────────────────────────────
  const spans = extractSpans(node, nodePos, blockStyle.font, fontConfig, fontModifiers);

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
        resolvedAlign,
        availableWidth,
        line.width
      );

      map.registerLine({
        page,
        lineIndex,
        y: lineY,
        height: line.lineHeight,
        x,
        contentWidth: availableWidth,
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
    node,
    x,
    y,
    width: availableWidth,
    height,
    lines,
    spaceBefore: blockStyle.spaceBefore,
    spaceAfter: blockStyle.spaceAfter,
    blockType: node.type.name,
    align: resolvedAlign,
    availableWidth,
    // listMarker and listMarkerX are set by layoutDocument for list items
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
  _fontConfig: FontConfig,
  fontModifiers?: Map<string, import("../extensions/types").FontModifier>
): InputSpan[] {
  const spans: InputSpan[] = [];

  node.forEach((child, offset) => {
    if (!child.isText || !child.text) return;

    const font = resolveFont(baseFont, child.marks, fontModifiers);
    spans.push({
      text: child.text,
      font,
      docPos: nodePos + 1 + offset,
      marks: child.marks.map((m) => ({
        name: m.type.name,
        attrs: m.attrs as Record<string, unknown>,
      })),
    });
  });

  return spans;
}

/**
 * Computes the x offset to apply to a line for text alignment.
 * Justify uses per-space expansion (see computeJustifySpaceBonus) — returns 0 here.
 */
export function computeAlignmentOffset(
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

/**
 * Returns the extra width added to each space character for justify alignment.
 *
 * The last line of a block stays left-aligned (standard CSS justify behaviour).
 * Returns 0 for any other alignment or when there are no expandable spaces.
 */
export function computeJustifySpaceBonus(
  align: BlockStyle["align"],
  spans: LayoutLine["spans"],
  availableWidth: number,
  lineWidth: number,
  isLastLine: boolean,
): number {
  if (align !== "justify" || isLastLine) return 0;
  const extraSpace = availableWidth - lineWidth;
  if (extraSpace <= 0) return 0;

  let spaceCount = 0;
  for (let si = 0; si < spans.length; si++) {
    // Trailing spaces on the last span don't get expanded
    const text = si === spans.length - 1 ? spans[si]!.text.trimEnd() : spans[si]!.text;
    for (const ch of text) {
      if (ch === " ") spaceCount++;
    }
  }
  return spaceCount > 0 ? extraSpace / spaceCount : 0;
}

/**
 * Populates a CharacterMap from a finalized LayoutBlock.
 *
 * Called by Editor.ensureLayout() so charMap has glyph positions immediately
 * after layout — before the render cycle. This enables syncInputBridge() and
 * scrollCursorIntoView() to work synchronously inside dispatch().
 *
 * The renderer's own charMap population (in PageRenderer.drawBlock) is guarded
 * by hasGlyph/hasLine checks, so no duplicate entries are created.
 */
export function populateCharMap(
  block: LayoutBlock,
  map: CharacterMap,
  page: number,
  lineIndexOffset: number,
  measurer: TextMeasurer,
): void {
  let lineY = block.y;

  for (let li = 0; li < block.lines.length; li++) {
    const line = block.lines[li]!;
    const globalLineIndex = lineIndexOffset + li;
    const isLastLine = li === block.lines.length - 1;

    const lineOffsetX = computeAlignmentOffset(block.align, block.availableWidth, line.width);
    const spaceBonus = computeJustifySpaceBonus(
      block.align, line.spans, block.availableWidth, line.width, isLastLine,
    );

    map.registerLine({
      page,
      lineIndex: globalLineIndex,
      y: lineY,
      height: line.lineHeight,
      x: block.x,
      contentWidth: block.availableWidth,
      startDocPos: line.spans[0]?.docPos ?? 0,
      endDocPos:
        (line.spans[line.spans.length - 1]?.docPos ?? 0) +
        (line.spans[line.spans.length - 1]?.text.length ?? 0),
    });

    let spacesBeforeSpan = 0;
    for (const span of line.spans) {
      const run = measurer.measureRun(span.text, span.font);
      let spacesWithinSpan = 0;

      for (let ci = 0; ci < span.text.length; ci++) {
        const charX =
          block.x + lineOffsetX + span.x + run.charPositions[ci]! +
          (spacesBeforeSpan + spacesWithinSpan) * spaceBonus;
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
          lineIndex: globalLineIndex,
        });

        if (span.text[ci] === " ") spacesWithinSpan++;
      }

      spacesBeforeSpan += countSpaces(span.text);
    }

    lineY += line.lineHeight;
  }
}

function countSpaces(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === " ") n++;
  return n;
}
