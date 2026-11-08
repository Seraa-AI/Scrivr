/**
 * An agent asked to change a heading does it through `richText` `attrs.level`,
 * and the batch result says what happened: a change it made is `changed`, an
 * edit that made none is `rejected` — never reported done when nothing changed.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { findChanges, TrackChanges, TrackChangesStatus } from "@scrivr/plugins";
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";

const build = () => {
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
    content: { type: "doc", content: [{ type: "heading", attrs: { nodeId: "h", level: 2 }, content: [{ type: "text", text: "Purpose" }] }] },
  });
  const ai = getAiToolkit(editor);
  if (!ai) throw new Error("AiToolkit is not installed");
  return { editor, ai };
};
const setAttrs = (attrs: Record<string, unknown>) => {
  const { editor, ai } = build();
  const result = ai.applySemanticEdits([{ kind: "richText", nodeId: "h", attrs }]);
  return { editor, result };
};

describe("an agent's heading change", () => {
  it("is made and reported changed", () => {
    const { editor, result } = setAttrs({ level: 3 });

    expect(result).toMatchObject({ applied: true, changed: ["h"], rejected: [] });
    expect(editor.getState().doc.child(0).attrs.level).toBe(3);
    expect(findChanges(editor.getState()).pending).toHaveLength(1);
  });

  it.each([
    { name: "a level out of range", attrs: { level: 9 } },
    { name: "the level it already has", attrs: { level: 2 } },
    { name: "only attrs an agent may not set", attrs: { color: "red" } },
  ])("asking for $name is rejected, not changed", ({ attrs }) => {
    const { editor, result } = setAttrs(attrs);

    expect(result).toMatchObject({ applied: false, changed: [], rejected: ["h"] });
    expect(findChanges(editor.getState()).pending).toHaveLength(0);
  });
});
