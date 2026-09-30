/**
 * Moving a document's own attributes across a storage boundary.
 *
 * A host that persists the `Y.Doc` gets these for free; one that persists a
 * ProseMirror-JSON projection had no route either way, and lost them.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
// Through the package barrel: this pair exists to be imported by a consuming
// application, so a name dropped from `index.ts` fails here rather than there.
import { DOC_ATTRS_MAP_NAME, readDocAttrs, seedDocAttrs } from "../index";

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
    seedDocAttrs(ydoc, { headerFooter: { a: 1 }, foreign: { b: 2 } }, DECLARED);

    expect(readDocAttrs(ydoc)).toEqual({ headerFooter: { a: 1 } });
  });

  it("does not write an absence over a real policy", () => {
    const ydoc = room();
    seedDocAttrs(ydoc, { headerFooter: { real: true } }, DECLARED);
    seedDocAttrs(ydoc, { headerFooter: null, finalSection: null }, DECLARED);

    expect(readDocAttrs(ydoc)).toEqual({ headerFooter: { real: true } });
  });

  it("leaves a room that already has state alone", () => {
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
    ydoc.getMap(DOC_ATTRS_MAP_NAME).set("headerFooter", { localSeq: 3, value: { showOnFirstPage: true } });

    expect(readDocAttrs(ydoc)).toEqual({ headerFooter: { showOnFirstPage: true } });
  });

  it("ignores a value that is not in the wire shape", () => {
    const ydoc = room();
    ydoc.getMap(DOC_ATTRS_MAP_NAME).set("headerFooter", "not an envelope");

    expect(readDocAttrs(ydoc)).toEqual({});
  });

  it("refuses exactly what the live sync refuses", () => {
    // The binding skips an envelope whose counter is missing or not a real
    // number. Reading one out anyway would persist, as authoritative, a value
    // the sync declines to apply — and resurrect it on every load.
    const ydoc = room();
    const map = ydoc.getMap(DOC_ATTRS_MAP_NAME);
    map.set("noCounter", { value: { a: 1 } });
    map.set("stringCounter", { localSeq: "3", value: { b: 2 } });
    map.set("nanCounter", { localSeq: Number.NaN, value: { c: 3 } });
    map.set("good", { localSeq: 1, value: { d: 4 } });

    expect(readDocAttrs(ydoc)).toEqual({ good: { d: 4 } });
  });
});
