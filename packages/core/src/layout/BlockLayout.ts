import { Node } from "prosemirror-model";
import type { FontModifier } from "../extensions/types";
import { TextMeasurer } from "./TextMeasurer";
import { LineBreaker, LayoutLine, InputSpan } from "./LineBreaker";
import { CharacterMap } from "./CharacterMap";
import {
  FontConfig,
  defaultFontConfig,
  getBlockStyle,
  BlockStyle,
} from "./FontConfig";
import { resolveFont, substituteFamily } from "./StyleResolver";

/** Extracts px size from a CSS font string like "bold 14px Georgia, serif". Returns null if not found. */
function parseFontSizePx(font: string): number | null {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]!) : null;
}

/**
 * Resolves the rendered height and block spacing for a leaf block node.
 *
 * Priority for height:
 *   1. `node.attrs.height` — explicit px height (images, embeds that store their own size)
 *   2. Font size × 1.5 from the block style (non-image leaf nodes like HR)
 *   3. `IMAGE_DEFAULT_HEIGHT` fallback when no fontConfig is available
 *
 * Priority for spacing:
 *   1. `blockStyle.spaceBefore` / `blockStyle.spaceAfter` from fontConfig
 *   2. `IMAGE_SPACE` default (used for images when no block style is registered)
 *
 * Exported so it can be used by tests and future embed/widget extensions
 * that define their own leaf block nodes.
 */
export function resolveLeafBlockDimensions(
  node: Node,
  fontConfig: FontConfig | undefined,
  imageDefaultHeight: number,
  imageDefaultSpace: number,
): { height: number; spaceBefore: number; spaceAfter: number } {
  const blockStyle = fontConfig
    ? getBlockStyle(fontConfig, node.type.name)
    : null;

  const attrH = node.attrs["height"];
  let height: number;
  if (typeof attrH === "number" && attrH > 0) {
    height = attrH;
  } else if (blockStyle) {
    const fontSize = parseFontSizePx(blockStyle.font);
    height = fontSize != null ? Math.round(fontSize * 1.5) : imageDefaultHeight;
  } else {
    height = imageDefaultHeight;
  }

  return {
    height,
    spaceBefore: blockStyle?.spaceBefore ?? imageDefaultSpace,
    spaceAfter: blockStyle?.spaceAfter ?? imageDefaultSpace,
  };
}

export interface LayoutBlock {
  /** The original ProseMirror node — used by BlockStrategy.render() */
  node: Node;
  /** ProseMirror position of this node in the document — used to map cursor positions to pages */
  nodePos: number;
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
  /**
   * True on the 2nd, 3rd, … visual parts of a block split across pages.
   * Suppresses the list marker and sets spaceBefore = 0 for continuation parts.
   */
  isContinuation?: boolean;
  /**
   * True on the 1st and middle parts of a split block (the block continues on the next page).
   * Sets spaceAfter = 0 and tells the renderer that the last rendered line here is NOT the
   * last line of the block (relevant for justify alignment's last-line exception).
   */
  continuesOnNextPage?: boolean;
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
  fontModifiers?: Map<string, FontModifier>;
}

// ── Constants ───────────────────────────────────────────────────────────────────
const IMAGE_DEFAULT_HEIGHT = 200;
const IMAGE_SPACE = 8;


/**
 * Layout for leaf block nodes that have no inline content (images, embeds).
 * Height comes from the node's `height` attr; a single line is registered in
 * the CharacterMap so click-to-place-cursor works near the block.
 */
export function layoutLeafBlock(
  node: Node,
  options: BlockLayoutOptions,
): LayoutBlock {
  const {
    nodePos,
    x,
    y,
    availableWidth,
    page,
    map,
    lineIndexOffset = 0,
    fontConfig,
  } = options;

  const { height, spaceBefore, spaceAfter } = resolveLeafBlockDimensions(
    node,
    fontConfig,
    IMAGE_DEFAULT_HEIGHT,
    IMAGE_SPACE,
  );

  // Leaf blocks expose two cursor positions: before (nodePos) and after
  // (nodePos + nodeSize). One line covers the full block height. Two
  // side-by-side half-width glyphs let posAtCoords distinguish left-click
  // (→ before) from right-click (→ after).
  const beforePos = nodePos;
  const afterPos  = nodePos + node.nodeSize;
  const halfWidth = availableWidth / 2;

  if (map) {
    const li = lineIndexOffset;

    if (!map.hasLine(page, li)) {
      map.registerLine({
        page, lineIndex: li,
        y, height,
        x, contentWidth: availableWidth,
        startDocPos: beforePos, endDocPos: afterPos,
      });
    }
    if (!map.hasGlyph(beforePos)) {
      map.registerGlyph({ docPos: beforePos, x, y, width: halfWidth, height, page, lineIndex: li });
    }
    if (!map.hasGlyph(afterPos)) {
      map.registerGlyph({ docPos: afterPos, x: x + halfWidth, y, width: halfWidth, height, page, lineIndex: li });
    }
  }

  const blockStyle = fontConfig
    ? getBlockStyle(fontConfig, node.type.name)
    : null;

  return {
    node,
    nodePos,
    x,
    y,
    width: availableWidth,
    height,
    lines: [],
    spaceBefore,
    spaceAfter,
    blockType: node.type.name,
    align: blockStyle?.align ?? "left",
    availableWidth,
  };
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
export function layoutBlock(
  node: Node,
  options: BlockLayoutOptions,
): LayoutBlock {
  // Leaf block nodes (no inline content): use fixed-height path.
  // TODO: Add isInline to extensions and use it here instead of isTextblock
  if (!node.childCount && !node.isTextblock)
    return layoutLeafBlock(node, options);

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

  // Node-level fontFamily attr overrides the block style's family.
  // Priority: node attr > fontConfig (which may already have page font applied) > blockStyle default.
  const nodeFontFamily = node.attrs["fontFamily"] as string | null | undefined;
  const baseFont = nodeFontFamily
    ? substituteFamily(blockStyle.font, nodeFontFamily)
    : blockStyle.font;

  // Per-node alignment attr overrides the static BlockStyle default.
  // Guards against garbage values — only the four known align strings are accepted.
  const VALID_ALIGNS = new Set(["left", "center", "right", "justify"]);
  const rawAlign = node.attrs["align"];
  const resolvedAlign: BlockStyle["align"] =
    typeof rawAlign === "string" && VALID_ALIGNS.has(rawAlign)
      ? (rawAlign as BlockStyle["align"])
      : blockStyle.align;

  // ── 1. Extract spans ──────────────────────────────────────────────────────
  const spans = extractSpans(
    node,
    nodePos,
    baseFont,
    fontConfig,
    fontModifiers,
  );

  // ── 2. Empty node fallback ────────────────────────────────────────────────
  // An empty paragraph has no spans. We create a virtual zero-width-space span
  // so LineBreaker returns one line and CharacterMap registers a cursor position.
  const inputSpans: InputSpan[] = spans.length
    ? spans
    : [{ text: "\u200B", font: baseFont, docPos: nodePos + 1 }];

  // ── 3. Break into lines ───────────────────────────────────────────────────
  const breaker = new LineBreaker(measurer);

  // We pass the CharacterMap only after we know the alignment offset.
  // If alignment is left (no offset), we can pass it directly.
  // For center/right we populate the map manually below after offsetting.
  const lines = breaker.breakIntoLines(inputSpans, availableWidth);

  // ── 4. Compute height ─────────────────────────────────────────────────────
  const height = lines.reduce((sum, l) => sum + l.lineHeight, 0);

  // ── 5. Populate CharacterMap with alignment-corrected positions ───────────
  if (map && lines.length) {
    let lineY = y;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const lineIndex = lineIndexOffset + li;

      // Alignment offset — critical: without this, click positions are wrong
      // for centered/right-aligned text
      const lineOffsetX = computeAlignmentOffset(
        resolvedAlign,
        availableWidth,
        line.width,
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

      let lastGlyph = { x: 0, width: 0, docPos: -1, isZws: false };

      for (const span of line.spans) {
        const run = measurer.measureRun(span.text, span.font);

        for (let ci = 0; ci < span.text.length; ci++) {
          const charX =
            x + // page left margin
            lineOffsetX + // alignment offset
            span.x + // span's x within the line
            run.charPositions[ci]!; // char's x within the span (kerning-aware)

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

          lastGlyph = {
            x: charX,
            width: charWidth,
            docPos: span.docPos + ci,
            isZws: span.text[ci] === "\u200B",
          };
        }
      }

      // Sentinel on last line only (same reasoning as populateCharMap above)
      if (
        li === lines.length - 1 &&
        lastGlyph.docPos >= 0 &&
        !lastGlyph.isZws
      ) {
        map.registerGlyph({
          docPos: lastGlyph.docPos + 1,
          x: lastGlyph.x + lastGlyph.width,
          y: lineY,
          width: 0,
          height: line.lineHeight,
          page,
          lineIndex,
        });
      }

      lineY += line.lineHeight;
    }
  }

  return {
    node,
    nodePos,
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
  fontModifiers?: Map<string, FontModifier>,
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
  lineWidth: number,
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
    const text =
      si === spans.length - 1 ? spans[si]!.text.trimEnd() : spans[si]!.text;
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
  // Leaf block (HR, image, etc.) — no lines, just before/after cursor positions.
  // One line covers the full block height. Two side-by-side half-width glyphs
  // let posAtCoords distinguish left-click (before) from right-click (after).
  if (block.lines.length === 0) {
    const beforePos = block.nodePos;
    const afterPos  = block.nodePos + block.node.nodeSize;
    const halfWidth = block.availableWidth / 2;
    const li        = lineIndexOffset;

    if (!map.hasLine(page, li)) {
      map.registerLine({
        page, lineIndex: li,
        y: block.y, height: block.height,
        x: block.x, contentWidth: block.availableWidth,
        startDocPos: beforePos, endDocPos: afterPos,
      });
    }
    // Left half → cursor before the block
    if (!map.hasGlyph(beforePos)) {
      map.registerGlyph({ docPos: beforePos, x: block.x, y: block.y, width: halfWidth, height: block.height, page, lineIndex: li });
    }
    // Right half → cursor after the block
    if (!map.hasGlyph(afterPos)) {
      map.registerGlyph({ docPos: afterPos, x: block.x + halfWidth, y: block.y, width: halfWidth, height: block.height, page, lineIndex: li });
    }
    return;
  }

  let lineY = block.y;

  for (let li = 0; li < block.lines.length; li++) {
    const line = block.lines[li]!;
    const globalLineIndex = lineIndexOffset + li;
    const isLastLine = li === block.lines.length - 1;

    const lineOffsetX = computeAlignmentOffset(
      block.align,
      block.availableWidth,
      line.width,
    );
    const spaceBonus = computeJustifySpaceBonus(
      block.align,
      line.spans,
      block.availableWidth,
      line.width,
      isLastLine,
    );

    map.registerLine({
      page,
      lineIndex: globalLineIndex,
      y: lineY,
      height: line.lineHeight,
      x: block.x,
      contentWidth: block.availableWidth,
      startDocPos: line.spans[0]?.docPos ?? block.nodePos + 1,
      endDocPos:
        (line.spans[line.spans.length - 1]?.docPos ?? block.nodePos + 1) +
        (line.spans[line.spans.length - 1]?.text.length ?? 0),
    });

    // Track the last non-ZWS glyph so we can register a zero-width sentinel
    // at endDocPos after the loop. Without this, coordsAtPos(endDocPos) falls
    // back to the preceding-glyph search which can return a glyph from the
    // wrong page and cause scrollCursorIntoView to scroll to the wrong place.
    let lastGlyph = { x: 0, width: 0, docPos: -1, isZws: false };
    let spacesBeforeSpan = 0;
    for (const span of line.spans) {
      const run = measurer.measureRun(span.text, span.font);
      let spacesWithinSpan = 0;

      for (let ci = 0; ci < span.text.length; ci++) {
        const charX =
          block.x +
          lineOffsetX +
          span.x +
          run.charPositions[ci]! +
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

        lastGlyph = {
          x: charX,
          width: charWidth,
          docPos: span.docPos + ci,
          isZws: span.text[ci] === "\u200B",
        };

        if (span.text[ci] === " ") spacesWithinSpan++;
      }

      spacesBeforeSpan += countSpaces(span.text);
    }

    // Register end-of-line caret sentinel at the position just past the last
    // real character — but only on the LAST line of the block.
    //
    // Why only last line? For wrapped paragraphs, the endDocPos of an
    // intermediate line equals the docPos of the first character on the next
    // line — that glyph is registered when the next line is processed, so no
    // sentinel is needed (and adding one would create a duplicate that
    // corrupts coordsAtPos for the first char of the next line).
    //
    // Why at all? Without this, coordsAtPos(endDocPos) falls back to the
    // preceding-glyph search which returns glyphs in registration order
    // (reversed). Cursor-page glyphs are registered first, so other pages'
    // glyphs appear last in the reversed search — causing coordsAtPos to
    // return coords from the wrong page and scrollCursorIntoView to scroll
    // to the wrong position.
    //
    // Skip ZWS lines (empty paragraphs): their only valid cursor position is
    // the ZWS docPos itself, which is already registered as a glyph above.
    if (lastGlyph.docPos >= 0 && !lastGlyph.isZws && isLastLine) {
      map.registerGlyph({
        docPos: lastGlyph.docPos + 1,
        x: lastGlyph.x + lastGlyph.width,
        y: lineY,
        width: 0,
        height: line.lineHeight,
        page,
        lineIndex: globalLineIndex,
      });
    }

    lineY += line.lineHeight;
  }
}

export function countSpaces(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === " ") n++;
  return n;
}
