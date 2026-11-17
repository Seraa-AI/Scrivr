/**
 * A colour, a size or a font excludes another of its kind, so setting one over
 * another replaces it inside one step. These run on the real marks: the test
 * schema's formatting marks exclude nothing, and cannot replace anything.
 */
import "@scrivr/export-semantic/augment";
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit, type InlineSpan } from "@scrivr/core";
import type { Node as PMNode } from "@scrivr/core/pm";
import { toSemanticUnits } from "@scrivr/export-semantic";
import { reviewChanges, TrackChanges, TrackChangesStatus } from "../index";
import { findChanges } from "../findChanges";
import { applyRichDiffAsSuggestion } from "../lib/applyRichDiffAsSuggestion";

type DocNode = Record<string, unknown>;

const text = (value: string, marks: DocNode[] = []): DocNode => ({ type: "text", text: value, ...(marks.length ? { marks } : {}) });
const color = (value: string): DocNode => ({ type: "color", attrs: { color: value } });

function editorWith(content: DocNode[], userID = "alice") {
  return new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID, initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "a" }, content }] },
  });
}

const pending = (editor: ServerEditor) => findChanges(editor.getState()).pending;

/** Each text run's own value of `markName` — with no tracking left on it — or null. */
function valuesOf(editor: ServerEditor, markName: string, attr: string) {
  const runs: (unknown | null)[] = [];
  editor.getState().doc.descendants((node: PMNode) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === markName);
    runs.push(mark ? mark.attrs[attr] : null);
  });
  return runs;
}

function format(editor: ServerEditor, from: number, to: number, markName: string, attrs: DocNode) {
  const type = editor.getState().schema.marks[markName];
  if (!type) throw new Error(`no ${markName}`);
  editor.applyTransaction(editor.getState().tr.addMark(from, to, type.create(attrs)));
}

const decideAll = (editor: ServerEditor, decision: "accepted" | "rejected") => {
  const ids = pending(editor).map((c) => c.id);
  const outcome = reviewChanges(editor, decision === "accepted" ? { accepted: ids, rejected: [] } : { accepted: [], rejected: ids });
  expect(outcome.status).toBe("applied");
  expect(pending(editor)).toEqual([]);
};

/** Bug class: a recolour that loses the colour it replaced, or the one it proposed. */
describe("setting a format over another of its kind", () => {
  it("restores the old colour when the recolour is rejected", () => {
    const editor = editorWith([text("hello", [color("blue")])]);
    format(editor, 1, 6, "color", { color: "red" });
    expect(pending(editor)).toHaveLength(1);
    decideAll(editor, "rejected");
    expect(valuesOf(editor, "color", "color")).toEqual(["blue"]);
  });

  it("keeps the new colour when the recolour is accepted", () => {
    const editor = editorWith([text("hello", [color("blue")])]);
    format(editor, 1, 6, "color", { color: "red" });
    decideAll(editor, "accepted");
    expect(valuesOf(editor, "color", "color")).toEqual(["red"]);
  });

  it("restores a size and a font the same way", () => {
    const editor = editorWith([text("hello", [{ type: "fontSize", attrs: { size: "12px" } }, { type: "fontFamily", attrs: { family: "Georgia" } }])]);
    format(editor, 1, 6, "fontSize", { size: "20px" });
    format(editor, 1, 6, "fontFamily", { family: "Arial" });
    decideAll(editor, "rejected");
    expect(valuesOf(editor, "fontSize", "size")).toEqual(["12px"]);
    expect(valuesOf(editor, "fontFamily", "family")).toEqual(["Georgia"]);
  });

  it("restores each colour of text that had several", () => {
    const editor = editorWith([text("ab", [color("blue")]), text("cd", [color("green")]), text("ef")]);
    format(editor, 1, 7, "color", { color: "red" });
    // Each run answers for what it replaced, so they are separate changes.
    expect(pending(editor).length).toBeGreaterThan(1);
    decideAll(editor, "rejected");
    expect(valuesOf(editor, "color", "color")).toEqual(["blue", "green", null]);
  });

  it("goes back past another author's pending recolour to the agreed colour", () => {
    const bob = editorWith([text("hello", [color("blue")])], "bob");
    format(bob, 1, 6, "color", { color: "red" });
    const alice = editorWith(bob.getState().doc.child(0).toJSON().content, "alice");
    format(alice, 1, 6, "color", { color: "green" });
    decideAll(alice, "rejected");
    expect(valuesOf(alice, "color", "color")).toEqual(["blue"]);
  });

  it("reads the colour it replaced as the text's formatting before the change", () => {
    const editor = editorWith([text("hello", [color("blue")])]);
    format(editor, 1, 6, "color", { color: "red" });
    const unit = toSemanticUnits(editor, { groupBlocks: false }).find((u) => u.id === "a");
    expect(unit?.changes?.[0]?.oldAttrs).toEqual({ marks: [{ type: "color", attrs: { color: "blue" } }] });
  });

  it("restores the old colour when an agent's recolour is rejected", () => {
    const editor = editorWith([text("hello", [color("blue")])]);
    const spans: InlineSpan[] = [{ text: "hello", marks: [{ type: "color", attrs: { color: "red" } }] }];
    applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), { edits: [{ nodeId: "a", spans }], authorID: "ai:Assistant" });
    expect(valuesOf(editor, "color", "color")).toEqual(["red"]);
    decideAll(editor, "rejected");
    expect(valuesOf(editor, "color", "color")).toEqual(["blue"]);
  });
});
