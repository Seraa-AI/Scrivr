import { describe, it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import { normalizeSourcedBlock, computeBlockHash } from "./sourcedBlockHashing";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs: { nodeId: { default: null } },
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }],
      toDOM: () => ["strong", 0],
    },
    trackedInsert: {
      attrs: { id: { default: null } },
      parseDOM: [{ tag: "ins" }],
      toDOM: () => ["ins", 0],
    },
  },
});

describe("SourcedBlock Hashing & Normalization", () => {
  it("normalizer strips nodeId and trackedInsert marks", () => {
    const p = schema.nodes.paragraph.create(
      { nodeId: "should_be_stripped" },
      [
        schema.text("Hello ", [schema.marks.trackedInsert.create({ id: "trk_1" })]),
        schema.text("World", [schema.marks.strong.create()]),
      ]
    );
    const fragment = Fragment.from(p);

    const normalized = normalizeSourcedBlock(fragment);

    expect(normalized).toEqual([
      {
        type: "paragraph",
        // Notice nodeId is gone
        content: [
          {
            type: "text",
            text: "Hello ",
            // trackedInsert mark is gone
          },
          {
            type: "text",
            text: "World",
            marks: [{ type: "strong", attrs: {} }],
          },
        ],
      },
    ]);
  });

  it("produces identical hashes for fragments that differ only in transient state", () => {
    const p1 = schema.nodes.paragraph.create({ nodeId: "id_1" }, schema.text("Hello"));
    const p2 = schema.nodes.paragraph.create(
      { nodeId: "id_2" },
      schema.text("Hello", [schema.marks.trackedInsert.create({ id: "trk_2" })])
    );

    const hash1 = computeBlockHash(Fragment.from(p1));
    const hash2 = computeBlockHash(Fragment.from(p2));

    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for semantic changes", () => {
    const p1 = schema.nodes.paragraph.create({}, schema.text("Hello"));
    const p2 = schema.nodes.paragraph.create({}, schema.text("Hello World"));
    const p3 = schema.nodes.paragraph.create({}, schema.text("Hello", [schema.marks.strong.create()]));

    const h1 = computeBlockHash(Fragment.from(p1));
    const h2 = computeBlockHash(Fragment.from(p2));
    const h3 = computeBlockHash(Fragment.from(p3));

    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h2).not.toBe(h3);
  });
});

import { Fragment } from "prosemirror-model";
