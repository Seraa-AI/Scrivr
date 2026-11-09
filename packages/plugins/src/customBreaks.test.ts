/**
 * A break declared by an extension outside core is a break to the plugins too:
 * an agent's rewrite reads a line break as "\n", and a header or footer refuses
 * a page break, whatever the nodes are called.
 */
import { describe, expect, it } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { applyRichDiffAsSuggestion, findChanges, TrackChanges, TrackChangesStatus } from "./index";
import { HeaderFooter } from "./header-footer/HeaderFooter";
import { HeaderFooterSurfaceCache } from "./header-footer/surfaces";

const Breaks = Extension.create({
  name: "customBreaks",
  addNodes() {
    return {
      sceneBreak: { group: "block", atom: true, layout: { kind: "break", breaks: "page" } },
      lineSeparator: { group: "inline", inline: true, selectable: false, attrs: { dataTracked: { default: [] } }, layout: { kind: "break", breaks: "line" } },
    };
  },
});

describe("a custom line break in an agent's rewrite", () => {
  it("is the newline the agent echoes, so a verbatim echo proposes nothing", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, Breaks, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
      content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p" }, content: [
        { type: "text", text: "one" }, { type: "lineSeparator" }, { type: "text", text: "two" },
      ] }] },
    });
    applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
      edits: [{ nodeId: "p", spans: [{ text: "one\ntwo", marks: [] }] }],
      authorID: "agent",
    });
    expect(findChanges(editor.getState()).pending).toEqual([]);
  });
});

describe("a custom page break in a header or footer", () => {
  it("is refused, as the built-in one is", () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Breaks, HeaderFooter] });
    const surface = new HeaderFooterSurfaceCache(editor.schema).getOrCreate("defaultFooter", {
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] },
    });
    const before = surface.state.doc.toJSON();
    const sceneBreak = editor.schema.nodes["sceneBreak"];
    if (!sceneBreak) throw new Error("no sceneBreak");
    surface.dispatch(surface.state.tr.insert(0, sceneBreak.create()));
    expect(surface.state.doc.toJSON()).toEqual(before);
  });

  it("refuses a section boundary too: a header or footer has no sections", () => {
    const editor = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    const surface = new HeaderFooterSurfaceCache(editor.schema).getOrCreate("defaultFooter", {
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] },
    });
    const before = surface.state.doc.toJSON();
    const sectionBreak = editor.schema.nodes["sectionBreak"];
    if (!sectionBreak) throw new Error("no sectionBreak");
    surface.dispatch(surface.state.tr.insert(0, sectionBreak.create()));
    expect(surface.state.doc.toJSON()).toEqual(before);
  });
});
