import { describe, it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import type { Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { recloneDocumentIds } from "./assignBlockIds";

const schema: Schema = new ExtensionManager([StarterKit]).schema;

function paragraph(text: string, attrs: Record<string, unknown> = {}): Node {
  return schema.nodes["paragraph"]!.create(attrs, schema.text(text));
}

function bulletList(items: Array<Record<string, unknown>>): Node {
  const li = schema.nodes["listItem"]!;
  const ul = schema.nodes["bulletList"]!;
  return ul.create(
    { nodeId: "list-old" },
    items.map((attrs) => li.create(attrs, paragraph("item", attrs))),
  );
}

function doc(...children: Node[]): Node {
  return schema.nodes["doc"]!.create(null, children);
}

/** Collect [nodeId] for every id-bearing block, in document order. */
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

describe("recloneDocumentIds", () => {
  it("re-mints a fresh, unique id on every id-bearing block", () => {
    const input = doc(
      paragraph("a", { nodeId: "a1" }),
      paragraph("b", { nodeId: "b1" }),
      paragraph("c", { nodeId: "c1" }),
    );

    const { doc: cloned } = recloneDocumentIds(input);
    const newIds = collectIds(cloned);

    expect(newIds).toHaveLength(3);
    expect(newIds.every((id) => typeof id === "string" && id!.length > 0)).toBe(true);
    expect(new Set(newIds).size).toBe(3); // all unique
    // Not one survives from the source.
    expect(newIds).not.toContain("a1");
    expect(newIds).not.toContain("b1");
    expect(newIds).not.toContain("c1");
  });

  it("returns an old→new map covering every non-null source id", () => {
    const input = doc(
      paragraph("a", { nodeId: "a1" }),
      paragraph("b", { nodeId: "b1" }),
    );

    const { doc: cloned, idMap } = recloneDocumentIds(input);
    const newIds = collectIds(cloned);

    expect(idMap.size).toBe(2);
    // Each mapping points at the id actually written onto the clone.
    expect(idMap.get("a1")).toBe(newIds[0]);
    expect(idMap.get("b1")).toBe(newIds[1]);
  });

  it("re-keys nested blocks (list items) and maps their ids too", () => {
    const input = doc(
      paragraph("intro", { nodeId: "p-old" }),
      bulletList([{ nodeId: "li-1" }, { nodeId: "li-2" }]),
    );

    const { doc: cloned, idMap } = recloneDocumentIds(input);

    // list + 2 list items + 2 item paragraphs + intro paragraph = 6 blocks
    expect(collectIds(cloned)).toHaveLength(6);
    // Every explicitly-set nested id was mapped.
    for (const old of ["p-old", "list-old", "li-1", "li-2"]) {
      expect(idMap.has(old)).toBe(true);
    }
  });

  it("leaves null-id blocks untouched and out of the map (pure re-key)", () => {
    const input = doc(
      paragraph("has-id", { nodeId: "keep" }),
      paragraph("no-id"), // nodeId defaults to null
    );

    const { doc: cloned, idMap } = recloneDocumentIds(input);
    const newIds = collectIds(cloned);

    expect(idMap.size).toBe(1); // only the block that had an id
    expect(idMap.has("keep")).toBe(true);
    // The null block stays null — clone re-keys, it does not invent ids.
    expect(newIds.filter((id) => id === null)).toHaveLength(1);
  });

  it("preserves text, marks, and non-nodeId attrs", () => {
    const bold = schema.marks["bold"]!;
    const input = doc(
      schema.nodes["heading"]!.create(
        { nodeId: "h1", level: 3 },
        schema.text("Title", [bold.create()]),
      ),
    );

    const { doc: cloned } = recloneDocumentIds(input);
    const heading = cloned.firstChild!;

    expect(heading.attrs["level"]).toBe(3);
    expect(heading.textContent).toBe("Title");
    expect(heading.firstChild!.marks.some((m) => m.type === bold)).toBe(true);
    expect(heading.attrs["nodeId"]).not.toBe("h1");
  });

  it("is deterministic with an injected generator", () => {
    const input = doc(
      paragraph("a", { nodeId: "a1" }),
      paragraph("b", { nodeId: "b1" }),
    );
    let counter = 0;
    const generate = () => `gen-${++counter}`;

    const { idMap } = recloneDocumentIds(input, { generate });

    expect(idMap.get("a1")).toBe("gen-1");
    expect(idMap.get("b1")).toBe("gen-2");
  });

  it("does not mutate the source document", () => {
    const input = doc(paragraph("a", { nodeId: "a1" }));
    const before = collectIds(input);

    recloneDocumentIds(input);

    expect(collectIds(input)).toEqual(before); // "a1" still there, untouched
    expect(before).toEqual(["a1"]);
  });
});

// A schema with a CUSTOM inline atom node and a CUSTOM mark, both carrying a
// nodeId — proves clone is schema-driven and not limited to built-in blocks.
const customSchema: Schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    para: { group: "block", content: "inline*", attrs: { nodeId: { default: null } } },
    widget: { group: "inline", inline: true, atom: true, attrs: { nodeId: { default: null } } },
    text: { group: "inline" },
  },
  marks: {
    marker: { attrs: { nodeId: { default: null } } },
  },
});

function customDoc(): Node {
  const marker = customSchema.marks["marker"]!.create({ nodeId: "m1" });
  return customSchema.nodes["doc"]!.create(null, [
    customSchema.nodes["para"]!.create({ nodeId: "p1" }, [
      customSchema.text("hi", [marker]),
      customSchema.nodes["widget"]!.create({ nodeId: "w1" }),
    ]),
  ]);
}

describe("recloneDocumentIds — custom nodes and marks", () => {
  it("re-keys a custom inline node, a custom mark, and a custom block alike", () => {
    const { doc: cloned, idMap } = recloneDocumentIds(customDoc());

    // All three id spaces re-keyed and mapped.
    expect(new Set([...idMap.keys()])).toEqual(new Set(["p1", "m1", "w1"]));

    const para = cloned.firstChild!;
    expect(para.attrs["nodeId"]).toBe(idMap.get("p1"));
    // widget (inline atom) re-keyed
    const widget = para.child(1);
    expect(widget.attrs["nodeId"]).toBe(idMap.get("w1"));
    // marker (mark on the text node) re-keyed
    const markerMark = para.child(0).marks[0]!;
    expect(markerMark.attrs["nodeId"]).toBe(idMap.get("m1"));
  });

  it("shouldReclone restricts which types re-key (and appear in the map)", () => {
    const { doc: cloned, idMap } = recloneDocumentIds(customDoc(), {
      shouldReclone: ({ typeName }) => typeName === "para",
    });

    expect([...idMap.keys()]).toEqual(["p1"]);
    const para = cloned.firstChild!;
    // widget + marker kept their original ids
    expect(para.child(1).attrs["nodeId"]).toBe("w1");
    expect(para.child(0).marks[0]!.attrs["nodeId"]).toBe("m1");
  });

  it("generate controls the new id value", () => {
    const { idMap } = recloneDocumentIds(customDoc(), {
      generate: ({ oldId, kind }) => `${kind}:${oldId}:new`,
    });

    expect(idMap.get("p1")).toBe("node:p1:new");
    expect(idMap.get("w1")).toBe("node:w1:new");
    expect(idMap.get("m1")).toBe("mark:m1:new");
  });

  it("reuses one replacement when the same logical mark id spans text nodes", () => {
    const marker = customSchema.marks["marker"]!.create({ nodeId: "shared" });
    const input = customSchema.nodes["doc"]!.create(null, [
      customSchema.nodes["para"]!.create({ nodeId: "p1" }, [
        customSchema.text("one", [marker]),
        customSchema.nodes["widget"]!.create({ nodeId: "w1" }),
        customSchema.text("two", [marker]),
      ]),
    ]);
    let calls = 0;

    const { doc: cloned, idMap } = recloneDocumentIds(input, {
      generate: ({ oldId }) => `${oldId}-${++calls}`,
    });

    const para = cloned.firstChild!;
    expect(para.child(0).marks[0]!.attrs["nodeId"]).toBe(idMap.get("shared"));
    expect(para.child(2).marks[0]!.attrs["nodeId"]).toBe(idMap.get("shared"));
    expect(calls).toBe(3); // paragraph, shared marker, and widget
  });

  it("supports type-specific lookup when separate carriers reuse an old id", () => {
    const marker = customSchema.marks["marker"]!.create({ nodeId: "same" });
    const input = customSchema.nodes["doc"]!.create(null, [
      customSchema.nodes["para"]!.create({ nodeId: "same" }, customSchema.text("text", [marker])),
    ]);

    const { idMap } = recloneDocumentIds(input, {
      generate: ({ kind, typeName }) => `${kind}-${typeName}`,
    });

    expect(idMap.getByType("same", "para")).toBe("node-para");
    expect(idMap.getByType("same", "marker", "mark")).toBe("mark-marker");
    expect(idMap.get("same")).toBe("mark-marker"); // first carrier in traversal order
  });

  it.each(["", "same"])("rejects a generator result that is not a fresh id: %j", (generated) => {
    const input = doc(paragraph("a", { nodeId: "same" }));
    expect(() => recloneDocumentIds(input, { generate: () => generated })).toThrow();
  });

  it("rejects duplicate generated ids for distinct source identities", () => {
    const input = doc(
      paragraph("a", { nodeId: "a" }),
      paragraph("b", { nodeId: "b" }),
    );
    expect(() => recloneDocumentIds(input, { generate: () => "duplicate" })).toThrow(/duplicate id/);
  });
});
