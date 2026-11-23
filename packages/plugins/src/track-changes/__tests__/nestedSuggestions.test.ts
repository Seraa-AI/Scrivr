/**
 * A colour excludes another colour, so a suggestion set over another author's
 * cannot stand beside it. The change over it holds it instead, and every
 * author's suggestion stays until someone decides it.
 */
import "@scrivr/export-semantic/augment";
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { Node as PMNode } from "@scrivr/core/pm";
import { toSemanticUnits } from "@scrivr/export-semantic";
import { planReview, reviewChanges, TrackChanges, TrackChangesStatus } from "../index";
import { findChanges } from "../findChanges";
import { changeAtCaret } from "../createChangePopover";
import type { TrackedChange } from "../types";

type DocNode = Record<string, unknown>;

const blue = (): DocNode => ({ type: "text", text: "hello", marks: [{ type: "color", attrs: { color: "blue" } }] });

function editorWith(content: unknown, userID: string) {
  return new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID, initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "a" }, content }] },
  });
}

/** The same document, opened by another author. */
const handTo = (editor: ServerEditor, userID: string) => editorWith(editor.getState().doc.child(0).toJSON().content, userID);

function recolour(editor: ServerEditor, value: string) {
  const type = editor.getState().schema.marks["color"]!;
  editor.applyTransaction(editor.getState().tr.addMark(1, 6, type.create({ color: value })));
}

function clearColour(editor: ServerEditor) {
  editor.applyTransaction(editor.getState().tr.removeMark(1, 6, editor.getState().schema.marks["color"]));
}

const pending = (editor: ServerEditor) => findChanges(editor.getState()).pending;
const by = (editor: ServerEditor, author: string, operation = "insert"): TrackedChange => {
  const change = pending(editor).find((c) => c.dataTracked.authorID === author && c.dataTracked.operation === operation);
  if (!change) throw new Error(`no pending ${operation} by ${author}`);
  return change;
};

/** The colour along the text: one value, or the runs of it. */
function shown(editor: ServerEditor) {
  const values: (unknown | null)[] = [];
  editor.getState().doc.descendants((node: PMNode) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === "color");
    const value = mark ? mark.attrs["color"] : null;
    if (values[values.length - 1] !== value) values.push(value);
  });
  return values.length === 1 ? values[0] : values;
}

function decide(editor: ServerEditor, accepted: TrackedChange[], rejected: TrackedChange[]) {
  const outcome = reviewChanges(editor, { accepted: accepted.map((c) => c.id), rejected: rejected.map((c) => c.id) });
  expect(outcome.status).toBe("applied");
}

/** Blue agreed; Bob suggests red; Alice suggests green over it. */
function aliceOverBob() {
  const bob = editorWith([blue()], "bob");
  recolour(bob, "red");
  const alice = handTo(bob, "alice");
  recolour(alice, "green");
  return alice;
}

/** Bug class: one author's edit silently dropping another author's suggestion. */
describe("a suggestion over another author's", () => {
  it("shows the new value and lists both, the held one within its holder", () => {
    const editor = aliceOverBob();
    expect(shown(editor)).toBe("green");
    const alice = by(editor, "alice");
    const bob = by(editor, "bob");
    expect(bob.type === "mark-change" && bob.within).toEqual([alice.id]);
    expect(alice.type === "mark-change" && alice.within).toBeUndefined();
  });

  it("gives Bob's suggestion back, still his, when Alice's is rejected", () => {
    const editor = aliceOverBob();
    decide(editor, [], [by(editor, "alice")]);
    expect(shown(editor)).toBe("red");
    expect(pending(editor).map((c) => c.dataTracked.authorID)).toEqual(["bob"]);
    decide(editor, [], [by(editor, "bob")]);
    expect(shown(editor)).toBe("blue");
  });

  it("returns the agreed colour when both are rejected in one review", () => {
    const editor = aliceOverBob();
    decide(editor, [], [by(editor, "alice"), by(editor, "bob")]);
    expect(shown(editor)).toBe("blue");
    expect(pending(editor)).toEqual([]);
  });

  it("discards Bob's when Alice's is accepted, whatever is said of his", () => {
    for (const bobDecision of ["none", "accepted", "rejected"] as const) {
      const editor = aliceOverBob();
      const bob = by(editor, "bob");
      decide(editor, [by(editor, "alice"), ...(bobDecision === "accepted" ? [bob] : [])], bobDecision === "rejected" ? [bob] : []);
      expect(shown(editor)).toBe("green");
      expect(pending(editor)).toEqual([]);
    }
  });

  it("settles Bob's red as agreed when Alice's is rejected and his accepted", () => {
    const editor = aliceOverBob();
    decide(editor, [by(editor, "bob")], [by(editor, "alice")]);
    expect(shown(editor)).toBe("red");
    expect(pending(editor)).toEqual([]);
  });

  it("decides Bob's alone while Alice's stays pending, and Alice's then restores the new agreed value", () => {
    const accepted = aliceOverBob();
    decide(accepted, [by(accepted, "bob")], []);
    expect(shown(accepted)).toBe("green");
    expect(pending(accepted).map((c) => c.dataTracked.authorID)).toEqual(["alice"]);
    decide(accepted, [], [by(accepted, "alice")]);
    expect(shown(accepted)).toBe("red");

    const rejected = aliceOverBob();
    decide(rejected, [], [by(rejected, "bob")]);
    expect(pending(rejected).map((c) => c.dataTracked.authorID)).toEqual(["alice"]);
    decide(rejected, [], [by(rejected, "alice")]);
    expect(shown(rejected)).toBe("blue");
  });

  it("keeps three authors' suggestions, each decidable", () => {
    const carol = handTo(aliceOverBob(), "carol");
    recolour(carol, "yellow");
    expect(pending(carol).map((c) => c.dataTracked.authorID).sort()).toEqual(["alice", "bob", "carol"]);

    const rejectAll = handTo(carol, "carol");
    decide(rejectAll, [], pending(rejectAll));
    expect(shown(rejectAll)).toBe("blue");

    const acceptAll = handTo(carol, "carol");
    decide(acceptAll, pending(acceptAll), []);
    expect(shown(acceptAll)).toBe("yellow");

    const middle = handTo(carol, "carol");
    decide(middle, [], [by(middle, "carol")]);
    expect(shown(middle)).toBe("green");
    expect(pending(middle).map((c) => c.dataTracked.authorID).sort()).toEqual(["alice", "bob"]);
  });

  it("offers the holder at the caret, never what it holds", () => {
    const editor = aliceOverBob();
    for (const listed of [pending(editor), [...pending(editor)].reverse()]) {
      for (const head of [1, 3, 6]) expect(changeAtCaret(listed, head)?.dataTracked.authorID).toBe("alice");
    }
  });

  it("folds a later edit into the author's own suggestion", () => {
    const editor = editorWith([blue()], "alice");
    recolour(editor, "red");
    recolour(editor, "green");
    expect(pending(editor)).toHaveLength(1);
    expect(by(editor, "alice").dataTracked.replaced).toEqual([{ type: "color", attrs: { color: "blue" } }]);
  });
});

/** Blue agreed; Bob suggests red; Alice clears the colour. */
function aliceClearsBob() {
  const bob = editorWith([blue()], "bob");
  recolour(bob, "red");
  const alice = handTo(bob, "alice");
  clearColour(alice);
  return alice;
}

describe("removing another author's suggestion", () => {
  it("stacks the removal beside the suggestion, which stays his", () => {
    const editor = aliceClearsBob();
    expect(shown(editor)).toBe("red");
    expect(by(editor, "bob", "insert").dataTracked.replaced).toEqual([{ type: "color", attrs: { color: "blue" } }]);
    expect(by(editor, "alice", "delete")).toBeDefined();
  });

  const cases: Array<[string, (e: ServerEditor) => [TrackedChange[], TrackedChange[]], unknown, number]> = [
    ["accept the removal", (e) => [[by(e, "alice", "delete")], []], null, 0],
    ["reject the removal", (e) => [[], [by(e, "alice", "delete")]], "red", 1],
    ["reject both", (e) => [[], [by(e, "alice", "delete"), by(e, "bob")]], "blue", 0],
    ["accept his, reject hers", (e) => [[by(e, "bob")], [by(e, "alice", "delete")]], "red", 0],
    ["accept both", (e) => [[by(e, "bob"), by(e, "alice", "delete")], []], null, 0],
    ["reject his alone", (e) => [[], [by(e, "bob")]], "blue", 1],
    ["accept his alone", (e) => [[by(e, "bob")], []], "red", 1],
  ];
  for (const [name, decisions, colour, left] of cases) {
    it(name, () => {
      const editor = aliceClearsBob();
      const [accepted, rejected] = decisions(editor);
      decide(editor, accepted, rejected);
      expect(shown(editor)).toBe(colour);
      expect(pending(editor)).toHaveLength(left);
    });
  }

  it("leaves Alice's removal pending over the agreed colour once Bob's is rejected", () => {
    const editor = aliceClearsBob();
    decide(editor, [], [by(editor, "bob")]);
    expect(pending(editor).map((c) => [c.dataTracked.authorID, c.dataTracked.operation])).toEqual([["alice", "delete"]]);
    decide(editor, [by(editor, "alice", "delete")], []);
    expect(shown(editor)).toBe(null);
  });
});

function recolourRange(editor: ServerEditor, from: number, to: number, value: string) {
  const type = editor.getState().schema.marks["color"]!;
  editor.applyTransaction(editor.getState().tr.addMark(from, to, type.create({ color: value })));
}

/** Each character's colour. */
function colourAt(editor: ServerEditor) {
  const chars: (unknown | null)[] = [];
  editor.getState().doc.descendants((node: PMNode) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === "color");
    for (let i = 0; i < node.nodeSize; i++) chars.push(mark ? mark.attrs["color"] : null);
  });
  return chars;
}

/** Bug class: a held suggestion treated as if it stood on the text — written over another's, hidden where it shows, or merged with what shows. */
describe("a suggestion held over part of its range", () => {
  /** Blue agreed; Bob red over all of it; Alice green over `from`–`to`. */
  function partlyHeld(from: number, to: number) {
    const bob = editorWith([blue()], "bob");
    recolourRange(bob, 1, 6, "red");
    const alice = handTo(bob, "alice");
    recolourRange(alice, from, to, "green");
    return alice;
  }

  it("keeps the holder when the held author edits elsewhere in their own suggestion", () => {
    const bob = handTo(partlyHeld(4, 6), "bob");
    recolourRange(bob, 3, 4, "yellow");
    expect(colourAt(bob).slice(3)).toEqual(["green", "green"]);
    expect(by(bob, "alice").dataTracked.replaced?.[0]?.attrs["color"]).toBe("red");
  });

  it("offers the held author's suggestion where it shows", () => {
    const editor = partlyHeld(1, 3);
    for (const listed of [pending(editor), [...pending(editor)].reverse()]) {
      expect(changeAtCaret(listed, 2)?.dataTracked.authorID).toBe("alice");
      for (const head of [4, 5]) expect(changeAtCaret(listed, head)?.dataTracked.authorID).toBe("bob");
    }
  });

  it("names every change that holds a suggestion", () => {
    const alice = partlyHeld(1, 3);
    const carol = handTo(alice, "carol");
    recolourRange(carol, 3, 6, "yellow");
    const bob = by(carol, "bob");
    const holders = [by(carol, "alice").id, by(carol, "carol").id];
    expect(bob.type === "mark-change" && [...(bob.within ?? [])].sort()).toEqual([...holders].sort());
  });

  it("offers a split suggestion where it shows, though part of it is held", () => {
    const bob = editorWith([blue()], "bob");
    recolourRange(bob, 1, 6, "red");
    const carol = handTo(bob, "carol");
    carol.applyTransaction(carol.getState().tr.split(3));
    const alice = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
      content: carol.getState().doc.toJSON(),
    });
    recolourRange(alice, 1, 3, "green");
    for (const head of [6, 7]) {
      const offered = changeAtCaret(pending(alice), head);
      expect(offered?.dataTracked.authorID).toBe("bob");
      expect(offered?.type === "mark-change" && offered.within).toBeUndefined();
    }
  });

  it("never offers a held piece as the act of a suggestion that shows", () => {
    const bob = editorWith([blue()], "bob");
    recolourRange(bob, 1, 3, "red");
    const alice = handTo(bob, "alice");
    recolourRange(alice, 1, 3, "green");
    const again = handTo(alice, "bob");
    recolourRange(again, 3, 6, "red");
    for (const head of [4, 5]) {
      const offered = changeAtCaret(pending(again), head);
      expect(offered?.type === "mark-change" && offered.within).toBeUndefined();
    }
  });
});

describe("what else reads a held suggestion", () => {
  it("re-keys held records when the document is cloned", () => {
    const source = aliceOverBob();
    const clone = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "carol", initialStatus: TrackChangesStatus.enabled })],
      content: source.getState().doc.toJSON(),
      clone: { generate: ({ kind, oldId }) => `${kind}:${oldId}:clone` },
    });
    const ids = pending(clone).map((c) => c.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id.endsWith(":clone")).toBe(true);
  });

  it("tells an agent of both suggestions, each against the agreed colour", () => {
    const unit = toSemanticUnits(aliceOverBob(), { groupBlocks: false }).find((u) => u.id === "a");
    const changes = unit?.changes ?? [];
    expect(changes.map((c) => c.authorId).sort()).toEqual(["alice", "bob"]);
    for (const change of changes) expect(change.oldAttrs).toEqual({ marks: [{ type: "color", attrs: { color: "blue" } }] });
    // The text shows Alice's green, so Bob's proposal is stated on his change.
    expect(changes.find((c) => c.authorId === "bob")?.newAttrs).toEqual({ marks: [{ type: "color", attrs: { color: "red" } }] });
    expect(changes.find((c) => c.authorId === "alice")?.newAttrs).toBeUndefined();
  });

  it("previews the suggestions a decision discards", () => {
    const editor = aliceOverBob();
    const plan = planReview(editor, { accepted: [by(editor, "alice").id], rejected: [] });
    expect(plan.status === "ready" && plan.rejected).toEqual([by(editor, "bob").id]);
  });

  it("keeps two removals by one author apart when another author sets the value they remove", () => {
    const record = (id: string) => [{ id, authorID: "carol", operation: "delete", status: "pending", createdAt: 1, updatedAt: 1, statusUpdateAt: 0, reviewedByID: null }];
    const editor = editorWith([
      { type: "text", text: "a", marks: [{ type: "color", attrs: { color: "blue", dataTracked: record("carol-1") } }] },
      { type: "text", text: "b", marks: [{ type: "color", attrs: { color: "blue", dataTracked: record("carol-2") } }] },
    ], "bob");
    recolourRange(editor, 2, 3, "blue");
    expect(pending(editor).map((c) => c.id).sort()).toEqual(["carol-1", "carol-2"]);
  });
});

describe("a held suggestion stored without its timestamps", () => {
  /** Every createdAt and updatedAt left out, as a stored or converted document may have it. */
  const withoutTimestamps = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutTimestamps);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "createdAt" && key !== "updatedAt").map(([key, v]) => [key, withoutTimestamps(v)]));
  };

  it("stays held when someone edits elsewhere", () => {
    const stored = withoutTimestamps(aliceOverBob().getState().doc.child(0).toJSON().content);
    const carol = editorWith([...(Array.isArray(stored) ? stored : []), { type: "text", text: " tail" }], "carol");
    carol.applyTransaction(carol.getState().tr.insertText("x", carol.getState().doc.child(0).content.size + 1));

    const alice = by(carol, "alice");
    const bob = by(carol, "bob");
    expect(bob.type === "mark-change" && bob.within).toEqual([alice.id]);
    expect(shown(carol)).toEqual(["green", null]);
  });
});
