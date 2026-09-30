/**
 * Doc attrs across a storage boundary.
 *
 * `Collaboration` keeps a document's own attributes in a map beside the content
 * fragment, which is the whole answer for a host that persists the `Y.Doc`:
 * the map crosses with everything else. A host that persists a ProseMirror-JSON
 * projection instead has no route in or out — the conversions either direction
 * walk the fragment's children, and `doc.attrs` has no representation in a
 * `Y.XmlFragment` at all. Without this pair a header imported from a `.docx` is
 * lost the first time the document is opened, and the save after it writes the
 * schema's nulls over the import.
 *
 * A pair of functions rather than an exported envelope type, because a caller
 * should not have to know that the values are wrapped, or that `localSeq` is a
 * dedup hint it has no business setting.
 */
import * as Y from "yjs";

import { DOC_ATTRS_MAP_NAME, type DocAttrEnvelope } from "./YBinding";

/** Is this what the live binding writes, or something else that got in? */
function isEnvelope(value: unknown): value is DocAttrEnvelope {
  return typeof value === "object" && value !== null && "value" in value;
}

/**
 * Put a projection's doc attrs into a room that does not have them yet.
 *
 * `declaredAttrNames` is the whitelist — `editor.getDocAttrNames()` — and it is
 * a parameter rather than something read from an editor so that a host seeding
 * a room before it has one can still pass the rule. A projection can carry keys
 * from an extension set this reader does not have, and syncing those would push
 * state nobody here can interpret.
 *
 * Null values are skipped: the doc node declares these attrs with null defaults,
 * so every document offers one for every key, and writing them would sync an
 * absence over a policy the room already agreed on. Keys the room already holds
 * are left alone for the same reason — the Y.Doc may have been restored from
 * cache before the projection was consulted, which makes the room's value the
 * newer one.
 *
 * One transaction, so a peer observing the room sees a whole policy rather than
 * half of one.
 */
export function seedDocAttrs(
  ydoc: Y.Doc,
  attrs: Record<string, unknown>,
  declaredAttrNames: readonly string[],
): void {
  const map = ydoc.getMap<DocAttrEnvelope>(DOC_ATTRS_MAP_NAME);
  ydoc.transact(() => {
    for (const key of declaredAttrNames) {
      const value = attrs[key];
      if (value === null || value === undefined) continue;
      if (map.has(key)) continue;
      map.set(key, { localSeq: 0, value });
    }
  });
}

/**
 * Read a room's doc attrs back out as a plain object, ready to store on a
 * ProseMirror-JSON projection.
 *
 * Unfiltered by design: a projection should carry everything the room holds,
 * including attrs from an extension set this reader lacks, so that storing and
 * restoring does not quietly drop another peer's policy. The declared-attrs rule
 * belongs on the way *in*, where interpreting a value is the risk.
 */
export function readDocAttrs(ydoc: Y.Doc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, envelope] of ydoc.getMap<DocAttrEnvelope>(DOC_ATTRS_MAP_NAME)) {
    if (isEnvelope(envelope)) out[key] = envelope.value;
  }
  return out;
}
