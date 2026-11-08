/**
 * An agent reads, adds, changes and removes an image through the protocol it
 * already uses: an image unit to read, `insertBlock` to add, `richText` attrs
 * to change how it sits, `deleteBlock` to remove — each the agent's tracked
 * suggestion, whatever mode the person is in.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";
import type { SemanticEdit } from "../../schema/edit";
import type { SemanticImage, SemanticUnit } from "@scrivr/core";

const SRC = "https://example.com/chart.png";

const para = (nodeId: string, text: string) => ({ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] });
const figure = (nodeId: string, attrs: Record<string, unknown> = {}) => ({
  type: "paragraph",
  attrs: { nodeId },
  content: [{ type: "image", attrs: { src: SRC, alt: "Chart", width: 240, height: 160, ...attrs } }],
});

/** The person is editing, not suggesting: only the agent's edits are proposals. */
function build(content: unknown[]) {
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "person", initialStatus: TrackChangesStatus.disabled, canAcceptReject: true }), AiToolkit],
    content: { type: "doc", content },
  });
  const ai = getAiToolkit(editor);
  if (!ai) throw new Error("no toolkit");
  return { editor, ai };
}

const changesOf = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())?.changeSet.changes ?? [];
const imageUnit = (ai: NonNullable<ReturnType<typeof getAiToolkit>>, id: string) =>
  ai.getRichBlocks().find((unit) => unit.id === id && unit.type === "image");
const settle = (editor: ServerEditor, decision: "accepted" | "rejected") =>
  editor.commands.setChangeStatuses(decision, changesOf(editor).map((change) => change.id));
const firstImage = (editor: ServerEditor) => {
  let found: Record<string, unknown> | null = null;
  editor.getState().doc.descendants((node) => {
    if (!found && node.type.name === "image") found = { ...node.attrs };
    return !found;
  });
  return found;
};

describe("reading an image", () => {
  it("is an image unit, addressed by the paragraph that holds it", () => {
    const { ai } = build([para("a", "alpha"), figure("fig", { wrapMode: "square", xAlign: "right" })]);
    expect(imageUnit(ai, "fig")?.image).toEqual({ src: SRC, alt: "Chart", width: 240, height: 160, wrap: "square", align: "right" });
  });

  it("is left out once proposed for deletion", () => {
    const { ai } = build([para("a", "alpha"), figure("fig")]);
    ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "fig" }]);
    expect(imageUnit(ai, "fig")).toBeUndefined();
  });
});

describe("adding an image", () => {
  const add = (src: string): SemanticEdit => ({
    kind: "structural", op: "insertBlock", anchorNodeId: "a", position: "after",
    block: { type: "image", src, alt: "Chart", width: 300, height: 200, wrap: "square", align: "center" },
  });

  it("puts a paragraph holding it beside the anchor, as the agent's suggestion", () => {
    const { editor, ai } = build([para("a", "alpha"), para("b", "beta")]);
    const result = ai.applySemanticEdits([add(SRC)]);

    expect(result.changed).toEqual(["a"]);
    expect(firstImage(editor)).toMatchObject({ src: SRC, alt: "Chart", width: 300, height: 200, wrapMode: "square", xAlign: "center" });
    expect(changesOf(editor).some((change) => change.dataTracked.operation === "insert" && change.dataTracked.authorID === "AI Assistant")).toBe(true);
    settle(editor, "rejected");
    expect(firstImage(editor)).toBeNull();
  });

  it("is refused for a source that is not a safe image", () => {
    const { editor, ai } = build([para("a", "alpha")]);
    const result = ai.applySemanticEdits([add("javascript:alert(1)")]);

    expect(result).toMatchObject({ changed: [], rejected: ["a"] });
    expect(firstImage(editor)).toBeNull();
    expect(changesOf(editor)).toEqual([]);
  });
});

describe("changing how an image sits", () => {
  it("moves it across the line as one placement change", () => {
    const { editor, ai } = build([para("a", "alpha"), figure("fig", { wrapMode: "square" })]);
    const result = ai.applySemanticEdits([{ kind: "richText", nodeId: "fig", attrs: { align: "center" } }]);

    expect(result.changed).toEqual(["fig"]);
    expect(firstImage(editor)).toMatchObject({ xAlign: "center", wrapMode: "square" });
    const attrChanges = changesOf(editor).filter((change) => change.type === "node-attr-change");
    expect(attrChanges.map((change) => change.dataTracked.authorID)).toEqual(["AI Assistant"]);
    settle(editor, "rejected");
    expect(firstImage(editor)).toMatchObject({ xAlign: "left" });
  });

  it("changes its wrap and size, keeping what it was not asked to change", () => {
    const { editor, ai } = build([figure("fig")]);
    ai.applySemanticEdits([{ kind: "richText", nodeId: "fig", attrs: { wrap: "top-bottom", width: 480, height: 320, colour: "red" } }]);

    expect(firstImage(editor)).toMatchObject({ src: SRC, alt: "Chart", wrapMode: "top-bottom", width: 480, height: 320 });
    expect(firstImage(editor)).not.toHaveProperty("colour");
  });

  it("refuses new words for an image", () => {
    const { editor, ai } = build([figure("fig")]);
    const result = ai.applySemanticEdits([{ kind: "richText", nodeId: "fig", spans: [{ text: "a caption", marks: [] }] }]);

    expect(result).toMatchObject({ changed: [], rejected: ["fig"] });
    expect(changesOf(editor)).toEqual([]);
  });
});

describe("removing an image", () => {
  it("is a tracked deletion of its paragraph, reviewed either way", () => {
    const decisions: Array<"accepted" | "rejected"> = ["accepted", "rejected"];
    for (const decision of decisions) {
      const { editor, ai } = build([para("a", "alpha"), figure("fig")]);
      ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "fig" }]);
      expect(changesOf(editor).length).toBeGreaterThan(0);
      settle(editor, decision);
      expect(firstImage(editor) === null).toBe(decision === "accepted");
    }
  });
});

describe("an edited image unit", () => {
  const edited = (ai: NonNullable<ReturnType<typeof getAiToolkit>>, change: (unit: SemanticUnit, image: SemanticImage) => SemanticUnit) => {
    const unit = imageUnit(ai, "fig");
    if (!unit?.image) throw new Error("no image unit");
    return ai.applyRichEdit([change(unit, unit.image)]);
  };

  it("changes only what the agent changed, keeping a position of its own", () => {
    const { editor, ai } = build([figure("fig", { wrapMode: "square", xAlign: "custom", x: 120 })]);
    const result = edited(ai, (unit, image) => ({ ...unit, image: { ...image, wrap: "top-bottom" } }));

    expect(result).toMatchObject({ changed: ["fig"], rejected: [] });
    expect(firstImage(editor)).toMatchObject({ wrapMode: "top-bottom", xAlign: "custom", x: 120 });
  });

  it("is rejected for a new source", () => {
    const { editor, ai } = build([figure("fig")]);
    const result = edited(ai, (unit, image) => ({ ...unit, image: { ...image, src: "https://example.com/other.png" } }));

    expect(result).toMatchObject({ changed: [], rejected: ["fig"] });
    expect(changesOf(editor)).toEqual([]);
  });

  it("is rejected for paragraph styling", () => {
    const { editor, ai } = build([figure("fig")]);
    const result = edited(ai, (unit) => ({ ...unit, attrs: { align: "center" } }));

    expect(result).toMatchObject({ changed: [], rejected: ["fig"] });
    expect(changesOf(editor)).toEqual([]);
  });
});

describe("an image layout edit that changes nothing", () => {
  it("is rejected, not changed", () => {
    const { editor, ai } = build([figure("fig", { wrapMode: "square", xAlign: "right" })]);
    const result = ai.applySemanticEdits([{ kind: "richText", nodeId: "fig", attrs: { wrap: "square", align: "right" } }]);

    expect(result).toMatchObject({ applied: false, changed: [], rejected: ["fig"] });
    expect(changesOf(editor)).toEqual([]);
  });
});

describe("an image laid out by the legacy wrapping attr", () => {
  it("takes the wrap the agent sets", () => {
    const { ai } = build([figure("fig", { wrappingMode: "behind" })]);
    ai.applySemanticEdits([{ kind: "richText", nodeId: "fig", attrs: { wrap: "inline" } }]);

    expect(imageUnit(ai, "fig")?.image?.wrap).toBe("inline");
  });

  it("keeps its wrap when the agent sets only its alignment", () => {
    const { ai } = build([figure("fig", { wrappingMode: "behind" })]);
    ai.applySemanticEdits([{ kind: "richText", nodeId: "fig", attrs: { align: "center" } }]);

    expect(imageUnit(ai, "fig")?.image).toMatchObject({ wrap: "behind", align: "center" });
  });
});

describe("a new image with a size out of range", () => {
  it("is refused, even when the edit skipped parsing", () => {
    const { editor, ai } = build([para("a", "alpha")]);
    const result = ai.applySemanticEdits([{
      kind: "structural", op: "insertBlock", anchorNodeId: "a", position: "after",
      block: { type: "image", src: SRC, width: -5 },
    }]);

    expect(result).toMatchObject({ changed: [], rejected: ["a"] });
    expect(firstImage(editor)).toBeNull();
  });
});

describe("reading a selection", () => {
  it("keeps an image unit inside it", () => {
    const { editor, ai } = build([para("a", "alpha"), figure("fig"), para("b", "beta")]);
    const ids = ai.getRichBlocks(0, editor.getState().doc.content.size).map((unit) => unit.id);

    expect(ids).toEqual(["a", "fig", "b"]);
  });
});
