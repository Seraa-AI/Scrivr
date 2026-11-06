/**
 * `findLiveNodeById` — resolving a nodeId that two nodes carry.
 *
 * Deleting a node keeps it until the deletion is accepted, so a pending move
 * puts a live copy and a deleted shadow in the document under one id. Which
 * one comes first depends on the direction of the move, so neither "first" nor
 * "last" is a correct rule on its own.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit, findNodeById } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { findLiveNodeById, shadowRanges } from "../liveNode";

const content = (...texts: string[]) => ({
  type: "doc",
  content: texts.map((text) => ({
    type: "paragraph",
    attrs: { nodeId: text },
    content: text ? [{ type: "text", text }] : undefined,
  })),
});

const build = (tracked: boolean, ...texts: string[]) =>
  new ServerEditor({
    extensions: tracked
      ? [StarterKit, TrackChanges.configure({ initialStatus: TrackChangesStatus.enabled })]
      : [StarterKit],
    content: content(...texts),
  });

/** Move one paragraph, leaving a pending delete behind it. */
function move(editor: ServerEditor, index: number, toEnd: boolean) {
  const doc = editor.getState().doc;
  const node = doc.child(index);
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const tr = editor.getState().tr;
  tr.delete(pos, pos + node.nodeSize);
  tr.insert(toEnd ? tr.doc.content.size : 0, node);
  editor.applyTransaction(tr);
}

const liveOp = (editor: ServerEditor, id: string) => {
  const found = findLiveNodeById(editor.getState().doc, id);
  const tracked = found?.node.attrs["dataTracked"] as Array<{ operation?: string }> | null;
  return { pos: found?.pos, operation: tracked?.[0]?.operation };
};

describe("findLiveNodeById", () => {
  it("skips the shadow when the live copy comes last", () => {
    const editor = build(true, "x", "mid", "end");
    move(editor, 0, true);
    // Two copies, shadow first. The raw resolver takes the first.
    expect(findNodeById(editor.getState().doc, "x")?.pos).toBe(0);
    expect(liveOp(editor, "x").operation).toBe("move");
  });

  it("skips the shadow when the live copy comes first", () => {
    const editor = build(true, "one", "mid", "x");
    move(editor, 2, false);
    expect(liveOp(editor, "x").pos).toBe(0);
    expect(liveOp(editor, "x").operation).toBe("move");
  });

  it("finds a moved empty node, which carries no marks to test", () => {
    const editor = build(true, "", "mid");
    move(editor, 0, true);
    const found = findLiveNodeById(editor.getState().doc, "");
    expect(found).not.toBeNull();
    expect(found!.pos).toBeGreaterThan(0);
  });

  it("treats a block whose text is all struck through as live", () => {
    // The block is still there; only its words are proposed for deletion.
    const editor = build(true, "alpha", "beta");
    const state = editor.getState();
    editor.applyTransaction(state.tr.delete(1, 6));
    expect(findLiveNodeById(editor.getState().doc, "alpha")?.pos).toBe(0);
  });

  it("costs no document walk when TrackChanges is not installed", () => {
    const editor = build(false, "alpha", "beta");
    expect(shadowRanges(editor.getState().doc)).toEqual([]);
    expect(findLiveNodeById(editor.getState().doc, "beta")?.pos).toBe(7);
  });

  it("returns null for an id the document does not hold", () => {
    const editor = build(true, "alpha");
    expect(findLiveNodeById(editor.getState().doc, "nope")).toBeNull();
  });
});
