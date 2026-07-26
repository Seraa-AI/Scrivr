import { describe, it, expect } from "vitest";
import type { Node, Schema } from "prosemirror-model";
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

  it("gives null-id blocks a fresh id but keeps them out of the map", () => {
    const input = doc(
      paragraph("has-id", { nodeId: "keep" }),
      paragraph("no-id"), // nodeId defaults to null
    );

    const { doc: cloned, idMap } = recloneDocumentIds(input);
    const newIds = collectIds(cloned);

    expect(newIds.every((id) => typeof id === "string" && id!.length > 0)).toBe(true);
    expect(idMap.size).toBe(1); // only the block that had an id
    expect(idMap.has("keep")).toBe(true);
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
