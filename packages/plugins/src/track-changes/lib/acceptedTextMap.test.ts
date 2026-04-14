import { describe, it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import type { Mark } from "prosemirror-model";
import {
  buildAcceptedTextMap,
  acceptedOffsetToDocPos,
  acceptedRangeToDocRange,
} from "./acceptedTextMap";

// ── Minimal ProseMirror schema for testing ────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc:       { content: "paragraph+" },
    paragraph: { content: "inline*" },
    text:      { group: "inline" },
  },
  marks: {
    tracked_insert: {
      excludes: "",
      attrs: { dataTracked: { default: {} } },
    },
    tracked_delete: {
      excludes: "",
      attrs: { dataTracked: { default: {} } },
    },
  },
});

const insertMark = (authorID = "ai") =>
  schema.marks.tracked_insert.create({
    dataTracked: { id: "ins1", authorID, operation: "insert", status: "pending" },
  });

const deleteMark = (authorID = "user") =>
  schema.marks.tracked_delete.create({
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

  it("tracked_insert text IS included in acceptedText (already accepted)", () => {
    const para = buildParagraph([
      { text: "hello " },
      { text: "world", marks: [insertMark()] },
    ]);
    const { acceptedText } = buildAcceptedTextMap(para, 0, schema);
    expect(acceptedText).toBe("hello world");
  });

  it("tracked_delete text is NOT included in acceptedText", () => {
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
