import { describe, it, expect } from "vitest";
import { Schema } from "@scrivr/core/pm";
import type { Mark } from "@scrivr/core/pm";
import {
  buildAcceptedTextMap,
  acceptedOffsetToDocPos,
  acceptedRangeToDocRange,
  docRangeToAcceptedRange,
  acceptedTextMapFor,
} from "./acceptedTextMap";

// ── Minimal ProseMirror schema for testing ────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc:       { content: "paragraph+" },
    paragraph: { content: "inline*" },
    text:      { group: "inline" },
  },
  marks: {
    trackedInsert: {
      excludes: "",
      attrs: { dataTracked: { default: {} } },
    },
    trackedDelete: {
      excludes: "",
      attrs: { dataTracked: { default: {} } },
    },
  },
});

const insertMark = (authorID = "ai") =>
  schema.marks.trackedInsert.create({
    dataTracked: { id: "ins1", authorID, operation: "insert", status: "pending" },
  });

const deleteMark = (authorID = "user") =>
  schema.marks.trackedDelete.create({
    dataTracked: { id: "del1", authorID, operation: "delete", status: "pending" },
  });

/**
 * Build a paragraph node with the given inline spec.
 * spec: array of { text, marks? }
 */
function buildParagraph(spec: Array<{ text: string; marks?: Mark[] }>) {
  const children = spec.map(({ text, marks = [] }) =>
    schema.text(text, marks),
  );
  return schema.nodes.paragraph.create(null, children);
}

// ── buildAcceptedTextMap ──────────────────────────────────────────────────────

describe("buildAcceptedTextMap", () => {
  it("plain paragraph: all text is accepted, map length equals text length", () => {
    // Paragraph at nodePos=0 in a doc, so nodePos=0 means content starts at 1.
    const para = buildParagraph([{ text: "hello world" }]);
    const { acceptedText, map } = buildAcceptedTextMap(para, 0, schema);

    expect(acceptedText).toBe("hello world");
    expect(map.length).toBe(11);
    // Each entry's acceptedOffset matches its index
    map.forEach((entry, i) => {
      expect(entry.acceptedOffset).toBe(i);
    });
  });

  it("trackedInsert text IS included in acceptedText (already accepted)", () => {
    const para = buildParagraph([
      { text: "hello " },
      { text: "world", marks: [insertMark()] },
    ]);
    const { acceptedText } = buildAcceptedTextMap(para, 0, schema);
    expect(acceptedText).toBe("hello world");
  });

  it("trackedDelete text is NOT included in acceptedText", () => {
    const para = buildParagraph([
      { text: "hello " },
      { text: "quick ", marks: [deleteMark()] },
      { text: "world" },
    ]);
    const { acceptedText } = buildAcceptedTextMap(para, 0, schema);
    expect(acceptedText).toBe("hello world");
  });

  it("decoratedText wraps inserts and deletes with XML tags", () => {
    const para = buildParagraph([
      { text: "hello " },
      { text: "quick ", marks: [deleteMark("bob")] },
      { text: "agile ", marks: [insertMark("bob")] },
      { text: "world" },
    ]);
    const { decoratedText } = buildAcceptedTextMap(para, 0, schema);
    expect(decoratedText).toContain('<del author="bob">quick </del>');
    expect(decoratedText).toContain('<ins author="bob">agile </ins>');
    expect(decoratedText).toContain("hello ");
    expect(decoratedText).toContain("world");
  });

  it("map docPos values start at nodePos+1 (ProseMirror content offset)", () => {
    const para = buildParagraph([{ text: "abc" }]);
    const nodePos = 10; // simulate the paragraph sitting at doc pos 10
    const { map } = buildAcceptedTextMap(para, nodePos, schema);

    // nodePos+1 = 11 is the first content position
    expect(map[0]!.docPos).toBe(11);
    expect(map[1]!.docPos).toBe(12);
    expect(map[2]!.docPos).toBe(13);
  });

  it("map skips deleted chars: docPos jumps over them", () => {
    // "ab[DEL:cd]ef" — accepted = "abef"
    const para = buildParagraph([
      { text: "ab" },
      { text: "cd", marks: [deleteMark()] },
      { text: "ef" },
    ]);
    const { acceptedText, map } = buildAcceptedTextMap(para, 0, schema);
    expect(acceptedText).toBe("abef");
    // 'a' at docPos 1, 'b' at 2, then 'cd' (deleted) occupies 3,4, so 'e' at 5
    expect(map[0]!.docPos).toBe(1); // 'a'
    expect(map[1]!.docPos).toBe(2); // 'b'
    expect(map[2]!.docPos).toBe(5); // 'e' (skipped over 'c'=3, 'd'=4)
    expect(map[3]!.docPos).toBe(6); // 'f'
  });
});

// ── acceptedOffsetToDocPos ────────────────────────────────────────────────────

describe("acceptedOffsetToDocPos", () => {
  it("returns the correct docPos for a given offset", () => {
    const para = buildParagraph([{ text: "abc" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);
    expect(acceptedOffsetToDocPos(map, 0)).toBe(1);
    expect(acceptedOffsetToDocPos(map, 1)).toBe(2);
    expect(acceptedOffsetToDocPos(map, 2)).toBe(3);
  });

  it("returns null for out-of-range offsets", () => {
    const para = buildParagraph([{ text: "abc" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);
    expect(acceptedOffsetToDocPos(map, -1)).toBeNull();
    expect(acceptedOffsetToDocPos(map, 3)).toBeNull();
  });
});

// ── acceptedRangeToDocRange ───────────────────────────────────────────────────

describe("acceptedRangeToDocRange", () => {
  it("maps a character range to doc positions", () => {
    const para = buildParagraph([{ text: "hello" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);
    // "ell" = offsets 1..3
    const range = acceptedRangeToDocRange(map, 1, 4);
    expect(range).toEqual({ from: 2, to: 5 });
  });

  it("returns an insertion point for empty range", () => {
    const para = buildParagraph([{ text: "hello" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);
    const range = acceptedRangeToDocRange(map, 2, 2);
    expect(range).toEqual({ from: 3, to: 3 });
  });

  it("returns null for invalid ranges", () => {
    const para = buildParagraph([{ text: "abc" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);
    expect(acceptedRangeToDocRange(map, -1, 2)).toBeNull();
    expect(acceptedRangeToDocRange(map, 2, 1)).toBeNull();
    expect(acceptedRangeToDocRange(map, 0, 10)).toBeNull();
  });

  it("end-of-text insertion point uses last docPos + 1", () => {
    const para = buildParagraph([{ text: "abc" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);
    // acceptedOffset = 3 (past end) → insertion at end
    const range = acceptedRangeToDocRange(map, 3, 3);
    expect(range).toEqual({ from: 4, to: 4 });
  });

  it("correctly maps through a gap left by deleted chars", () => {
    // "ab[DEL:cd]ef" — accepted = "abef"
    const para = buildParagraph([
      { text: "ab" },
      { text: "cd", marks: [deleteMark()] },
      { text: "ef" },
    ]);
    const { map } = buildAcceptedTextMap(para, 0, schema);
    // accepted range 2..4 = "ef" → docPos 5..7
    const range = acceptedRangeToDocRange(map, 2, 4);
    expect(range).toEqual({ from: 5, to: 7 });
  });
});

// ── docRangeToAcceptedRange ───────────────────────────────────────────────────

describe("docRangeToAcceptedRange", () => {
  it("is the inverse of acceptedRangeToDocRange", () => {
    const para = buildParagraph([{ text: "hello world" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);
    const doc = acceptedRangeToDocRange(map, 2, 7);

    expect(docRangeToAcceptedRange(map, doc!.from, doc!.to)).toEqual({ from: 2, to: 7 });
  });

  it("skips text pending deletion, which accepted text does not contain", () => {
    // "ab[DEL:cd]ef" — accepted is "abef", so a selection over the whole
    // paragraph is four accepted characters, not six. This is the conversion a
    // host cannot do with arithmetic.
    const para = buildParagraph([
      { text: "ab" },
      { text: "cd", marks: [deleteMark()] },
      { text: "ef" },
    ]);
    const { acceptedText, map } = buildAcceptedTextMap(para, 0, schema);

    expect(acceptedText).toBe("abef");
    // doc 1..7 is the paragraph's whole content, "abcdef".
    expect(docRangeToAcceptedRange(map, 1, 7)).toEqual({ from: 0, to: 4 });
  });

  it("rounds a selection edge inside deleted text outward to the accepted char", () => {
    const para = buildParagraph([
      { text: "ab" },
      { text: "cd", marks: [deleteMark()] },
      { text: "ef" },
    ]);
    const { map } = buildAcceptedTextMap(para, 0, schema);

    // doc 4 sits inside "cd", which has no accepted offset of its own.
    expect(docRangeToAcceptedRange(map, 4, 7)).toEqual({ from: 2, to: 4 });
  });

  it("is a collapsed accepted range for a collapsed doc range", () => {
    const para = buildParagraph([{ text: "abc" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);

    expect(docRangeToAcceptedRange(map, 2, 2)).toEqual({ from: 1, to: 1 });
  });

  it("is null when the range reaches no accepted character", () => {
    // Every character is pending deletion, so there is no accepted text for a
    // selection over it to name.
    const para = buildParagraph([{ text: "abc", marks: [deleteMark()] }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);

    expect(docRangeToAcceptedRange(map, 1, 4)).toBeNull();
  });

  it("is null for an inverted range", () => {
    const para = buildParagraph([{ text: "abc" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);

    expect(docRangeToAcceptedRange(map, 3, 1)).toBeNull();
  });

  it("clamps a range that overruns the block to what the block holds", () => {
    const para = buildParagraph([{ text: "abc" }]);
    const { map } = buildAcceptedTextMap(para, 0, schema);

    expect(docRangeToAcceptedRange(map, 0, 999)).toEqual({ from: 0, to: 3 });
  });
});

// ── acceptedTextMapFor (memoised) ────────────────────────────────────────────

describe("acceptedTextMapFor", () => {
  it("answers exactly what the uncached build answers", () => {
    const para = buildParagraph([
      { text: "ab" },
      { text: "cd", marks: [deleteMark()] },
      { text: "ef", marks: [insertMark()] },
    ]);

    expect(acceptedTextMapFor(para, 0, schema)).toEqual(buildAcceptedTextMap(para, 0, schema));
  });

  it("reuses the result for the same block at the same place", () => {
    // The overlay asks once per suggested block per page per paint frame, and
    // the build walks every inline child to do it.
    const para = buildParagraph([{ text: "hello world" }]);

    expect(acceptedTextMapFor(para, 0, schema)).toBe(acceptedTextMapFor(para, 0, schema));
  });

  it("rebuilds when the block's content changes", () => {
    // A node is immutable, so an edit produces a different node — which is the
    // invalidation signal, with nothing to keep in step.
    const before = buildParagraph([{ text: "hello" }]);
    const after = buildParagraph([{ text: "hello!" }]);

    expect(acceptedTextMapFor(after, 0, schema).acceptedText).toBe("hello!");
    expect(acceptedTextMapFor(before, 0, schema).acceptedText).toBe("hello");
  });

  it("rebuilds when the same block moves", () => {
    // The map holds absolute document positions, so an unchanged block that
    // text was inserted in front of needs a fresh one.
    const para = buildParagraph([{ text: "hi" }]);

    const atZero = acceptedTextMapFor(para, 0, schema);
    const atTen = acceptedTextMapFor(para, 10, schema);

    expect(atZero.map[0]!.docPos).toBe(1);
    expect(atTen.map[0]!.docPos).toBe(11);
    expect(atTen).not.toBe(atZero);
  });

  it("does not hand a moved block a stale map on the way back", () => {
    const para = buildParagraph([{ text: "hi" }]);
    acceptedTextMapFor(para, 0, schema);
    acceptedTextMapFor(para, 10, schema);

    expect(acceptedTextMapFor(para, 0, schema).map[0]!.docPos).toBe(1);
  });
});
