import { describe, it, expect } from "vitest";
import type { Node, Schema } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { assignBlockIds } from "./assignBlockIds";

const schema: Schema = new ExtensionManager([StarterKit]).schema;

function paragraph(text: string, attrs: Record<string, unknown> = {}): Node {
  return schema.nodes["paragraph"]!.create(attrs, schema.text(text));
}

function bulletList(items: string[]): Node {
  const li = schema.nodes["listItem"]!;
  const ul = schema.nodes["bulletList"]!;
  return ul.create(null, items.map((t) => li.create(null, paragraph(t))));
}

function doc(...children: Node[]): Node {
  return schema.nodes["doc"]!.create(null, children);
}

function collectIds(node: Node): Array<string | null> {
  const out: Array<string | null> = [];
  node.descendants((n) => {
    if (n.isBlock && "nodeId" in (n.type.spec.attrs ?? {})) {
      const id = n.attrs["nodeId"];
      out.push(typeof id === "string" ? id : null);
    }
    return true;
  });
  return out;
}

describe("assignBlockIds — fresh doc", () => {
  it("stamps every id-bearing block in a flat doc", () => {
    const input = doc(paragraph("a"), paragraph("b"), paragraph("c"));
    const output = assignBlockIds(input);

    const ids = collectIds(output);
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(3); // unique
  });

  it("walks into nested blocks (bulletList → listItem → paragraph)", () => {
    const input = doc(bulletList(["one", "two"]));
    const output = assignBlockIds(input);

    const ids = collectIds(output);
    // bulletList + 2 listItems + 2 paragraphs = 5 stamped blocks.
    expect(ids).toHaveLength(5);
    expect(ids.every((id) => typeof id === "string" && id!.length > 0)).toBe(
      true,
    );
  });
});

describe("assignBlockIds — idempotency", () => {
  it("returns the same node reference when every id-bearing block already has an id", () => {
    const seeded = assignBlockIds(doc(paragraph("a"), paragraph("b")));
    const second = assignBlockIds(seeded);
    expect(second).toBe(seeded); // referential equality, fast path
  });

  it("preserves existing ids and only stamps missing ones", () => {
    const p1 = paragraph("a", { nodeId: "fixed-id-1" });
    const p2 = paragraph("b"); // null nodeId
    const input = doc(p1, p2);

    const output = assignBlockIds(input);
    const ids = collectIds(output);

    expect(ids[0]).toBe("fixed-id-1");
    expect(typeof ids[1]).toBe("string");
    expect(ids[1]).not.toBe("fixed-id-1");
  });
});

describe("assignBlockIds — generator override", () => {
  it("uses the injected generator", () => {
    let counter = 0;
    const generate = () => `gen-${++counter}`;
    const input = doc(paragraph("a"), paragraph("b"));

    const output = assignBlockIds(input, { generate });
    const ids = collectIds(output);

    expect(ids).toEqual(["gen-1", "gen-2"]);
  });

  it("does not call the generator when no node needs an id", () => {
    let calls = 0;
    const generate = () => {
      calls++;
      return `g-${calls}`;
    };
    const seeded = assignBlockIds(doc(paragraph("a")));
    assignBlockIds(seeded, { generate });
    expect(calls).toBe(0);
  });
});

describe("assignBlockIds — schema fidelity", () => {
  it("does not assign ids to nodes whose schema does not declare nodeId", () => {
    // doc node itself has no nodeId attr — must not be mutated.
    const input = doc(paragraph("a"));
    const output = assignBlockIds(input);
    expect("nodeId" in (output.type.spec.attrs ?? {})).toBe(false);
    expect(output.attrs["nodeId"]).toBeUndefined();
  });

  it("does not assign ids to inline nodes (text)", () => {
    const input = doc(paragraph("hello world"));
    const output = assignBlockIds(input);
    // The paragraph gets an id; the text child does not.
    const textNode = output.firstChild!.firstChild!;
    expect(textNode.isText).toBe(true);
    expect(textNode.attrs["nodeId"]).toBeUndefined();
  });

  it("preserves non-nodeId attrs on the paragraph", () => {
    const input = doc(paragraph("a", { align: "center", indent: 2 }));
    const output = assignBlockIds(input);
    const p = output.firstChild!;
    expect(p.attrs["align"]).toBe("center");
    expect(p.attrs["indent"]).toBe(2);
    expect(typeof p.attrs["nodeId"]).toBe("string");
  });
});
