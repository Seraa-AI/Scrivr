/**
 * A group is one proposal's replacement. Two proposals applied to the same
 * block at different times are two decisions, however their diffs line up.
 */
import { describe, expect, it } from "vitest";
import { findChanges } from "@scrivr/plugins";
import { AiSuggestionsAPI } from "../../ai-toolkit/AiToolkit";
import { AiTestEditor, doc, p } from "./helpers";

const pending = (editor: AiTestEditor) => findChanges(editor.getState()).pending;

describe("an applied proposal's groups", () => {
  it("never join a later proposal's into one decision", () => {
    const editor = new AiTestEditor(doc(p("the red car", "n")), "user1", { canAcceptReject: true });
    const api = new AiSuggestionsAPI(editor);
    for (const proposedText of ["the car", "the blue car"]) {
      const suggestion = api.compute({ authorID: "AI", blocks: [{ nodeId: "n", proposedText }] });
      if (!suggestion) throw new Error("no suggestion");
      api.show(suggestion);
      api.apply({ mode: "tracked" });
    }
    const insertion = pending(editor).find((change) => change.dataTracked.operation === "insert");
    if (!insertion) throw new Error("no insertion");

    editor.commands.setChangeStatuses("accepted", [insertion.id]);

    expect(pending(editor).map((change) => change.dataTracked.operation)).toEqual(["delete"]);
  });
});
