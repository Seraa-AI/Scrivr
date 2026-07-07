/**
 * The seam is the spine: custom nodes/marks plug in exactly like built-ins, and
 * anything unregistered degrades to a visible `unknown` unit instead of vanishing.
 * Also verifies the real TrackChanges wiring the mark seam exists for.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, Extension, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../index";

// A custom block node whose owning extension contributes a `semantic` handler —
// the "if I build a comment/callout extension" case.
const Callout = Extension.create({
  name: "callout",
  addNodes() {
    return {
      callout: {
        group: "block",
        content: "inline*",
        toDOM: () => ["div", { class: "callout" }, 0],
        parseDOM: [{ tag: "div.callout" }],
      },
    };
  },
  addExports() {
    return { semantic: { nodes: { callout: () => ({ type: "unknown", text: "CALLOUT" }) } } };
  },
});

// A custom node with NO semantic handler — must fall back, never drop.
const Bare = Extension.create({
  name: "bare",
  addNodes() {
    return {
      bare: {
        group: "block",
        content: "inline*",
        toDOM: () => ["div", { class: "bare" }, 0],
        parseDOM: [{ tag: "div.bare" }],
      },
    };
  },
});

function editorWith(exts: Extension[], nodeType: string, text: string): ServerEditor {
  const editor = new ServerEditor({ extensions: [StarterKit, ...exts] });
  const doc = editor.schema.node("doc", null, [
    editor.schema.node(nodeType, null, [editor.schema.text(text)]),
  ]);
  editor.setContent(doc.toJSON());
  return editor;
}

describe("semantic seam — custom extensions", () => {
  it("invokes a custom node's contributed handler", () => {
    const units = toSemanticUnits(editorWith([Callout], "callout", "hi"));
    expect(units).toHaveLength(1);
    expect(units[0]!.text).toBe("CALLOUT");
  });

  it("does not emit source-derived spans when a handler overrides text", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "source", marks: [{ type: "bold" }] }],
          },
        ],
      },
    });
    const units = toSemanticUnits(editor, {
      overrides: { nodes: { paragraph: () => ({ type: "paragraph", text: "replacement" }) } },
    });
    expect(units[0]!.text).toBe("replacement");
    expect(units[0]!.spans).toBeUndefined();
  });

  it("falls back to an unknown unit for an unregistered node, never dropping it", () => {
    const units = toSemanticUnits(editorWith([Bare], "bare", "orphan text"));
    expect(units).toHaveLength(1);
    expect(units[0]!.type).toBe("unknown");
    expect(units[0]!.text).toBe("orphan text");
  });

  it("lets per-call overrides win over contributed handlers", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
    });
    const units = toSemanticUnits(editor, {
      overrides: { nodes: { paragraph: () => ({ type: "unknown" }) } },
    });
    expect(units[0]!.type).toBe("unknown");
  });
});

// The track-changes mark-seam integration test lives in @scrivr/plugins
// (track-changes/__tests__/semanticExport.test.ts), next to the extension that
// owns the trackedDelete/trackedInsert marks.
