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
 */
import * as Y from "yjs";

import { DOC_ATTRS_MAP_NAME, isDocAttrEnvelope, type DocAttrEnvelope } from "./YBinding";

/**
 * Put a projection's doc attrs into a room that does not have them yet.
 *
 * `declaredAttrNames` is the whitelist — `editor.getDocAttrNames()` — and it is
 * a parameter rather than something read from an editor so that a host seeding a
 * room before it has one can still pass the rule. A projection can carry keys
 * from an extension set this reader does not have, and syncing those would push
 * state nobody here can interpret.
 *
 * Which means the editor supplying the names has to carry the extensions that
 * own the attrs: a `StarterKit`-only editor declares no `headerFooter`, so
 * seeding with its names drops a header rather than syncing it.
 *
 * **Seed before the room is live, or after it has synced — never in between.**
 * The "leave what the room already holds alone" check reads this `Y.Doc`, which
 * knows nothing of a server value that has not arrived yet. Seeding mid-connect
 * writes anyway, and Yjs resolves the two concurrent sets by client id rather
 * than by which is newer — so a stale projection can win and replace a policy
 * every peer is already editing against. Server-side seeding, or seeding after
 * the provider reports sync, both avoid the race.
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
 * Returns every attr the room holds, including ones from an extension set this
 * reader lacks — a projection should not silently narrow to what this client
 * happens to understand. Note the asymmetry: `seedDocAttrs` will not put a
 * foreign key back, and neither will `Node.fromJSON`, so a full round trip
 * through a ProseMirror document drops it. Preserving it is the storage layer's
 * job if the storage layer wants it.
 *
 * The returned object has a null prototype: the keys come off the wire, and
 * `__proto__` as an own property is not the same thing as `__proto__` on an
 * object literal.
 */
export function readDocAttrs(ydoc: Y.Doc): Record<string, unknown> {
  // Null-prototype: keys come off the wire, and `__proto__` as an own property
  // is not the same thing as `__proto__` on a plain object literal.
  const out: Record<string, unknown> = Object.create(null);
  // Untyped on purpose: naming the envelope type here would tell the compiler
  // every value already is one, and the guard below would narrow nothing.
  for (const [key, envelope] of ydoc.getMap(DOC_ATTRS_MAP_NAME)) {
    if (isDocAttrEnvelope(envelope)) out[key] = envelope.value;
  }
  return out;
}
