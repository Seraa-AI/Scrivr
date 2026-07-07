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
  | "unknown";

/** Structural role of a unit. Body-only in v1; header/footer reserved. */
export type SemanticRole = "body" | "header" | "footer";

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
  /** Heading path, e.g. `["Limitation of Liability", "Exclusions"]`. */
  breadcrumb: string[];
  headingLevel?: number;
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
  /** Structure-preserving markdown. Simple tables → GFM. Convenience only — a
   * lossy view; `attrs`/`spans` are the source of truth for styling. */
  markdown?: string;
  /** Structured rows/cells with spans — emitted for tables GFM can't encode. */
  cells?: TableCells;
  /** Review changes excluded from `text` but preserved for audit/UI use. */
  changes?: SemanticChange[];
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

export interface SemanticChange {
  type: "suggestedDelete";
  text: string;
  id?: string;
  authorId?: string;
  status?: string;
  createdAt?: number;
  groupId?: string;
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
}

// ── Producer context ─────────────────────────────────────────────────────────

/**
 * Read-only context handed to handlers and used by the walker. Bridges to the
 * editor's markdown serializer (decision: reuse, don't reinvent) and applies
 * the mark seam when producing plain text.
 */
export interface UnitCtx {
  readonly schema: Schema;
  /** Serialize one block, or an ordered group of blocks, to markdown. */
  toMarkdown(nodes: PmNode | readonly PmNode[]): string;
  /** Plain text for embedding; folds semantic mark handlers. */
  toText(nodes: PmNode | readonly PmNode[]): string;
  /** Inline formatting runs; reconstructs `toText` exactly (formatting marks only). */
  toSpans(nodes: PmNode | readonly PmNode[]): InlineSpan[];
  /** Review changes found while applying semantic mark handlers. */
  toChanges(nodes: PmNode | readonly PmNode[]): SemanticChange[];
  /** A block's non-default styling attrs (align/indent/font/…), or undefined. */
  attrsOf(node: PmNode): Record<string, unknown> | undefined;
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
}
