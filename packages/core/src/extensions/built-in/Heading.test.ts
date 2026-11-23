import { describe, expect, it } from "vitest";
import { AllSelection, EditorState, TextSelection } from "prosemirror-state";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { CellSelection } from "../../table/cellSelection";
import { ExtensionManager } from "../ExtensionManager";
// Through the package entry: a host types its own level variable with it.
import type { HeadingLevel } from "../../index";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

function editorWith(block: object, kit = StarterKit) {
  const e = new ServerEditor({ extensions: [kit], content: { type: "doc", content: [block] } });
  e.applyTransaction(e.getState().tr.setSelection(TextSelection.create(e.getState().doc, 2)));
  return e;
}
const blocks = (e: ServerEditor) => {
  const out: string[] = [];
  e.getState().doc.descendants((node) => {
    if (!node.isTextblock) return true;
    out.push(node.type.name === "heading" ? `h${String(node.attrs["level"])}` : node.type.name);
    return false;
  });
  return out;
};
const selectAll = (e: ServerEditor) => {
  const { doc } = e.getState();
  e.applyTransaction(e.getState().tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)));
};
const firstBlock = (e: ServerEditor) => {
  const node = e.getState().doc.firstChild;
  return { type: node?.type.name, level: node?.attrs["level"] };
};

describe("setHeading", () => {
  it("turns the caret's block into a heading of the level asked for", () => {
    const e = editorWith(p("one"));
    expect(e.commands.setHeading({ level: 2 })).toBe(true);
    expect(firstBlock(e)).toEqual({ type: "heading", level: 2 });
  });

  it("changes the level of a heading", () => {
    const e = editorWith(h(1, "one"));
    e.commands.setHeading({ level: 3 });
    expect(firstBlock(e)).toEqual({ type: "heading", level: 3 });
  });

  it("refuses a level the editor was not configured with", () => {
    const e = editorWith(p("one"), StarterKit.configure({ heading: { levels: [1, 2] } }));
    expect(e.commands.setHeading({ level: 3 })).toBe(false);
    expect(firstBlock(e)).toEqual({ type: "paragraph", level: undefined });
  });

  it("takes a level a host holds in a variable", () => {
    const e = editorWith(p("one"));
    const level: HeadingLevel = 4;
    e.commands.setHeading({ level });
    expect(firstBlock(e)).toEqual({ type: "heading", level: 4 });
  });

  it("reports false, not an error, when a caller passes no level", () => {
    // A toolbar or slash spec names its command but carries its args untyped.
    const e = editorWith(p("one"));
    expect(e.runCommand("setHeading")).toBe(false);
    expect(e.runCommand("setHeading", [null])).toBe(false);
    expect(e.runCommand("toggleHeading", [{}])).toBe(false);
    expect(firstBlock(e)).toEqual({ type: "paragraph", level: undefined });
  });
});

describe("toggleHeading", () => {
  it("turns a paragraph into the heading", () => {
    const e = editorWith(p("one"));
    expect(e.commands.toggleHeading({ level: 1 })).toBe(true);
    expect(firstBlock(e)).toEqual({ type: "heading", level: 1 });
  });

  it("turns that heading back into a paragraph", () => {
    const e = editorWith(h(1, "one"));
    expect(e.commands.toggleHeading({ level: 1 })).toBe(true);
    expect(firstBlock(e)).toEqual({ type: "paragraph", level: undefined });
  });

  it("moves a heading of another level to the one asked for", () => {
    const e = editorWith(h(2, "one"));
    e.commands.toggleHeading({ level: 1 });
    expect(firstBlock(e)).toEqual({ type: "heading", level: 1 });
  });

  it("refuses a level the editor was not configured with", () => {
    const e = editorWith(h(1, "one"), StarterKit.configure({ heading: { levels: [1, 2] } }));
    expect(e.commands.toggleHeading({ level: 3 })).toBe(false);
    expect(firstBlock(e)).toEqual({ type: "heading", level: 1 });
  });
});

describe("toggleHeading over several blocks", () => {
  function editorOf(...content: object[]) {
    return new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content: { type: "doc", content } });
  }

  it("turns every block into the heading unless all of them already are", () => {
    const e = editorOf(h(2, "one"), p("two"));
    selectAll(e);
    e.commands.toggleHeading({ level: 2 });
    // The trailing paragraph is TrailingNode's, after a document now ending in a heading.
    expect(blocks(e)).toEqual(["h2", "h2", "paragraph"]);
  });

  it("does the same whichever block the selection starts in", () => {
    const e = editorOf(p("one"), h(2, "two"));
    selectAll(e);
    e.commands.toggleHeading({ level: 2 });
    expect(blocks(e)).toEqual(["h2", "h2", "paragraph"]);
  });

  it("turns them all back into paragraphs when every one is that heading", () => {
    const e = editorOf(h(2, "one"), h(2, "two"));
    selectAll(e);
    e.commands.toggleHeading({ level: 2 });
    expect(blocks(e)).toEqual(["paragraph", "paragraph"]);
  });

  it("turns a whole document of headings off, with the empty paragraph TrailingNode keeps after it", () => {
    const e = editorOf(h(2, "one"), h(2, "two"));
    // One transaction lets TrailingNode add its paragraph before the selection is made.
    e.applyTransaction(e.getState().tr);
    expect(blocks(e)).toEqual(["h2", "h2", "paragraph"]);
    const toggleAll = () => {
      e.applyTransaction(e.getState().tr.setSelection(new AllSelection(e.getState().doc)));
      e.commands.toggleHeading({ level: 2 });
    };

    toggleAll();
    expect(blocks(e)).toEqual(["paragraph", "paragraph", "paragraph"]);
    toggleAll();
    toggleAll();
    expect(blocks(e)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });

  it("leaves the trailing empty paragraph alone when setting a heading over everything", () => {
    const e = editorOf(p("one"), p("two"));
    const setAll = () => {
      e.applyTransaction(e.getState().tr.setSelection(new AllSelection(e.getState().doc)));
      e.commands.setHeading({ level: 1 });
    };

    setAll();
    setAll();
    setAll();
    expect(blocks(e)).toEqual(["h1", "h1", "paragraph"]);
  });

  it("toggles an empty document's heading on and off without growing it", () => {
    const e = editorOf({ type: "paragraph" });
    const toggleAll = () => {
      e.applyTransaction(e.getState().tr.setSelection(new AllSelection(e.getState().doc)));
      e.commands.toggleHeading({ level: 2 });
    };

    toggleAll();
    expect(blocks(e)).toEqual(["h2", "paragraph"]);
    toggleAll();
    expect(blocks(e)).toEqual(["paragraph", "paragraph"]);
    toggleAll();
    expect(blocks(e)).toEqual(["h2", "paragraph"]);
  });

  it("still sets a heading on empty table cells and empty lines inside the selection", () => {
    const cell = (block: object) => ({ type: "tableCell", content: [block] });
    const e = editorOf({ type: "table", content: [{ type: "tableRow", content: [cell(p("a")), cell({ type: "paragraph" }), cell(p("c"))] }] }, p("after"));
    const cells: number[] = [];
    e.getState().doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    const first = cells[0];
    const last = cells[cells.length - 1];
    if (first === undefined || last === undefined) throw new Error("expected cells");
    const { doc } = e.getState();
    e.applyTransaction(e.getState().tr.setSelection(new CellSelection(doc.resolve(first), doc.resolve(last))));

    e.commands.setHeading({ level: 2 });
    expect(blocks(e)).toEqual(["h2", "h2", "h2", "paragraph"]);
  });

  it("keeps a block's alignment and id when its level changes, and reports nothing to do at the same level", () => {
    const e = editorWith({ type: "heading", attrs: { level: 2, align: "right", nodeId: "keep" }, content: [{ type: "text", text: "one" }] });
    expect(e.commands.setHeading({ level: 2 })).toBe(false);
    e.commands.setHeading({ level: 3 });
    const node = e.getState().doc.firstChild;
    expect([node?.attrs["level"], node?.attrs["align"], node?.attrs["nodeId"]]).toEqual([3, "right", "keep"]);
  });

  it("still sets the heading on an empty last line a drag ends in", () => {
    const e = editorOf(p("a"), p("b"), { type: "paragraph" });
    const end = e.getState().doc.content.size - 1;
    e.applyTransaction(e.getState().tr.setSelection(TextSelection.create(e.getState().doc, 1, end)));
    e.commands.setHeading({ level: 2 });
    expect(blocks(e).slice(0, 3)).toEqual(["h2", "h2", "h2"]);
  });

  it("reads a level stored as text as that level", () => {
    const e = editorOf({ type: "heading", attrs: { level: "2" }, content: [{ type: "text", text: "one" }] }, p("two"));
    e.applyTransaction(e.getState().tr.setSelection(TextSelection.create(e.getState().doc, 2)));
    e.commands.toggleHeading({ level: 2 });
    expect(blocks(e)[0]).toBe("paragraph");
  });

  it("turns headings in selected table cells back into paragraphs", () => {
    const cell = (block: object) => ({ type: "tableCell", content: [block] });
    const e = editorOf({ type: "table", content: [{ type: "tableRow", content: [cell(h(2, "a")), cell(h(2, "b"))] }] }, p("after"));
    const cells: number[] = [];
    e.getState().doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    const [first, second] = cells;
    if (first === undefined || second === undefined) throw new Error("expected two cells");
    const { doc } = e.getState();
    e.applyTransaction(e.getState().tr.setSelection(new CellSelection(doc.resolve(first), doc.resolve(second))));

    expect(e.commands.toggleHeading({ level: 2 })).toBe(true);
    expect(blocks(e)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });
});

describe("heading shortcuts", () => {
  it("apply the same rule as setHeading, leaving the document's empty last paragraph alone", () => {
    const manager = new ExtensionManager([StarterKit]);
    const doc = manager.schema.nodeFromJSON({ type: "doc", content: [h(2, "a"), h(2, "b"), { type: "paragraph" }] });
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });
    let next = state;
    const pressed = manager.buildKeymap()["Mod-Alt-1"]?.(state, (tr) => {
      next = state.apply(tr);
    });

    expect(pressed).toBe(true);
    const types: string[] = [];
    next.doc.forEach((node) => types.push(node.type.name === "heading" ? `h${String(node.attrs["level"])}` : node.type.name));
    expect(types).toEqual(["h1", "h1", "paragraph"]);
  });
});

describe("heading menu entries", () => {
  it("run setHeading with the level as their argument", () => {
    const e = editorWith(p("one"));
    const entry = e.getSlashCommands().find((spec) => spec.id === "heading.2");
    if (!entry) throw new Error("no heading.2 entry");
    expect(entry).toMatchObject({ command: "setHeading", args: [{ level: 2 }] });
    expect(e.runCommand(entry.command, entry.args)).toBe(true);
    expect(firstBlock(e)).toEqual({ type: "heading", level: 2 });
  });
});
