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
import { changeActs, reviewChanges, TrackChanges, TrackChangesStatus } from "../index";
import { findChanges } from "../findChanges";
import { applyRichDiffAsSuggestion } from "../lib/applyRichDiffAsSuggestion";
import { isMarkRemoved } from "../semanticChanges";

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

  it("gives an agent's recolour over a pending one the agreed colour, not the suggestion", () => {
    const bob = editorWith([text("hello", [color("blue")])], "bob");
    format(bob, 1, 6, "color", { color: "red" });
    const editor = editorWith(bob.getState().doc.child(0).toJSON().content, "alice");
    const spans: InlineSpan[] = [{ text: "hello", marks: [{ type: "color", attrs: { color: "green" } }] }];
    applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), { edits: [{ nodeId: "a", spans }], authorID: "ai:Assistant" });
    decideAll(editor, "rejected");
    expect(valuesOf(editor, "color", "color")).toEqual(["blue"]);
  });

  it("proposes nothing when the agreed value is set back", () => {
    const editor = editorWith([text("hello", [color("blue")])]);
    format(editor, 1, 6, "color", { color: "red" });
    format(editor, 1, 6, "color", { color: "blue" });
    expect(pending(editor)).toEqual([]);
    expect(valuesOf(editor, "color", "color")).toEqual(["blue"]);
  });

  it("keeps the agreed value when it is set again over a pending removal", () => {
    const bob = editorWith([text("hello", [color("blue")])], "bob");
    bob.applyTransaction(bob.getState().tr.removeMark(1, 6, bob.getState().schema.marks["color"]));
    const alice = editorWith(bob.getState().doc.child(0).toJSON().content, "alice");
    format(alice, 1, 6, "color", { color: "blue" });
    if (pending(alice).length > 0) decideAll(alice, "rejected");
    expect(valuesOf(alice, "color", "color")).toEqual(["blue"]);
  });

  it("turns clearing a pending recolour into a pending removal of the agreed colour", () => {
    const editor = editorWith([text("hello", [color("blue")])]);
    format(editor, 1, 6, "color", { color: "red" });
    editor.applyTransaction(editor.getState().tr.removeMark(1, 6, editor.getState().schema.marks["color"]));
    expect(pending(editor)).toHaveLength(1);
    const rejected = editorWith(editor.getState().doc.child(0).toJSON().content);
    decideAll(rejected, "rejected");
    expect(valuesOf(rejected, "color", "color")).toEqual(["blue"]);
    decideAll(editor, "accepted");
    expect(valuesOf(editor, "color", "color")).toEqual([null]);
  });

  it("offers each colour's run as its own act", () => {
    const editor = editorWith([text("ab", [color("blue")]), text("cd", [color("green")]), text("ef")]);
    format(editor, 1, 7, "color", { color: "red" });
    expect(changeActs(pending(editor))).toHaveLength(3);
  });

  it("changes a link's address as one change that restores the old one", () => {
    const link = (href: string): DocNode => ({ type: "link", attrs: { href } });
    const editor = editorWith([text("site", [link("https://a.example")])]);
    expect(editor.commands.setLinkHref(1, 5, "https://b.example")).toBe(true);
    expect(valuesOf(editor, "link", "href")).toEqual(["https://b.example"]);
    const rejected = editorWith(editor.getState().doc.child(0).toJSON().content);
    decideAll(rejected, "rejected");
    expect(valuesOf(rejected, "link", "href")).toEqual(["https://a.example"]);
    decideAll(editor, "accepted");
    expect(valuesOf(editor, "link", "href")).toEqual(["https://b.example"]);
  });

  it("lets the later of two colours set in one transaction stand", () => {
    const editor = editorWith([text("hello", [color("blue")])]);
    const type = editor.getState().schema.marks["color"]!;
    editor.applyTransaction(editor.getState().tr.addMark(1, 6, type.create({ color: "red" })).addMark(3, 6, type.create({ color: "green" })));
    expect(valuesOf(editor, "color", "color")).toEqual(["red", "green"]);
    decideAll(editor, "rejected");
    expect(valuesOf(editor, "color", "color")).toEqual(["blue"]);
  });

  it("reads what a recolour replaced where it stood, with typing before it in steps on either side", () => {
    const editor = editorWith([text("ab", [color("blue")]), text("cd", [color("green")])]);
    const type = editor.getState().schema.marks["color"]!;
    const tr = editor.getState().tr.insertText("XY", 1).addMark(5, 7, type.create({ color: "red" })).insertText("Z", 1);
    editor.applyTransaction(tr);
    decideAll(editor, "rejected");
    expect(valuesOf(editor, "color", "color")).toEqual(["blue", "green"]);
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

const seeded = (start: number) => {
  let seed = start;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const PALETTE = ["red", "green", "yellow"];
const START = [text("ab", [color("blue")]), text("cd"), text("ef", [color("green")]), text("gh", [color("blue")])];

/** Several authors recolour, clear and re-set colours, some twice in one transaction. */
function colourScenario(seed: number) {
  const random = seeded(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  let editor = editorWith(START);
  for (let i = 0, steps = 2 + Math.floor(random() * 5); i < steps; i++) {
    editor = editorWith(editor.getState().doc.child(0).toJSON().content, pick(["alice", "bob", "carol"]));
    const type = editor.getState().schema.marks["color"]!;
    const from = 1 + Math.floor(random() * 7);
    const to = Math.min(9, from + 1 + Math.floor(random() * 4));
    const kind = random();
    const tr = editor.getState().tr;
    if (kind < 0.5) tr.addMark(from, to, type.create({ color: pick([...PALETTE, "blue"]) }));
    else if (kind < 0.75) tr.removeMark(from, to, type);
    else tr.addMark(from, to, type.create({ color: pick(PALETTE) })).addMark(from, to, type.create({ color: pick(PALETTE) }));
    editor.applyTransaction(tr);
  }
  return editor;
}

/** Each character's colour, so runs split differently still compare; `proposed` leaves out a colour proposed for removal. */
function colourByChar(editor: ServerEditor, proposed = false) {
  const chars: (unknown | null)[] = [];
  editor.getState().doc.descendants((node: PMNode) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === "color" && !(proposed && isMarkRemoved(m)));
    for (let i = 0; i < node.nodeSize; i++) chars.push(mark ? mark.attrs["color"] : null);
  });
  return chars;
}

/** Bug class: a review of formatting that does not land on the original, or on what was shown. */
describe("any run of recolouring can be decided", () => {
  const ORIGINAL = colourByChar(editorWith(START));

  it("rejecting everything gives back the original colours", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const editor = colourScenario(seed);
      if (pending(editor).length > 0) decideAll(editor, "rejected");
      expect(colourByChar(editor), `seed ${seed}`).toEqual(ORIGINAL);
    }
  });

  it("accepting everything gives the colours proposed", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const editor = colourScenario(seed);
      const proposal = colourByChar(editor, true);
      if (pending(editor).length > 0) decideAll(editor, "accepted");
      expect(colourByChar(editor), `seed ${seed}`).toEqual(proposal);
    }
  });
});
