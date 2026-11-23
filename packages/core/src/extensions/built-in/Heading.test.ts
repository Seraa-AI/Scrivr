import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

function editorWith(block: object, kit = StarterKit) {
  const e = new ServerEditor({ extensions: [kit], content: { type: "doc", content: [block] } });
  e.applyTransaction(e.getState().tr.setSelection(TextSelection.create(e.getState().doc, 2)));
  return e;
}
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
