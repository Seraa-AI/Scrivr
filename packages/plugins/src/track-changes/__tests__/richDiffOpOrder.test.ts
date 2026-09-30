/**
 * The tracked write path under the diff's emission order.
 *
 * `applyRichDiffAsSuggestion` walks the ops `pairReplacements` emits, counting
 * proposal characters as it goes to index the agent's marks. That makes it
 * dependent on the emission order in a way its own code never states — and the
 * order changed when proposal-consuming ops began coming out in proposal order.
 *
 * These pin the two things that dependence rests on: a rewrite that moves a
 * kept word earlier lands the right words wearing the right marks, and text the
 * agent left alone is not rewritten around it.
 */
import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit, type InlineSpan } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { trackChangesPluginKey } from "../engine/trackChangesPlugin";
import { applyRichDiffAsSuggestion, type RichBlockEdit } from "../lib/applyRichDiffAsSuggestion";

const AUTHOR = "ai:Assistant";

const editor = (text: string) =>
  new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({
      userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true,
    })],
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [{ type: "text", text }] }],
    },
  });

const apply = (ed: ServerEditor, spans: InlineSpan[]) => {
  const edits: RichBlockEdit[] = [{ nodeId: "p1", spans }];
  return applyRichDiffAsSuggestion(ed.getState(), (tr) => ed.applyTransaction(tr), { edits, authorID: AUTHOR });
};

/** The text a reviewer is left with once every proposed change is accepted. */
function acceptAll(ed: ServerEditor): string {
  const ids = (trackChangesPluginKey.getState(ed.getState())?.changeSet.changes ?? [])
    .map((c) => c.dataTracked.id);
  ed.commands.setChangeStatuses("accepted", ids);
  return ed.getState().doc.textContent;
}

const markedText = (ed: ServerEditor, markName: string) => {
  let out = "";
  ed.getState().doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === markName)) out += node.text;
  });
  return out;
};

describe("a rewrite that moves a kept word earlier", () => {
  it("proposes the wording the agent asked for", () => {
    // The shape that puts the emitted ops out of proposal order: a replacement
    // group holding both a keep it absorbs and a keep at its boundary.
    const ed = editor("alpha beta gamma delta");
    expect(apply(ed, [{ text: "beta delta epsilon", marks: [] }]).applied).toBe(true);

    expect(acceptAll(ed)).toBe("beta delta epsilon");
  });

  it("puts the agent's marks on the words it marked", () => {
    const ed = editor("alpha beta gamma delta");
    apply(ed, [
      { text: "beta", marks: [{ type: "bold" }] },
      { text: " delta epsilon", marks: [] },
    ]);

    expect(acceptAll(ed)).toBe("beta delta epsilon");
    expect(markedText(ed, "bold")).toBe("beta");
  });
});

describe("text the agent left alone", () => {
  it("is not rewritten by a change beside it", () => {
    const ed = editor("the indemnification clause survives");
    apply(ed, [{ text: "the indemnity clause survives", marks: [] }]);

    // Only the one word moves; the rest is retained, not deleted and re-added.
    const changes = trackChangesPluginKey.getState(ed.getState())?.changeSet.changes ?? [];
    const deleted = changes
      .filter((c) => c.type === "text-change" && c.dataTracked.operation === "delete")
      .map((c) => ("text" in c ? String(c.text) : ""))
      .join("");
    expect(deleted).not.toContain("clause");
    expect(deleted).not.toContain("survives");

    expect(acceptAll(ed)).toBe("the indemnity clause survives");
  });
});
