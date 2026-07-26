import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "./ServerEditor";
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
