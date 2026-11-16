/**
 * The plain suggestion lane reads a block's text without its line breaks, so
 * it writes none either: a "\n" in a plain proposal is a space, and everything
 * it proposes can be reviewed and taken back.
 */
import { describe, expect, it } from "vitest";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { AiTestEditor, doc, p } from "./helpers";
import { trackChangesPluginKey } from "@scrivr/plugins";

describe("a newline in a plain proposal", () => {
  it.each(["one two\nthree", "one two\n", "one\ntwo"])("%j is reviewable, and rejecting it restores the block", (proposed) => {
    const editor = new AiTestEditor(doc(p("one two", "n1")), "user1", { canAcceptReject: true });
    const before = editor.getState().doc.toJSON();
    editor.showSuggestion(computeAiSuggestion(editor.getState(), { blocks: [{ nodeId: "n1", proposedText: proposed }], authorID: "AI" }));
    editor.apply({ blockId: "n1", mode: "tracked" });
    const ids = trackChangesPluginKey.getState(editor.getState())!.changeSet.pending.map((c) => c.id);
    editor.commands.setChangeStatuses("rejected", ids);
    expect(editor.getState().doc.toJSON()).toEqual(before);
  });
});
