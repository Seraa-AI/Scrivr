/**
 * Every lane writes plain edits that the engine records, so what a lane may
 * do is what the engine records: a lane that cannot be recorded writes
 * nothing, a deletion takes only what the lane read, and an insertion is one
 * act whatever it holds.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { applyDiffAsSuggestion, applyMultiBlockDiff, applyRichDiffAsSuggestion, changeActs, findChanges, TrackChanges, TrackChangesStatus, trackAsSuggestion } from "../index";

type Setup = "no plugin" | "viewing snapshots" | "tracking";

const editorOf = (inline: unknown[], setup: Setup = "tracking", userID = "u1", block = "paragraph") =>
  new ServerEditor({
    extensions: setup === "no plugin"
      ? [StarterKit]
      : [StarterKit, TrackChanges.configure({ userID, initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: block, attrs: { nodeId: "p" }, content: inline }] },
  });
const textOf = (text: string) => [{ type: "text", text }];
const hardBreak = { type: "hardBreak" };
const image = { type: "image", attrs: { src: "https://example.com/a.png", width: 20, height: 20 } };

const plain = (editor: ServerEditor, text: string) =>
  applyDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), { nodeId: "p", proposedText: text, authorID: "agent" }).applied;
const rich = (editor: ServerEditor, text: string) =>
  applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
    edits: [{ nodeId: "p", spans: [{ text, marks: [] }] }],
    authorID: "agent",
  }).applied;

/** The paragraph's text, with each break or image as "□". */
const laidOut = (editor: ServerEditor) => {
  const paragraph = editor.getState().doc.child(0);
  return paragraph.textBetween(0, paragraph.content.size, "", "□");
};
const pending = (editor: ServerEditor) => findChanges(editor.getState()).pending;
const decideAll = (editor: ServerEditor, decision: "accepted" | "rejected") =>
  editor.commands.setChangeStatuses(decision, pending(editor).map((change) => change.id));

// insertAsSuggestion is a command of the plugin, so it does not exist without it.
const lanes: Array<{ name: string; apply: (editor: ServerEditor, text: string) => boolean; blocked: Setup[] }> = [
  { name: "the plain lane", apply: plain, blocked: ["no plugin", "viewing snapshots"] },
  { name: "the rich lane", apply: rich, blocked: ["no plugin", "viewing snapshots"] },
  {
    name: "insertAsSuggestion",
    apply: (editor, text) =>
      editor.commands.insertAsSuggestion(text, 1, 1 + editor.getState().doc.child(0).content.size, "agent"),
    blocked: ["viewing snapshots"],
  },
];

describe.each(lanes)("$name", ({ apply, blocked }) => {
  it.each(blocked)("writes nothing it cannot record: %s", (setup) => {
    const editor = editorOf(textOf("teh cat"), setup);
    if (setup === "viewing snapshots") editor.commands.setTrackingStatus(TrackChangesStatus.viewSnapshots);
    const before = editor.getState().doc;

    expect(apply(editor, "the cat")).toBe(false);
    expect(editor.getState().doc).toBe(before);
  });

  it("writes a line break as a break", () => {
    const editor = editorOf(textOf("one two"));
    apply(editor, "one\ntwo");
    decideAll(editor, "accepted");

    expect(laidOut(editor)).toBe("one□two");
  });
});

describe.each(lanes.slice(0, 2))("$name, over what it did not read", ({ apply }) => {
  it("keeps an image a deleted range spans", () => {
    const editor = editorOf([...textOf("one "), image, ...textOf(" two")]);
    apply(editor, "");
    decideAll(editor, "accepted");

    expect(laidOut(editor)).toBe("□");
  });

  it("leaves another author's struck text theirs", () => {
    const editor = editorOf(textOf("one cat two"), "tracking", "person");
    editor.applyTransaction(editor.getState().tr.delete(5, 9));
    apply(editor, "three");

    const theirs = pending(editor).filter((change) => change.dataTracked.authorID === "person");
    expect(theirs.map((change) => [change.dataTracked.operation, change.type === "text-change" ? change.text : ""])).toEqual([["delete", "cat "]]);
  });

  it("withdraws a break it proposed deleting, when it restates the original", () => {
    const editor = editorOf([...textOf("one"), hardBreak, ...textOf("two")]);
    const before = editor.getState().doc.toJSON();
    apply(editor, "one two");
    expect(pending(editor)).not.toEqual([]);
    apply(editor, "one\ntwo");

    expect(pending(editor)).toEqual([]);
    expect(editor.getState().doc.toJSON()).toEqual(before);
  });
});

describe("insertAsSuggestion", () => {
  it("is one act, its break included", () => {
    const editor = editorOf(textOf("x"));
    editor.commands.insertAsSuggestion("one\ntwo", 2, 2, "agent");

    expect(changeActs(pending(editor))).toHaveLength(1);
    decideAll(editor, "rejected");
    expect(laidOut(editor)).toBe("x");
  });

  it("is one replacement when it types over a selection", () => {
    const editor = editorOf(textOf("teh cat"));
    editor.commands.insertAsSuggestion("the", 1, 4, "agent");

    expect(changeActs(pending(editor))).toHaveLength(1);
    expect(laidOut(editor)).toBe("theteh cat");
  });
});

describe.each(lanes)("$name, in a code block", ({ apply }) => {
  it("writes a line break in a code block as a newline", () => {
    const editor = editorOf(textOf("one two"), "tracking", "u1", "codeBlock");
    apply(editor, "one\ntwo");
    decideAll(editor, "accepted");

    expect(laidOut(editor)).toBe("one\ntwo");
  });
});

describe.each(lanes.slice(0, 2))("$name, over a break", ({ apply }) => {
  it.each([["accepted", "one two"], ["rejected", "one□two"]] as const)("proposes deleting a dropped break, %s to %s", (decision, laid) => {
    const editor = editorOf([...textOf("one"), hardBreak, ...textOf("two")]);
    apply(editor, "one two");
    decideAll(editor, decision);

    expect(laidOut(editor)).toBe(laid);
  });

  it("replaces words with an image inside as one act, keeping the image", () => {
    const editor = editorOf([...textOf("a cat"), image, ...textOf("dog sat")]);
    apply(editor, "a cow sat");

    expect(changeActs(pending(editor))).toHaveLength(1);
    decideAll(editor, "rejected");
    expect(laidOut(editor)).toBe("a cat□dog sat");
  });

  it("withdraws only its own record on a break, never another author's", () => {
    const editor = editorOf([...textOf("one"), hardBreak, ...textOf("two")]);
    apply(editor, "one two");
    let at = -1;
    editor.getState().doc.descendants((node, pos) => {
      if (node.type.name === "hardBreak") at = pos;
    });
    const erase = trackAsSuggestion(editor.getState().tr.setNodeAttribute(at, "dataTracked", []), "someone else");
    editor.applyTransaction(erase);

    const records: Array<{ authorID: string }> = editor.getState().doc.nodeAt(at)?.attrs["dataTracked"] ?? [];
    expect(records.map((record) => record.authorID)).toEqual(["agent"]);
    apply(editor, "one\ntwo");
    expect(pending(editor)).toEqual([]);
  });

  it("never rewrites what another author's record on a break says", () => {
    const editor = editorOf([...textOf("one"), hardBreak, ...textOf("two")]);
    apply(editor, "one two");
    let at = -1;
    editor.getState().doc.descendants((node, pos) => {
      if (node.type.name === "hardBreak") at = pos;
    });
    const records: Array<Record<string, unknown>> = editor.getState().doc.nodeAt(at)?.attrs["dataTracked"] ?? [];
    const settled = records.map((record) => ({ ...record, status: "accepted" }));
    editor.applyTransaction(trackAsSuggestion(editor.getState().tr.setNodeAttribute(at, "dataTracked", settled), "someone else"));

    expect(editor.getState().doc.nodeAt(at)?.attrs["dataTracked"]).toEqual(records);
  });

  it("never erases another author's record on a break, with or without an id", () => {
    const records = [
      { authorID: "someone else", operation: "delete", status: "pending" },
      { authorID: "u1", operation: "delete", status: "pending" },
    ];
    for (const order of [records, [...records].reverse()]) {
      const editor = editorOf([...textOf("one"), { ...hardBreak, attrs: { dataTracked: order } }, ...textOf("two")]);
      editor.applyTransaction(editor.getState().tr.setNodeAttribute(4, "dataTracked", []));

      expect(editor.getState().doc.nodeAt(4)?.attrs["dataTracked"]).toEqual(order);
    }
  });

  it("deletes words with an image inside as one act, keeping the image", () => {
    const editor = editorOf([...textOf("a cat"), image, ...textOf("dog sat")]);
    apply(editor, "a sat");

    expect(changeActs(pending(editor))).toHaveLength(1);
    decideAll(editor, "rejected");
    expect(laidOut(editor)).toBe("a cat□dog sat");
  });

  it("places an edit after another author's deletion where it belongs", () => {
    const editor = editorOf(textOf("one cat two three"), "tracking", "person");
    editor.applyTransaction(editor.getState().tr.delete(5, 9));
    apply(editor, "one two four");
    const agents = pending(editor).filter((change) => change.dataTracked.authorID === "agent");
    editor.commands.setChangeStatuses("accepted", agents.map((change) => change.id));

    expect(laidOut(editor)).toBe("one cat two four");
    expect(pending(editor).map((change) => change.dataTracked.authorID)).toEqual(["person"]);
  });

  it("records what the same edit typed in suggesting mode records", () => {
    const records = (editor: ServerEditor) => {
      const changes = pending(editor);
      return changes.map((change) => [
        change.dataTracked.operation,
        change.type === "text-change" ? change.text : "",
        change.dataTracked.authorID,
        changes.filter((other) => other.dataTracked.groupId === change.dataTracked.groupId).length,
      ]);
    };
    const laned = editorOf(textOf("teh cat"));
    apply(laned, "the cat");
    const typed = editorOf(textOf("teh cat"), "tracking", "agent");
    typed.applyTransaction(typed.getState().tr.insertText("the", 1, 4));

    expect(records(laned)).toEqual(records(typed));
  });
});

describe("applyMultiBlockDiff", () => {
  it("writes nothing while snapshots are viewed", () => {
    const editor = editorOf(textOf("teh cat"));
    editor.commands.setTrackingStatus(TrackChangesStatus.viewSnapshots);
    const before = editor.getState().doc;
    const { applied } = applyMultiBlockDiff(editor.getState(), (tr) => editor.applyTransaction(tr), {
      blocks: [{ nodeId: "p", proposedText: "the cat" }],
      authorID: "agent",
    });

    expect(applied).toBe(false);
    expect(editor.getState().doc).toBe(before);
  });
});
