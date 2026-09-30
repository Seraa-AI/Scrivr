/**
 * Moving a document's own attributes across a storage boundary.
 *
 * `Collaboration` syncs doc attrs between peers through a sibling map, which is
 * the whole answer for a host that persists the `Y.Doc`. A host that persists a
 * ProseMirror-JSON projection instead has no way in or out: the conversions
 * either direction touch the fragment's children, and `doc.attrs` has no
 * representation in a `Y.XmlFragment` at all — so a header imported from a
 * `.docx` is gone the first time the document is opened, and the save after it
 * writes the schema's nulls over the import.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDocAttrs, seedDocAttrs } from "./docAttrs";

const DECLARED = ["headerFooter", "finalSection"] as const;
const room = () => new Y.Doc();

describe("seedDocAttrs", () => {
  it("round-trips what a projection holds", () => {
    const ydoc = room();
    const attrs = { headerFooter: { showOnFirstPage: false }, finalSection: { orientation: "landscape" } };

    seedDocAttrs(ydoc, attrs, DECLARED);

    expect(readDocAttrs(ydoc)).toEqual(attrs);
  });

  it("carries only the attrs the reader's extensions declare", () => {
    const ydoc = room();
    // A projection can hold keys from an extension set this reader does not
    // have; syncing them would push state nobody here can interpret.
    seedDocAttrs(ydoc, { headerFooter: { a: 1 }, foreign: { b: 2 } }, DECLARED);

    expect(readDocAttrs(ydoc)).toEqual({ headerFooter: { a: 1 } });
  });

  it("does not write an absence over a real policy", () => {
    const ydoc = room();
    // Every document offers a value for every declared attr, because the doc
    // node declares them with null defaults. Seeding those would sync "no
    // header" over a header the room already agreed on.
    seedDocAttrs(ydoc, { headerFooter: { real: true } }, DECLARED);
    seedDocAttrs(ydoc, { headerFooter: null, finalSection: null }, DECLARED);

    expect(readDocAttrs(ydoc)).toEqual({ headerFooter: { real: true } });
  });

  it("leaves a room that already has state alone", () => {
    // The Y.Doc may have been restored from cache before the projection is
    // consulted, and the room's own value is the newer one.
    const ydoc = room();
    seedDocAttrs(ydoc, { headerFooter: { from: "room" } }, DECLARED);
    seedDocAttrs(ydoc, { headerFooter: { from: "projection" } }, DECLARED);

    expect(readDocAttrs(ydoc)).toEqual({ headerFooter: { from: "room" } });
  });

  it("is one transaction, so a peer sees a whole policy or none of it", () => {
    const ydoc = room();
    let transactions = 0;
    ydoc.on("afterTransaction", () => { transactions += 1; });

    seedDocAttrs(ydoc, { headerFooter: { a: 1 }, finalSection: { b: 2 } }, DECLARED);

    expect(transactions).toBe(1);
  });
});

describe("readDocAttrs", () => {
  it("is empty for a room that never had any", () => {
    expect(readDocAttrs(room())).toEqual({});
  });

  it("reads what a peer wrote through the live binding", () => {
    // Not seeded by us — written in the shape `YBinding` uses, which is the
    // case that matters: the pair has to agree with the running sync.
    const ydoc = room();
    ydoc.getMap("prose_doc_attrs").set("headerFooter", { localSeq: 3, value: { showOnFirstPage: true } });

    expect(readDocAttrs(ydoc)).toEqual({ headerFooter: { showOnFirstPage: true } });
  });

  it("ignores a value that is not in the wire shape", () => {
    const ydoc = room();
    ydoc.getMap("prose_doc_attrs").set("headerFooter", "not an envelope");

    expect(readDocAttrs(ydoc)).toEqual({});
  });
});
