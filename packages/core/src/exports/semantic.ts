/**
 * Public SemanticUnit export contract — types for the `semantic` export lane.
 *
 * Lives in `@scrivr/core` so both built-in extensions (which contribute
 * handlers via `addExports().semantic`) and `@scrivr/export-semantic` (which
 * runs the walker) import the same canonical definitions. The dependency
 * direction stays one-way (export-semantic → core) so there is no runtime cycle.
 *
 * A SemanticUnit is an AI-ready chunk unit: structure + identity (nodeId) +
 * heading breadcrumb, emitted in document order. Sizing and embedding policy
 * stay with the consumer — the editor only owns semantics and identity.
 */

import type { Node as PmNode, Mark as PmMark, Schema } from "prosemirror-model";
import { anchoredOf, type WrapMode, type XAlign } from "../layout/AnchoredObjects";

// ── The unit ──────────────────────────────────────────────────────────────

export type SemanticUnitType =
  | "heading"
  | "paragraph"
  | "table"
  | "list"
  | "codeBlock"
  | "image"
  | "horizontalRule"
  | "pageBreak"
  | "sectionBreak"
  | "sourcedBlock"
  | "unknown";

/** Structural role of a unit. Body-only in v1; header/footer reserved. */
export type SemanticRole = "body" | "header" | "footer";

/**
 * Text view exported by the semantic lane. In v1 this is the proposed review
 * view: pending inserts are included, pending deletes are excluded from text
 * and preserved in `changes`.
 */
export type SemanticTextView = "proposed";

/** A block that heads a section, as a unit holds it. */
export interface SemanticHeading {
  /**
   * The heading block's own id, or, for a nested heading with none, its
   * position in the unit (`<unit id>/h<n>`): stable for the same tree, but it
   * names no node, so a citation cannot resolve it.
   */
  nodeId: string;
  level: number;
  /** Its title (`outlineTitleOf`): the proposed text, a line break as a space, trimmed. */
  title: string;
  /** The headings it sits under, outermost first. */
  breadcrumb: string[];
}

/**
 * One section of the document's outline — the tree the headings imply, which a
 * flat unit list states only implicitly.
 *
 * Derived from the same units, so the same JSON always yields the same
 * outline: ids come from unit anchors and heading ids, never from fresh identity.
 */
export interface OutlineSection {
  /** Its heading's id (`SemanticHeading.nodeId`), or the first unit's for content before any heading. Stable across reads. */
  id: string;
  /** The enclosing section's `id`, or null at the top level. */
  parentId: string | null;
  /** The heading's text, or the supplied name for content that precedes one. */
  heading: string;
  /**
   * The heading block's own anchor id — what a citation points at.
   *
   * Null for the section covering content before the first heading: there is
   * no heading block to point at. The absence is the signal, so a caller that
   * needs a real heading can ask for one without a second flag.
   */
  headingNodeId: string | null;
  /** The heading's level. A section with no heading of its own sits at 1. */
  level: number;
  /** Ancestor headings outermost-first, ending with this section's own. */
  path: string[];
  /**
   * Index of the section's first unit: its heading's own unit, or the unit
   * holding a nested heading, which it shares with the section before.
   */
  startUnit: number;
  /**
   * Index one past the section's last unit. The range is heading-inclusive and
   * ends where the next section at this level or shallower opens, so an outer
   * section's range contains its children's.
   */
  endUnit: number;
}

export interface SemanticUnit {
  /** Stable anchor id = `nodeIds[0]`. Always present. */
  id: string;
  /**
   * All block ids this unit owns, in document order. Multi-block is
   * first-class (e.g. heading + its lede). Anchor = `nodeIds[0]`.
   */
  nodeIds: string[];
  type: SemanticUnitType;
  role: SemanticRole;
  /** Which document view `text`, `spans`, and `cells[].text` represent. */
  view: SemanticTextView;
  /** Heading path, e.g. `["Limitation of Liability", "Exclusions"]`. */
  breadcrumb: string[];
  /** The anchor block's outline level, when it heads a section (see `headings`). */
  headingLevel?: number;
  /**
   * Every block in this unit that heads a section, in document order: its
   * anchor, a heading nested in a list, sourced block or table cell, each with
   * the breadcrumb it sits under. A block heads a section when its spec
   * declares an outline level and its proposed text is not empty.
   */
  headings?: SemanticHeading[];
  /** Monotonic document order. */
  order: number;
  /** Plain text for embedding. Tracked-delete text excluded, tracked-insert included. */
  text: string;
  /**
   * The anchor block's own styling attributes that markdown can't express —
   * alignment, indent, font, list start, etc. Only non-default values, with
   * identity/review bookkeeping (`nodeId`, `dataTracked`, `level`) removed.
   * Present only when the block carries non-default styling.
   */
  attrs?: Record<string, unknown>;
  /**
   * Inline formatting runs that reconstruct `text` exactly
   * (`spans.map(s => s.text).join("") === text`), each carrying its formatting
   * marks with attrs (bold, italic, color, highlight, fontSize, link, …).
   * Lossless where markdown is not. Present only when some run is formatted;
   * review marks (tracked changes) are surfaced in `changes`, not here.
   */
  spans?: InlineSpan[];
  /**
   * Editable leaves inside a container unit (list items, table cells), each
   * addressable by its own `nodeId`. Present only for container units (list,
   * table); a leaf unit carries `spans` instead. `parts` is the universal edit
   * surface — the rich edit protocol targets a `SemanticPart.nodeId`, so any
   * leaf anywhere (incl. inside lists and tables) is individually editable.
   * `text`/`cells` stay for embedding and geometry; the merge never reads them.
   */
  parts?: SemanticPart[];
  /** Structure-preserving markdown. Simple tables → GFM. Convenience only — a
   * lossy, non-canonical projection; omitted when review `changes` are present
   * to avoid mixing proposed text with raw redline rendering. */
  markdown?: string;
  /** Structured rows/cells with spans — emitted for tables GFM can't encode. */
  cells?: TableCells;
  /** Pending review changes, each placed in `text`. */
  changes?: SemanticChange[];
  /** The image an `image` unit is — a paragraph holding one image and nothing else. */
  image?: SemanticImage;
  /**
   * The block itself is proposed for deletion — not only its text. It reads
   * empty and cannot be edited or placed after; its deletion is in `changes`.
   */
  proposedForDeletion?: true;
}

/**
 * An image as an agent reads it; it sets one through `SemanticImageAttrs`. An
 * image has no id of its own; the unit that carries it is addressed by its
 * paragraph's id.
 */
export interface SemanticImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  wrap: ImageWrap;
  /** `custom` when it was dragged to a position of its own; an agent sets only an `ImageAlign`. */
  align: ImageAlign | "custom";
}

/** How text flows around an image. */
export type ImageWrap = WrapMode;
/** Where an image sits across the line. */
export type ImageAlign = Exclude<XAlign, "custom">;
/** The wraps and alignments an agent may set; validate against these so validation follows the node. */
export const IMAGE_WRAPS: readonly ImageWrap[] = ["inline", "square", "top-bottom", "behind", "front"];
export const IMAGE_ALIGNS: readonly ImageAlign[] = ["left", "center", "right"];

/** The image node attr each `SemanticImage` field reads from and writes to. */
export const IMAGE_NODE_ATTRS: Record<keyof SemanticImage, string> = {
  src: "src",
  alt: "alt",
  width: "width",
  height: "height",
  wrap: "wrapMode",
  align: "xAlign",
};

/**
 * The image a node is, as an agent reads it, or null when it is not one: an
 * anchored object (its spec declares `anchored`) with a `src`. Use it wherever
 * an image is reported — a unit's `image`, or the image a change inserts or
 * deletes — so both read the same.
 */
export function semanticImage(node: PmNode): SemanticImage | null {
  const placed = anchoredOf(node);
  const { src, alt } = node.attrs;
  if (!placed || typeof src !== "string") return null;
  return {
    src,
    alt: typeof alt === "string" ? alt : "",
    width: placed.width,
    height: placed.height,
    wrap: placed.wrapMode,
    align: placed.xAlign,
  };
}

/** One inline run of a unit's text and the formatting marks around it. */
export interface InlineSpan {
  text: string;
  /** Formatting marks on this run. Empty for an unformatted run. */
  marks: InlineMark[];
}

/** A single mark description — its type and any meaningful attributes. */
export interface InlineMark {
  type: string;
  /** Non-null mark attributes (e.g. `{ color: "#dc2626" }`, `{ href: "…" }`). */
  attrs?: Record<string, unknown>;
}

/**
 * An editable leaf textblock inside a container unit — a list item's paragraph,
 * a table cell's paragraph. Addressed by its own stable `nodeId`; `breadcrumb`
 * is location context for the agent only, never an address. `spans` reconstructs
 * `text` exactly, same contract as on a leaf `SemanticUnit`.
 */
export interface SemanticPart {
  /** The address — stable, depth-agnostic. Resolves via `findNodeById`. */
  nodeId: string;
  type: "paragraph" | "heading" | "codeBlock";
  /** Location as context only, e.g. `["Pricing", "item 2"]`. */
  breadcrumb: string[];
  text: string;
  spans?: InlineSpan[];
  attrs?: Record<string, unknown>;
  /** Review changes inside this part, placed in `text`. Also in the parent unit. */
  changes?: SemanticChange[];
  /** The leaf itself is proposed for deletion, as on `SemanticUnit`. */
  proposedForDeletion?: true;
}

/**
 * One pending act of review as an agent reads it. `at`/`length` place it in the
 * text owning the `changes` array it is in: `unit.text`, `part.text` or
 * `cell.text`.
 */
export interface SemanticChange {
  type: "suggestedDelete" | "suggestedInsert" | "suggestedAttrs";
  /**
   * This act's own content: what it removes or adds, "\n" for a paragraph or
   * line break, "" for an attribute change or an object. Pieces in separate
   * blocks are joined by "\n". Anything else lying between its pieces —
   * another author's change, untouched text — is not part of it.
   */
  text: string;
  /**
   * Offset into the owning text: where an insertion or attribute change
   * starts, or where a deletion's first piece stood. Absent when a node
   * handler overrides the unit's text.
   */
  at?: number;
  /**
   * The extent in the owning text, from this act's first piece to its last.
   * For an insertion with nothing else inside it, `text.slice(at, at + length)`
   * is `text`; otherwise the slice also holds what lies between its pieces.
   * 0 for a deletion, which is not in the proposed text, and for an inserted
   * paragraph break, which sits between units rather than in one.
   */
  length?: number;
  /**
   * The act's id: the one to pass to `reviewChanges`. Every piece of one act —
   * both halves of a replacement or a move, a block and its text — shares it.
   */
  id?: string;
  authorId?: string;
  status?: string;
  createdAt?: number;
  /** Shared by the two halves of one replacement. */
  groupId?: string;
  /** Shared by the two halves of one move. */
  moveId?: string;
  /**
   * `suggestedAttrs` only: what it was before. A block: its former styling,
   * with `level` for a heading and `nodeType` when the type changed. A list
   * change: `{ list: [...] }`, the list types it sat in, outermost first. A
   * formatting change: `{ marks: [...] }`, the text's formatting marks before.
   */
  oldAttrs?: Record<string, unknown>;
  /**
   * The image an inserted or deleted image is. Each image an act adds or
   * removes is a change of its own, under the act's id.
   */
  image?: SemanticImage;
}

/**
 * A review record a contributor reads off a node — a block's own attrs, or a
 * text node's formatting marks. `covers` spans the node's text; `after` sits
 * where it ends, as a paragraph break does. A covering insertion with no text
 * of its own reads the text it covers.
 */
export interface SemanticNodeChange {
  change: SemanticChange;
  place: "covers" | "after";
}

export interface TableCells {
  rows: TableCellsRow[];
}

export interface TableCellsRow {
  cells: TableCell[];
}

export interface TableCell {
  text: string;
  /** Non-default cell styling (hAlign, vAlign, background, …). */
  attrs?: Record<string, unknown>;
  /** Inline formatting runs for this cell (reconstructs `text`). */
  spans?: InlineSpan[];
  /** Review changes scoped to this cell. Also included in the parent unit. */
  changes?: SemanticChange[];
  gridSpan: number;
  vMerge: "none" | "restart" | "continue";
  header: boolean;
}

// ── Handlers ────────────────────────────────────────────────────────────────

/**
 * What a per-node handler returns for ONE block node. The walker owns identity
 * (`id`/`nodeIds`/`order`), `breadcrumb`, `role`, and grouping — so a handler
 * only classifies its node and, when the markdown serializer can't express the
 * structure (tables), supplies `cells`. `text`/`markdown` are optional
 * overrides; when omitted the walker fills them from the shared serializer.
 */
export interface SemanticNodeResult {
  type: SemanticUnitType;
  cells?: TableCells;
  image?: SemanticImage;
  text?: string;
  markdown?: string;
}

/** Contributed per node type, keyed by `node.type.name`. */
export type SemanticNodeHandler = (node: PmNode, ctx: UnitCtx) => SemanticNodeResult;

/** A single text run while building a unit's plain text. */
export interface SemanticRun {
  text: string;
  changes?: SemanticChange[];
}

/**
 * Contributed per mark type, keyed by `mark.type.name`. Transforms or drops a
 * text run while the walker builds `text`. Return `null` to exclude the run,
 * or return an empty-text run with `changes` to preserve review metadata while
 * keeping that text out of embeddings.
 * Formatting marks (bold/italic/…) need no handler — plain text is unaffected.
 */
export type SemanticMarkHandler = (
  run: SemanticRun,
  mark: PmMark,
  ctx: UnitCtx,
) => SemanticRun | null;

/** The handler bundle an extension contributes for the `semantic` lane. */
export interface SemanticHandlers {
  nodes?: Record<string, SemanticNodeHandler>;
  marks?: Record<string, SemanticMarkHandler>;
  /**
   * Whether the proposed view leaves a node out: an object proposed for
   * deletion, which no mark handler can drop, or text proposed for deletion
   * beside one.
   */
  isRemoved?: (node: PmNode) => boolean;
  /**
   * Review records on any node, text included: a block's own attrs, or a
   * formatting mark's records, which no mark handler sees.
   */
  nodeChanges?: (node: PmNode, ctx: UnitCtx) => SemanticNodeChange[];
  /**
   * Whether the proposed view leaves a formatting mark off its text: one
   * proposed for removal. Spans then read the text as it would be.
   */
  isMarkRemoved?: (mark: PmMark) => boolean;
}

// ── Producer context ─────────────────────────────────────────────────────────

/**
 * Read-only context handed to handlers and used by the walker. Bridges to the
 * editor's markdown serializer (decision: reuse, don't reinvent) and applies
 * the mark seam when producing plain text.
 */
export interface UnitCtx {
  readonly schema: Schema;
  /** The document being read. A review act can span nodes, so naming one needs all of it. */
  readonly doc: PmNode;
  /** Serialize one block, or an ordered group of blocks, to markdown. */
  toMarkdown(nodes: PmNode | readonly PmNode[]): string;
  /** Plain text for embedding; folds semantic mark handlers. */
  toText(nodes: PmNode | readonly PmNode[]): string;
  /** Inline formatting runs; reconstructs `toText` exactly (formatting marks only). */
  toSpans(nodes: PmNode | readonly PmNode[]): InlineSpan[];
  /** Review changes from the mark handlers and `nodeChanges`, placed in `toText`'s text. */
  toChanges(nodes: PmNode | readonly PmNode[]): SemanticChange[];
  /** A block's non-default styling attrs (align/indent/font/…), or undefined. */
  attrsOf(node: PmNode): Record<string, unknown> | undefined;
  /** Whether the proposed view leaves this node out (see `SemanticHandlers.isRemoved`). */
  isRemoved(node: PmNode): boolean;
  /** Physical column count = max over rows of Σ gridSpan (never TableMap.width). */
  physicalColumns(table: PmNode): number;
}

/** Options for the `toSemanticUnits` entry point. */
export interface SemanticExportOptions {
  /** Handlers that win over extension-contributed ones (custom nodes/marks). */
  overrides?: SemanticHandlers;
  /**
   * Max chars for the "short lede" that a heading may absorb into one unit.
   * @default 200
   */
  shortBlockMaxChars?: number;
  /**
   * When false, emit one unit per top-level block instead of grouping cohesive
   * pairs (e.g. a heading and its lede). The edit read path uses this so each
   * unit maps to exactly one block; container units still expose `parts`.
   * @default true
   */
  groupBlocks?: boolean;
}
