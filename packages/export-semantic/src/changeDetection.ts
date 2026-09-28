/**
 * Change-detection substrate for incremental re-embedding (RFC 32 Phase P4).
 *
 * A consumer indexes chunks by `(nodeId, contentHash)`. Between two document
 * versions it diffs unit hashes and re-embeds only what changed — paragraph
 * cost instead of document cost. The editor owns the identity (`nodeId`) and
 * the canonical embedding input; the consumer owns storage + the re-embed.
 */
import { fnv1aHex, stableStringify, type SemanticPart, type SemanticUnit } from "@scrivr/core";

/**
 * The canonical value `semanticPartRichHash` covers. Published because the rich
 * diff lane needs the preimage, not only the digest: a digest says a leaf moved,
 * the preimage says which run did.
 */
export function semanticPartRichInput(part: SemanticPart): Record<string, unknown> {
  return {
    type: part.type,
    breadcrumb: part.breadcrumb,
    text: part.text,
    spans: part.spans ?? [],
    attrs: part.attrs ?? {},
  };
}

/** Formatting-aware hash for one editable leaf nested inside a container unit. */
export function semanticPartRichHash(part: SemanticPart): string {
  return fnv1aHex(stableStringify(semanticPartRichInput(part)));
}

/**
 * The canonical string to embed for a unit — heading path + text, the same
 * input `contentHash` covers. Use this so what you embed and what you hash
 * never drift apart.
 */
export function unitEmbeddingInput(unit: SemanticUnit): string {
  return unit.breadcrumb.length > 0
    ? unit.breadcrumb.join(" › ") + "\n" + unit.text
    : unit.text;
}

/**
 * Deterministic hash of a unit's embedding input. Identical hash ⇒ the vector
 * is unchanged ⇒ skip re-embed. Formatting-only edits (bold, color, alignment)
 * do NOT change it, since the embedding is plain text; a text or breadcrumb
 * change (including a tracked deletion removed from `text`) does.
 */
export function unitContentHash(unit: SemanticUnit): string {
  return fnv1aHex(unitEmbeddingInput(unit));
}

/**
 * Formatting-aware hash of a unit's rendered content — `type`, `breadcrumb`,
 * `text`, `spans` (marks + attrs), block `attrs`, and `cells` (table cell text,
 * spans, styling, gridSpan/vMerge/header). Unlike `unitContentHash` (embedding
 * input, plain text only), this DOES change on formatting-only edits (bold,
 * color, alignment) and on table cell styling/merge edits — so it's the detector
 * for the rich AI-edit loop: "would re-applying this unit produce a different
 * document?". Deterministic — `stableStringify` makes it independent of key order.
 */
export function unitRichHash(unit: SemanticUnit): string {
  return fnv1aHex(stableStringify(unitRichInput(unit)));
}

/**
 * The canonical value `unitRichHash` covers — structured, not a string, so a
 * consumer reads a unit's runs rather than re-deriving them from `text`.
 */
export function unitRichInput(unit: SemanticUnit): Record<string, unknown> {
  return {
    type: unit.type,
    breadcrumb: unit.breadcrumb,
    text: unit.text,
    spans: unit.spans ?? [],
    attrs: unit.attrs ?? {},
    // Lists and other containers expose their editable textblocks through
    // parts. Include them so a formatting-only leaf edit is observable.
    parts: unit.parts?.map(semanticPartRichInput) ?? null,
    // Table rich state lives in cells, not top-level text/spans/attrs — a cell
    // alignment/merge/header edit is invisible without this.
    cells: unit.cells ?? null,
  };
}

/**
 * The canonical clause text for cross-document matching — the unit's own text,
 * NFKC-normalized with whitespace collapsed.
 *
 * Deliberately narrower than `unitEmbeddingInput`: no breadcrumb, because the
 * same clause sits under a different heading in every agreement that carries it,
 * and no instance id, because `nodeId` is scoped to one document. Whitespace is
 * collapsed because a clause that survives a DOCX round-trip or a re-wrap is the
 * same clause, and NFKC folds the compatibility forms an importer can introduce.
 *
 * Covers the unit's text as emitted. A grouped heading-led unit carries its
 * heading in `text`, so cross-document alignment emits with `groupBlocks: false`
 * — then a heading is its own unit and a clause is keyed on the clause alone.
 */
export function unitAlignmentInput(unit: SemanticUnit): string {
  return unit.text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Content-addressed key for a unit — equal across documents when the clause
 * text is the same. The counterpart to `unit.id`, which addresses one instance:
 * a corpus indexes by both, the instance id to find this block again and the
 * content key to find everywhere else the clause appears.
 *
 * Not a similarity measure. Two clauses differing by one word get unrelated
 * keys, by design — near-duplicate scoring is a separate question, and one a
 * hash is the wrong tool for.
 */
export function unitContentKey(unit: SemanticUnit): string {
  return fnv1aHex(unitAlignmentInput(unit));
}

export interface SemanticUnitDiff {
  /** In `next` with an id not in `prev`. */
  added: SemanticUnit[];
  /** In `prev` with an id not in `next`. */
  removed: SemanticUnit[];
  /** Same id in both, but a different content hash — re-embed these. */
  changed: SemanticUnit[];
  /** Same id and same content hash — preserve, do not re-embed. */
  unchanged: SemanticUnit[];
}

/**
 * Diff two versions' units by anchor id (`unit.id`) and content hash. The
 * canonical P4 delta: `changed` + `added` are re-embedded, `removed` chunks are
 * deleted, `unchanged` are preserved. Units are matched by id, so this relies
 * on stable persisted `nodeId`s (positional fallbacks shift across edits).
 */
export function diffSemanticUnits(
  prev: readonly SemanticUnit[],
  next: readonly SemanticUnit[],
): SemanticUnitDiff {
  const prevById = new Map(prev.map((u) => [u.id, u]));
  const diff: SemanticUnitDiff = { added: [], removed: [], changed: [], unchanged: [] };

  const seen = new Set<string>();
  for (const unit of next) {
    seen.add(unit.id);
    const before = prevById.get(unit.id);
    if (!before) {
      diff.added.push(unit);
    } else if (unitContentHash(before) !== unitContentHash(unit)) {
      diff.changed.push(unit);
    } else {
      diff.unchanged.push(unit);
    }
  }
  for (const unit of prev) {
    if (!seen.has(unit.id)) diff.removed.push(unit);
  }
  return diff;
}
