/**
 * Change-detection substrate for incremental re-embedding (RFC 32 Phase P4).
 *
 * A consumer indexes chunks by `(nodeId, contentHash)`. Between two document
 * versions it diffs unit hashes and re-embeds only what changed — paragraph
 * cost instead of document cost. The editor owns the identity (`nodeId`) and
 * the canonical embedding input; the consumer owns storage + the re-embed.
 */
import { fnv1aHex, stableStringify, type SemanticUnit } from "@scrivr/core";

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
 * `text`, `spans` (marks + attrs), and block `attrs`. Unlike `unitContentHash`
 * (embedding input, plain text only), this DOES change on formatting-only edits
 * (bold, color, alignment), so it's the detector for the rich AI-edit loop:
 * "would re-applying this unit produce a different document?". Deterministic —
 * `stableStringify` makes it independent of attr key order.
 */
export function unitRichHash(unit: SemanticUnit): string {
  return fnv1aHex(
    stableStringify({
      type: unit.type,
      breadcrumb: unit.breadcrumb,
      text: unit.text,
      spans: unit.spans ?? [],
      attrs: unit.attrs ?? {},
    }),
  );
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
