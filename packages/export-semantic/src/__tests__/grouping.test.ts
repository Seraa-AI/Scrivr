/**
 * A heading takes a short lede into its unit: a plain text block, the
 * schema's default. A default block that is itself a heading, or a container,
 * is not a lede.
 */
import { describe, expect, it } from "vitest";
import { Schema } from "@scrivr/core/pm";
import { groupBlocks } from "../grouping";

function groupsOf(spec: ConstructorParameters<typeof Schema>[0], content: unknown[]): number[] {
  const schema = new Schema(spec);
  const doc = schema.nodeFromJSON({ type: "doc", content });
  const blocks: { node: typeof doc; index: number }[] = [];
  doc.forEach((node, _offset, index) => blocks.push({ node, index }));
  return groupBlocks(blocks).map((group) => group.length);
}

const text = (value: string) => [{ type: "text", text: value }];

describe("a heading's lede", () => {
  it("is not a heading, even when headings are the schema's default block", () => {
    const spec = { nodes: {
      doc: { content: "block+" },
      title: { group: "block", content: "text*", outlineLevel: () => 1 },
      text: {},
    } };
    expect(groupsOf(spec, [{ type: "title", content: text("A") }, { type: "title", content: text("B") }])).toEqual([1, 1]);
  });

  it("is not a container, even when a container is the schema's default block", () => {
    const spec = { nodes: {
      doc: { content: "block+" },
      quote: { group: "block", content: "line+" },
      line: { content: "text*" },
      title: { group: "block", content: "text*", outlineLevel: () => 1 },
      text: {},
    } };
    expect(groupsOf(spec, [
      { type: "title", content: text("A") },
      { type: "quote", content: [{ type: "line", content: text("short") }] },
    ])).toEqual([1, 1]);
  });
});
