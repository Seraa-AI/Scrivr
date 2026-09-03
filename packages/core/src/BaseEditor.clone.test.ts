import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "./ServerEditor";
import { StarterKit } from "./extensions/StarterKit";
import { Extension } from "./extensions/Extension";
import { createTestEditor } from "./test-utils";

/** A two-paragraph doc with explicit, persisted nodeIds. */
const CONTENT = {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { nodeId: "p-a" }, content: [{ type: "text", text: "alpha" }] },
    { type: "paragraph", attrs: { nodeId: "p-b" }, content: [{ type: "text", text: "beta" }] },
  ],
};

function idsOf(doc: Node): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.isBlock && "nodeId" in (n.type.spec.attrs ?? {})) {
      const id = n.attrs["nodeId"];
      if (typeof id === "string") out.push(id);
    }
    return true;
  });
  return out;
}

describe("clone mode — ServerEditor", () => {
  it("re-mints ids and exposes the old→new map", () => {
    const editor = new ServerEditor({ content: CONTENT, clone: true });
    const ids = idsOf(editor.getState().doc);

    expect(ids).toHaveLength(2);
    expect(ids).not.toContain("p-a");
    expect(ids).not.toContain("p-b");

    const map = editor.cloneIdMap;
    expect(map).not.toBeNull();
    expect(map!.get("p-a")).toBe(ids[0]);
    expect(map!.get("p-b")).toBe(ids[1]);
    expect(map!.size).toBe(2);
  });

  it("preserves document text through the clone", () => {
    const editor = new ServerEditor({ content: CONTENT, clone: true });
    expect(editor.getState().doc.textContent).toBe("alphabeta");
  });

  it("leaves ids and cloneIdMap untouched when clone is off", () => {
    const editor = new ServerEditor({ content: CONTENT });
    // ServerEditor preserves persisted ids on load (no fabrication).
    expect(idsOf(editor.getState().doc)).toEqual(["p-a", "p-b"]);
    expect(editor.cloneIdMap).toBeNull();
  });
});

describe("clone mode — Editor (browser)", () => {
  it("re-mints ids and exposes the map on the browser surface too", () => {
    const editor = createTestEditor({ content: CONTENT, clone: true });
    const ids = idsOf(editor.getState().doc);

    expect(ids).not.toContain("p-a");
    expect(ids).not.toContain("p-b");
    expect(editor.cloneIdMap!.get("p-a")).toBe(ids[0]);

    editor.destroy();
  });
});

describe("clone mode — options and extension hooks", () => {
  it("forwards RecloneOptions (custom generate) through the editor", () => {
    const editor = new ServerEditor({
      content: CONTENT,
      clone: { generate: ({ oldId }) => `v2-${oldId}` },
    });
    expect(idsOf(editor.getState().doc)).toEqual(["v2-p-a", "v2-p-b"]);
    expect(editor.cloneIdMap!.get("p-a")).toBe("v2-p-a");
  });

  // An extension that owns a custom id space (a `refId` doc attr referencing a
  // block nodeId) uses addCloneHandlers to remap it onto the clone.
  const RefExt = Extension.create({
    name: "refTest",
    addDocAttrs() {
      return { refId: { default: null } };
    },
    addCloneHandlers() {
      return [
        ({ doc, idMap }) => {
          const oldRef = doc.attrs["refId"];
          if (typeof oldRef !== "string") return;
          const newRef = idMap.get(oldRef);
          if (!newRef) return;
          // Rebuild the doc node with the remapped reference.
          return doc.type.create({ ...doc.attrs, refId: newRef }, doc.content, doc.marks);
        },
      ];
    },
  });

  it("runs extension clone handlers to remap custom references via the idMap", () => {
    const content = {
      type: "doc",
      attrs: { refId: "p-a" }, // points at the first paragraph's nodeId
      content: CONTENT.content,
    };
    const editor = new ServerEditor({
      extensions: [StarterKit, RefExt],
      content,
      clone: true,
    });

    const map = editor.cloneIdMap!;
    const newFirst = map.get("p-a")!;
    // The handler rewrote the doc-level reference to the clone's new id.
    expect(editor.getState().doc.attrs["refId"]).toBe(newFirst);
    expect(newFirst).not.toBe("p-a");
  });

  it("re-normalizes clone-handler output and reports sanitization", () => {
    const UnsafeLinkExt = Extension.create({
      name: "unsafeCloneTest",
      addCloneHandlers() {
        return [({ doc }) => {
          const link = doc.type.schema.marks["link"]!.create({ href: "javascript:alert(1)" });
          const paragraph = doc.type.schema.nodes["paragraph"]!.create(
            { nodeId: doc.firstChild!.attrs["nodeId"] },
            doc.type.schema.text("unsafe", [link]),
          );
          return doc.type.create(doc.attrs, paragraph);
        }];
      },
    });
    const editor = new ServerEditor({
      extensions: [StarterKit, UnsafeLinkExt],
      content: CONTENT,
      clone: true,
    });

    expect(editor.getState().doc.firstChild!.firstChild!.marks).toHaveLength(0);
    expect(editor.lastNormalizeResult!.doc).toBe(editor.getState().doc);
    expect(editor.lastNormalizeResult!.warnings.some((warning) => warning.code === "urls-sanitized")).toBe(true);
  });

  it("rejects a clone handler that returns a node from another schema", () => {
    const ForeignDocExt = Extension.create({
      name: "foreignCloneTest",
      addCloneHandlers() {
        return [() => new ServerEditor({ content: CONTENT }).getState().doc];
      },
    });
    expect(() => new ServerEditor({
      extensions: [StarterKit, ForeignDocExt],
      content: CONTENT,
      clone: true,
    })).toThrow(/different schema/);
  });
});
