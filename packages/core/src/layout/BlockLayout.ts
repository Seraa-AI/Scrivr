import { Node } from "prosemirror-model";
import type { FontModifier } from "../extensions/types";
import type { TextMeasurerLike } from "./TextMeasurer";
import type { InlineRegistry } from "./BlockRegistry";
import { normalizeImageAttrs } from "./AnchoredObjects";
import { LineBreaker, LayoutLine, InputSpan, spanEndDocPos, computeObjectRenderY, type InlineObjectVerticalAlign, type LineSpaceProvider } from "./LineBreaker";
import { CharacterMap } from "./CharacterMap";
import {
  FontConfig,
  defaultFontConfig,
  getBlockStyle,
  BlockStyle,
} from "./FontConfig";
import { resolveFont, substituteFamily, parseFont } from "./StyleResolver";
import { layoutTableRowCells } from "./TableLayoutEngine";

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

/**
 * Discriminator for the variety of block this LayoutBlock represents.
 *
 *   - `"text"`     — block contributes textual lines that drive rendering and
 *                    cursor placement (paragraph, heading, list_item, codeBlock).
 *                    `lines` is non-empty (anchor-only paragraphs hold a single
 *                    hidden line — still "text").
 *   - `"leaf"`     — block has no inline content and contributes no lines
 *                    (image, horizontalRule, pageBreak, and inline-atom
 *                    sub-blocks dispatched by the PDF exporter). `lines` is `[]`.
 *   - `"tableRow"` — produced by the Table extension; carries per-cell
 *                    sub-blocks (`cells`) instead of `lines`. `lines` is `[]`.
 *                    In Phase 1 the row is a fixed-height placeholder with
 *                    `cells: []`; Phase 4 fills `cells` with sandboxed cell
 *                    layouts.
 *
 * Consumers branch on `kind` instead of probing `lines.length === 0`, so the
 * shape of the discriminator is the single source of truth for renderer,
 * pagination, hit-testing, and export dispatch.
 */
export type LayoutBlockKind = "text" | "leaf" | "tableRow";

/**
 * One cell laid out inside a `kind: "tableRow"` LayoutBlock. Phase 1 always
 * carries an empty `cells` array; Phase 4 populates this with cell bounds and
 * the cell's child block layouts.
 */
export interface CellSubBlock {
  /** ProseMirror position of the tableCell or tableHeader node. */
  cellPos: number;
  /** Absolute x position of the cell in CSS pixels. */
  x: number;
  /** Absolute y position of the cell in CSS pixels. */
  y: number;
  /** Cell width including padding. */
  width: number;
  /** Cell height including padding. */
  height: number;
  /** Vertical-merge state from the cell node — drives render border ownership. */
  vMerge: "none" | "restart" | "continue";
  /** Cell background color, or null. */
  background: string | null;
  /** Layout for the cell's child blocks. Empty array in Phase 1. */
  blocks: LayoutBlock[];
}

export interface LayoutBlock {
  /** Discriminator — see LayoutBlockKind for the invariants per variant. */
  kind: LayoutBlockKind;
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
  /**
   * 0-based index of this visual part within its source block.
   * 0 = first (or only) part. Absent on unsplit blocks (treat as 0).
   */
  fragmentIndex?: number;
  /**
   * Total number of visual parts this source block was split into.
   * Absent on unsplit blocks (treat as 1).
   */
  fragmentCount?: number;
  /**
   * nodePos of the original unsplit source block.
   * Same as nodePos for the first part; allows grouping all parts of a split back to their origin.
   */
  sourceNodePos?: number;
  /**
   * Sub-cell layouts for `kind: "tableRow"` blocks. Empty in Phase 1; Phase 4
   * fills this with the cell rectangles and their child block layouts.
   */
  cells?: CellSubBlock[];
  /** True for the last row of a table — only it paints the table's bottom border. */
  isLastRow?: boolean;
}

export function isHiddenAnchorLine(line: LayoutLine): boolean {
  return (
    line.lineHeight === 0 &&
    line.cursorHeight === 0 &&
    line.spans.length > 0 &&
    line.spans.every((span) => span.kind === "object" && span.width === 0 && span.height === 0)
  );
}

function createHiddenAnchorLine(spans: InputSpan[]): LayoutLine {
  return {
    spans: spans
      .filter((span) => span.kind === "object")
      .map((span) => ({
        kind: "object" as const,
        node: span.node,
        x: 0,
        width: 0,
        height: 0,
        docPos: span.docPos,
        verticalAlign: span.verticalAlign,
      })),
    width: 0,
    ascent: 0,
    descent: 0,
    lineHeight: 0,
    textAscent: 0,
    cursorHeight: 0,
    xHeight: 0,
  };
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
  measurer: TextMeasurerLike;
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
  /**
   * Optional exclusion constraint provider — narrows line width around anchored
   * object exclusion rectangles. When provided, each line queries this function
   * at its absolute Y position to get a { x, width } override. Absent = default
   * maxWidth behaviour.
   */
  lineSpaceProvider?: LineSpaceProvider;
  /** Inline object registry — used to call measure() on tokens during layout. */
  inlineRegistry?: InlineRegistry | undefined;
  /**
   * Column widths (CSS px) for a `tableRow` node, from the parent table's
   * `grid` attr. Only consulted when laying out a `tableRow`; ignored for
   * every other block kind.
   */
  tableColumns?: number[];
}

// ── Constants ───────────────────────────────────────────────────────────────────
const IMAGE_DEFAULT_HEIGHT = 200;
const IMAGE_SPACE = 8;
/** Fallback column width when a table row is laid out without a `grid`. */
const TABLE_DEFAULT_COLUMN_WIDTH = 100;


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
      map.registerGlyph({ docPos: beforePos, x, y, lineY: y, width: halfWidth, height, page, lineIndex: li });
    }
    if (!map.hasGlyph(afterPos)) {
      map.registerGlyph({ docPos: afterPos, x: x + halfWidth, y, lineY: y, width: halfWidth, height, page, lineIndex: li });
    }
  }

  const blockStyle = fontConfig
    ? getBlockStyle(fontConfig, node.type.name)
    : null;

  return {
    kind: "leaf",
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


/** Sum of `gridSpan` across a row's physical cells — the column count. */
function rowColumnCount(rowNode: Node): number {
  let n = 0;
  rowNode.forEach((cell) => {
    const v = cell.attrs["gridSpan"];
    n += typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 1;
  });
  return n;
}

/**
 * Layout for a `tableRow` node: delegates to `TableLayoutEngine` to lay out
 * each cell's child blocks inside its column box and size the row to its
 * tallest cell. Column widths come from `options.tableColumns` (the parent
 * table's `grid`); when absent, a uniform default grid is derived from the
 * row's column count so a row is never zero-width.
 */
export function layoutTableRow(
  node: Node,
  options: BlockLayoutOptions,
): LayoutBlock {
  const { nodePos, x, y, availableWidth, page, measurer, fontConfig, fontModifiers, inlineRegistry, tableColumns } = options;

  const columns =
    tableColumns && tableColumns.length > 0
      ? tableColumns
      : Array.from({ length: Math.max(rowColumnCount(node), 1) }, () => TABLE_DEFAULT_COLUMN_WIDTH);

  const { cells, height } = layoutTableRowCells(node, {
    x,
    columns,
    availableWidth,
    page,
    rowNodePos: nodePos,
    measurer,
    ...(fontConfig ? { fontConfig } : {}),
    ...(fontModifiers ? { fontModifiers } : {}),
    ...(inlineRegistry ? { inlineRegistry } : {}),
  });

  return {
    kind: "tableRow",
    node,
    nodePos,
    x,
    y,
    width: availableWidth,
    height,
    lines: [],
    cells,
    spaceBefore: 0,
    spaceAfter: 0,
    blockType: "tableRow",
    align: "left",
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
  // Table rows are atomic units in v1: dispatch to the stub row engine.
  if (node.type.name === "tableRow") return layoutTableRow(node, options);
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
    lineSpaceProvider,
    inlineRegistry,
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
    measurer,
    inlineRegistry,
  );

  // ── 2. Empty node fallback ────────────────────────────────────────────────
  // An empty paragraph (or one containing only hardBreak nodes) has no
  // renderable content. We create a virtual zero-width-space span so
  // LineBreaker returns one line and CharacterMap registers a cursor position.
  //
  // Anchor-only paragraphs are different: a paragraph whose only content is
  // non-inline image sentinels is structural ownership, not visible document
  // content. Preserve those zero-size object spans so anchored-object layout
  // can find them, but do not inject a ZWS. That yields a zero-height flow
  // instead of the blank line users were seeing behind floating images.
  const hasNonZeroContent = spans.some(
    (s) =>
      s.kind === "text" ||
      (s.kind === "object" && (s.width > 0 || s.height > 0)),
  );
  const hasZeroSizeObjectSentinel = spans.some(
    (s) => s.kind === "object" && s.width === 0 && s.height === 0,
  );
  const isAnchorOnlyFlow = !hasNonZeroContent && hasZeroSizeObjectSentinel;
  if (isAnchorOnlyFlow) {
    return {
      kind: "text",
      node,
      nodePos,
      x,
      y,
      width: availableWidth,
      height: 0,
      lines: [createHiddenAnchorLine(spans)],
      spaceBefore: 0,
      spaceAfter: 0,
      blockType: node.type.name,
      align: resolvedAlign,
      availableWidth,
    };
  }

  const zwsSpan: InputSpan = {
    kind: "text",
    text: "​",
    font: baseFont,
    docPos: nodePos + 1,
  };
  const inputSpans: InputSpan[] = hasNonZeroContent ? spans : [zwsSpan];

  // ── 3. Break into lines ───────────────────────────────────────────────────
  const breaker = new LineBreaker(measurer);

  // First-line indent: reduce first line's width so text wraps earlier.
  const rawTextIndent = node.attrs["textIndent"];
  const textIndent = typeof rawTextIndent === "number" && rawTextIndent > 0 ? rawTextIndent : 0;

  // Wrap the line-space provider to apply textIndent on the first line.
  let firstLineConsumed = false;
  const indentAwareLineSpace: LineSpaceProvider | undefined =
    textIndent > 0
      ? (lineY: number, lineHeight: number) => {
          // Forward the real line height so the float-exclusion probe inside the
          // provider tests the line's true vertical extent (a 1px probe leaves a
          // straddling first line full-width under a float's top edge).
          const base = lineSpaceProvider?.(lineY, lineHeight) ?? { segments: [{ x: 0, width: availableWidth }] };
          if (!firstLineConsumed) {
            firstLineConsumed = true;
            return {
              ...base,
              segments: base.segments
                .map((segment, index) =>
                  index === 0
                    ? { x: segment.x + textIndent, width: Math.max(0, segment.width - textIndent) }
                    : segment,
                )
                .filter((segment) => segment.width > 0),
            };
          }
          return base;
        }
      : lineSpaceProvider;

  // We pass the CharacterMap only after we know the alignment offset.
  // If alignment is left (no offset), we can pass it directly.
  // For center/right we populate the map manually below after offsetting.
  const parsedBase = parseFont(baseFont);
  const lines = breaker.breakIntoLines(
    inputSpans,
    availableWidth,
    {
      defaultFontFamily: parsedBase.family,
      defaultFontSize: parseFloat(parsedBase.size),
      ...(indentAwareLineSpace ? { lineSpaceProvider: indentAwareLineSpace, startY: y } : {}),
    },
  );

  // ── 4. Compute height ─────────────────────────────────────────────────────
  const height = lines.reduce((sum, l) => sum + l.lineHeight, 0);

  // ── 5. Populate CharacterMap with alignment-corrected positions ───────────
  if (map && lines.length) {
    let lineY = y;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      if (isHiddenAnchorLine(line)) continue;

      const lineIndex = lineIndexOffset + li;
      const isLastLine = li === lines.length - 1;

      const lineOffsetX = line.positioned
        ? 0
        : computeAlignmentOffset(
            resolvedAlign,
            availableWidth,
            line.width,
          );

      // textY: top of the cursor rectangle for text glyphs.
      // When a baseline image inflates line.ascent, text sits at the bottom of
      // the line. Align text cursor to the actual text position, not the full line.
      const textY = line.textAscent > 0
        ? lineY + line.ascent - line.textAscent
        : lineY + Math.max(0, line.lineHeight - line.cursorHeight) / 2;

      const lastLineSpan = line.spans[line.spans.length - 1];
      map.registerLine({
        page,
        lineIndex,
        y: lineY,
        height: line.lineHeight,
        x,
        contentWidth: availableWidth,
        startDocPos: line.spans[0]?.docPos ?? nodePos + 1,
        endDocPos: lastLineSpan ? spanEndDocPos(lastLineSpan) : nodePos + 1,
      });

      let lastGlyph = { x: 0, width: 0, docPos: -1, isZws: false, isObject: false };

      for (const span of line.spans) {
        if (span.kind === "object") {
          const objX = x + lineOffsetX + span.x;
          // y = textY so cursor draws at the text baseline, not image top.
          map.registerGlyph({
            docPos: span.docPos,
            x: objX,
            y: textY,
            lineY,
            width: span.width,
            height: line.cursorHeight,
            page,
            lineIndex,
          });
          map.registerGlyph({
            docPos: span.docPos + 1,
            x: objX + span.width,
            y: textY,
            lineY,
            width: 0,
            height: line.cursorHeight,
            page,
            lineIndex,
          });
          lastGlyph = { x: objX + span.width, width: 0, docPos: span.docPos, isZws: false, isObject: true };
          continue;
        }

        const run = measurer.measureRun(span.text, span.font);
        for (let ci = 0; ci < span.text.length; ci++) {
          const charX =
            x +
            lineOffsetX +
            span.x +
            run.charPositions[ci]!;
          const charWidth =
            ci < span.text.length - 1
              ? run.charPositions[ci + 1]! - run.charPositions[ci]!
              : run.totalWidth - run.charPositions[ci]!;

          map.registerGlyph({
            docPos: span.docPos + ci,
            x: charX,
            y: textY,
            lineY,
            width: charWidth,
            height: line.cursorHeight,
            page,
            lineIndex,
          });

          lastGlyph = {
            x: charX,
            width: charWidth,
            docPos: span.docPos + ci,
            isZws: span.text[ci] === "\u200B",
            isObject: false,
          };
        }
      }

      // Register end-of-line sentinel at the position just past the last real
      // character — but only on the LAST line, and only when the last span was
      // text (object spans already register a right-half glyph at docPos+1).
      if (isLastLine && lastGlyph.docPos >= 0 && !lastGlyph.isZws && !lastGlyph.isObject) {
        map.registerGlyph({
          docPos: lastGlyph.docPos + 1,
          x: lastGlyph.x + lastGlyph.width,
          y: textY,
          lineY,
          width: 0,
          height: line.cursorHeight,
          page,
          lineIndex,
        });
      }

      lineY += line.lineHeight;
    }
  }

  return {
    kind: "text",
    node,
    nodePos,
    x,
    y,
    width: availableWidth,
    height,
    lines,
    spaceBefore: isAnchorOnlyFlow ? 0 : blockStyle.spaceBefore,
    spaceAfter: isAnchorOnlyFlow ? 0 : blockStyle.spaceAfter,
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
  measurer?: TextMeasurerLike,
  inlineRegistry?: InlineRegistry,
): InputSpan[] {
  const spans: InputSpan[] = [];

  node.forEach((child, offset) => {
    const childDocPos = nodePos + 1 + offset;

    if (child.isText && child.text) {
      const font = resolveFont(baseFont, child.marks, fontModifiers);
      spans.push({
        kind: "text",
        text: child.text,
        font,
        docPos: childDocPos,
        marks: child.marks.map((m) => ({
          name: m.type.name,
          attrs: m.attrs as Record<string, unknown>,
        })),
      });
      return;
    }

    // Hard line break: flush the current line and start a new one.
    if (child.type.name === "hardBreak") {
      spans.push({ kind: "break", docPos: childDocPos });
      return;
    }

    // Inline non-text leaf node (image, widget, …).
    // Guard: only nodes with explicit numeric width/height attrs are inline
    // objects. Structural inline leaves like hardBreak have no size attrs and
    // must NOT be treated as inline objects — doing so would give them a 200px
    // height and create huge blank line boxes.
    if (child.isLeaf && !child.isText) {
      const w = child.attrs["width"] as number | null | undefined;
      const h = child.attrs["height"] as number | null | undefined;
      if (typeof w === "number" || typeof h === "number") {
        // Anchored-object anchor span: when the image's resolved wrapMode is
        // anything other than "inline", emit a zero-width/zero-height object
        // span. This keeps the doc position in the line box but contributes
        // no line width or height — PageLayout's resolveAnchoredObjects pass
        // places the visible image at its xAlign/x and creates the wrap
        // zone. Read through normalizeImageAttrs so both new (`wrapMode`)
        // and legacy (`wrappingMode`) attribute sets are honoured.
        const isFloat =
          child.type.name === "image" &&
          normalizeImageAttrs(child).wrapMode !== "inline";

        if (isFloat) {
          spans.push({
            kind: "object",
            node: child,
            docPos: childDocPos,
            width: 0,   // zero width: does not affect line breaking
            height: 0,  // zero height: does not affect line height
            verticalAlign: "baseline",
          });
          return;
        }

        // Option B: node attr takes precedence; fall back to "baseline".
        const rawAlign = child.attrs["verticalAlign"];
        const verticalAlign: InlineObjectVerticalAlign =
          rawAlign === "baseline" ||
          rawAlign === "middle" ||
          rawAlign === "top" ||
          rawAlign === "bottom" ||
          rawAlign === "text-top" ||
          rawAlign === "text-bottom"
            ? rawAlign
            : "baseline";
        let objWidth = typeof w === "number" ? w : 200;
        let objHeight = typeof h === "number" ? h : 200;

        // If an InlineStrategy provides measure(), use it for dynamic sizing.
        // Tokens (pageNumber, totalPages, date) use this to size based on font.
        if (measurer && inlineRegistry) {
          const strategy = inlineRegistry.get(child.type.name);
          if (strategy?.measure) {
            const font = resolveFont(baseFont, child.marks, fontModifiers);
            const measured = strategy.measure(child, font, measurer);
            objWidth = measured.width;
            objHeight = measured.height;
          }
        }

        spans.push({
          kind: "object",
          node: child,
          docPos: childDocPos,
          width: objWidth,
          height: objHeight,
          verticalAlign,
        });
      }
    }
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
    const span = spans[si]!;
    if (span.kind !== "text") continue; // object spans have no spaces
    const text = si === spans.length - 1 ? span.text.trimEnd() : span.text;
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
/**
 * Number of CharacterMap line indices a block occupies — the amount the caller
 * advances the page-global line offset after registering this block. Text
 * blocks contribute one per line; leaf blocks one; table rows the sum across
 * every cell's child blocks.
 */
export function registeredLineCount(block: LayoutBlock): number {
  if (block.kind === "leaf") return 1;
  if (block.kind === "tableRow") {
    let n = 0;
    for (const cell of block.cells ?? []) {
      for (const child of cell.blocks) {
        n += child.kind === "leaf" ? 1 : child.lines.length;
      }
    }
    return n;
  }
  return block.lines.length;
}

export function populateCharMap(
  block: LayoutBlock,
  map: CharacterMap,
  page: number,
  lineIndexOffset: number,
  measurer: TextMeasurerLike,
): void {
  // Leaf block (HR, image, etc.) — no lines, just before/after cursor positions.
  // One line covers the full block height. Two side-by-side half-width glyphs
  // let posAtCoords distinguish left-click (before) from right-click (after).
  if (block.kind === "leaf") {
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
      map.registerGlyph({ docPos: beforePos, x: block.x, y: block.y, lineY: block.y, width: halfWidth, height: block.height, page, lineIndex: li });
    }
    // Right half → cursor after the block
    if (!map.hasGlyph(afterPos)) {
      map.registerGlyph({ docPos: afterPos, x: block.x + halfWidth, y: block.y, lineY: block.y, width: halfWidth, height: block.height, page, lineIndex: li });
    }
    return;
  }

  // Table row: register each cell's child blocks at their absolute y (the row
  // block's final y plus the child's row-relative offset). Recursion reuses the
  // text/leaf branches above for the actual cell content.
  if (block.kind === "tableRow") {
    let offset = lineIndexOffset;
    for (const cell of block.cells ?? []) {
      for (const child of cell.blocks) {
        const absolute: LayoutBlock = { ...child, y: block.y + child.y };
        populateCharMap(absolute, map, page, offset, measurer);
        offset += child.kind === "leaf" ? 1 : child.lines.length;
      }
    }
    return;
  }

  let lineY = block.y;

  for (let li = 0; li < block.lines.length; li++) {
    const line = block.lines[li]!;
    if (isHiddenAnchorLine(line)) continue;

    const globalLineIndex = lineIndexOffset + li;
    const isLastLine = li === block.lines.length - 1;
    // Match TextBlockStrategy.render: the justify last-line exception (no
    // stretching) only applies when this is the final line of the whole block,
    // not just the last line of a fragment that continues on the next page.
    const isLastLineOfBlock = isLastLine && !block.continuesOnNextPage;

    const lineOffsetX = line.positioned
      ? 0
      : computeAlignmentOffset(
          block.align,
          block.availableWidth,
          line.width,
        );
    const spaceBonus = line.positioned
      ? 0
      : computeJustifySpaceBonus(
          block.align,
          line.spans,
          block.availableWidth,
          line.width,
          isLastLineOfBlock,
        );

    // textY: top of cursor rectangles for text glyphs.
    // Aligns to the actual text position when a baseline image inflates line.ascent.
    const textY = line.textAscent > 0
      ? lineY + line.ascent - line.textAscent
      : lineY + Math.max(0, line.lineHeight - line.cursorHeight) / 2;

    const lastPopSpan = line.spans[line.spans.length - 1];
    map.registerLine({
      page,
      lineIndex: globalLineIndex,
      y: lineY,
      height: line.lineHeight,
      x: block.x,
      contentWidth: block.availableWidth,
      startDocPos: line.spans[0]?.docPos ?? block.nodePos + 1,
      endDocPos: line.terminalBreakDocPos !== undefined
        ? line.terminalBreakDocPos + 1
        : (lastPopSpan ? spanEndDocPos(lastPopSpan) : block.nodePos + 1),
    });

    // Track the last non-ZWS glyph so we can register a zero-width sentinel
    // at endDocPos after the loop. Without this, coordsAtPos(endDocPos) falls
    // back to the preceding-glyph search which can return a glyph from the
    // wrong page and cause scrollCursorIntoView to scroll to the wrong place.
    let lastGlyph = { x: 0, width: 0, docPos: -1, isZws: false, isObject: false };
    let spacesBeforeSpan = 0;
    for (const span of line.spans) {
      if (span.kind === "object") {
        const objX = block.x + lineOffsetX + span.x;
        // Store full visual rect for overlay handles / popover positioning.
        map.registerObjectRect({ docPos: span.docPos, x: objX, y: computeObjectRenderY(lineY, line, span), width: span.width, height: span.height, page });
        // y = textY so cursor draws at the text baseline, not image top.
        map.registerGlyph({
          docPos: span.docPos,
          x: objX,
          y: textY,
          lineY,
          width: span.width,
          height: line.cursorHeight,
          page,
          lineIndex: globalLineIndex,
        });
        map.registerGlyph({
          docPos: span.docPos + 1,
          x: objX + span.width,
          y: textY,
          lineY,
          width: 0,
          height: line.cursorHeight,
          page,
          lineIndex: globalLineIndex,
        });
        lastGlyph = { x: objX + span.width, width: 0, docPos: span.docPos, isZws: false, isObject: true };
        continue;
      }

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
          y: textY,
          lineY,
          width: charWidth,
          height: line.cursorHeight,
          page,
          lineIndex: globalLineIndex,
        });

        lastGlyph = {
          x: charX,
          width: charWidth,
          docPos: span.docPos + ci,
          isZws: span.text[ci] === "\u200B",
          isObject: false,
        };

        if (span.text[ci] === " ") spacesWithinSpan++;
      }

      spacesBeforeSpan += countSpaces(span.text);
    }

    // Register a zero-width glyph at the hardBreak's doc position so
    // coordsAtPos(breakDocPos) returns the correct cursor location at line-end.
    if (line.terminalBreakDocPos !== undefined) {
      const breakX = block.x + lineOffsetX + line.width;
      map.registerGlyph({
        docPos: line.terminalBreakDocPos,
        x: breakX,
        y: textY,
        lineY,
        width: 0,
        height: line.cursorHeight,
        page,
        lineIndex: globalLineIndex,
      });
    }

    // Register end-of-line caret sentinel at the position just past the last
    // real character — but only on the LAST line of the block, and only when
    // the last span was text (object spans already register a right-half glyph
    // at docPos+1, so no sentinel is needed).
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
    if (isLastLine && lastGlyph.docPos >= 0 && !lastGlyph.isZws && !lastGlyph.isObject) {
      map.registerGlyph({
        docPos: lastGlyph.docPos + 1,
        x: lastGlyph.x + lastGlyph.width,
        y: textY,
        lineY,
        width: 0,
        height: line.cursorHeight,
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
