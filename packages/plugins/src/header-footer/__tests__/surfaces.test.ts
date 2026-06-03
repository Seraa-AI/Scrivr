import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { setBlockType } from "prosemirror-commands";
import { TextSelection } from "prosemirror-state";
import { HeaderFooter } from "../HeaderFooter";
import { HeaderFooterSurfaceCache, HEADER_FOOTER_BLOCKED_NODES } from "../surfaces";
import type { HeaderFooterDefinition } from "../types";

function makeDef(text = "hello"): HeaderFooterDefinition {
  return {
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  };
}

function makeEditor() {
  // Tables are opt-in in StarterKit — enable so the blocked-node filter test
  // can construct a real table NodeType from the editor's schema.
  return new ServerEditor({
    extensions: [StarterKit.configure({ table: true }), HeaderFooter],
  });
}

describe("HeaderFooterSurfaceCache", () => {
  it("surface state uses the same Schema instance as the host editor", () => {
    const editor = makeEditor();
    const cache = new HeaderFooterSurfaceCache(editor.schema);
    const surface = cache.getOrCreate("defaultHeader", makeDef());

    // NodeType identity must match — that's what unblocks every extension
    // command (heading, paragraph, lists, marks) inside the surface.
    expect(surface.schema).toBe(editor.schema);
    expect(surface.state.doc.type).toBe(editor.schema.nodes["doc"]);
  });

  it("setBlockType(heading) succeeds against a surface — the heading↔paragraph regression fix", () => {
    const editor = makeEditor();
    const cache = new HeaderFooterSurfaceCache(editor.schema);
    const surface = cache.getOrCreate("defaultHeader", makeDef("title"));

    // Place caret inside the paragraph (offset 1 — first text position).
    surface.dispatch(
      surface.state.tr.setSelection(
        TextSelection.create(surface.state.doc, 1),
      ),
    );

    const headingType = editor.schema.nodes["heading"]!;
    const cmd = setBlockType(headingType, { level: 2 });
    const applied = cmd(surface.state, (tr) => surface.dispatch(tr));

    expect(applied).toBe(true);
    expect(surface.state.doc.firstChild?.type.name).toBe("heading");
    expect(surface.state.doc.firstChild?.attrs["level"]).toBe(2);
  });

  it("setBlockType(paragraph) converts a heading back to a paragraph", () => {
    const editor = makeEditor();
    const cache = new HeaderFooterSurfaceCache(editor.schema);
    const surface = cache.getOrCreate("defaultHeader", {
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "title" }],
          },
        ],
      },
    });

    surface.dispatch(
      surface.state.tr.setSelection(
        TextSelection.create(surface.state.doc, 1),
      ),
    );

    const paragraphType = editor.schema.nodes["paragraph"]!;
    const applied = setBlockType(paragraphType)(
      surface.state,
      (tr) => surface.dispatch(tr),
    );

    expect(applied).toBe(true);
    expect(surface.state.doc.firstChild?.type.name).toBe("paragraph");
  });

  it("blocked-node filter rejects a transaction that introduces a table", () => {
    const editor = makeEditor();
    const cache = new HeaderFooterSurfaceCache(editor.schema);
    const surface = cache.getOrCreate("defaultHeader", makeDef());

    const before = surface.state.doc.toJSON();
    const tableType = editor.schema.nodes["table"];
    expect(tableType).toBeDefined();

    // Construct a tr that inserts a single-cell table at the start of the doc.
    const cell = editor.schema.nodes["tableCell"]!.create(
      null,
      editor.schema.nodes["paragraph"]!.create(),
    );
    const row = editor.schema.nodes["tableRow"]!.create(null, cell);
    const table = tableType!.create(null, row);

    surface.dispatch(surface.state.tr.insert(0, table));

    // filterTransaction returns false → state.apply is a no-op, doc unchanged.
    expect(surface.state.doc.toJSON()).toEqual(before);
  });

  it("blocked-node filter rejects a pageBreak insertion", () => {
    const editor = makeEditor();
    const cache = new HeaderFooterSurfaceCache(editor.schema);
    const surface = cache.getOrCreate("defaultFooter", makeDef());

    const before = surface.state.doc.toJSON();
    const pageBreakType = editor.schema.nodes["pageBreak"]!;
    surface.dispatch(surface.state.tr.insert(0, pageBreakType.create()));

    expect(surface.state.doc.toJSON()).toEqual(before);
  });

  it("non-blocked nodes pass through (paragraphs still work)", () => {
    const editor = makeEditor();
    const cache = new HeaderFooterSurfaceCache(editor.schema);
    const surface = cache.getOrCreate("defaultHeader", makeDef("a"));

    surface.dispatch(
      surface.state.tr.insertText("bc", surface.state.doc.content.size - 1),
    );

    expect(surface.state.doc.textContent).toBe("abc");
  });

  it("exports HEADER_FOOTER_BLOCKED_NODES as a stable list", () => {
    expect(HEADER_FOOTER_BLOCKED_NODES.has("table")).toBe(true);
    expect(HEADER_FOOTER_BLOCKED_NODES.has("tableRow")).toBe(true);
    expect(HEADER_FOOTER_BLOCKED_NODES.has("tableCell")).toBe(true);
    expect(HEADER_FOOTER_BLOCKED_NODES.has("pageBreak")).toBe(true);
    expect(HEADER_FOOTER_BLOCKED_NODES.has("paragraph")).toBe(false);
    expect(HEADER_FOOTER_BLOCKED_NODES.has("heading")).toBe(false);
  });
});
