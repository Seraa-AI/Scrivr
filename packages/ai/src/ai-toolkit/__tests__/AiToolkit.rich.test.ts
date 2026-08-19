/**
 * AiToolkit rich API — `getRichBlocks` (formatting-aware read) and
 * `applyRichEdit` (formatting-preserving write, as tracked suggestions).
 *
 * Closes the loop: export rich units → edit their spans/attrs → merge back.
 * The auto-diff path lets the model return whole edited units without stating
 * which changed; `unitRichHash` decides. Real `ServerEditor` + `StarterKit` +
 * `TrackChanges` + `AiToolkit`.
 */
import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { unitRichHash } from "@scrivr/export-semantic";
import {
  TrackChanges,
  TrackChangesStatus,
  trackChangesPluginKey,
  applyRichDiffAsSuggestion,
} from "@scrivr/plugins";
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";
import { findNodeById } from "../UniqueId";

function build() {
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: "p1" }, content: [
          { type: "text", text: "The " },
          { type: "text", text: "Provider", marks: [{ type: "bold" }] },
          { type: "text", text: " shall pay." },
        ] },
        { type: "paragraph", attrs: { nodeId: "p2" }, content: [{ type: "text", text: "Second clause." }] },
      ],
    },
  });
  return { editor, ai: getAiToolkit(editor)! };
}

function markChanges(editor: ServerEditor) {
  return (trackChangesPluginKey.getState(editor.getState())?.changeSet.changes ?? []).filter((c) => c.type === "mark-change");
}

describe("AiToolkit.getRichBlocks", () => {
  it("emits one unit per block with spans/attrs", () => {
    const { ai } = build();
    const units = ai.getRichBlocks();
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.nodeIds.length === 1)).toBe(true);
    // p1 carries a bold run.
    expect(units[0]!.spans).toEqual([
      { text: "The ", marks: [] },
      { text: "Provider", marks: [{ type: "bold" }] },
      { text: " shall pay.", marks: [] },
    ]);
  });
});

describe("AiToolkit.applyRichEdit — auto-diff whole units", () => {
  it("only the changed unit produces a suggestion; unchanged is skipped", () => {
    const { editor, ai } = build();
    const units = ai.getRichBlocks();
    // Agent highlights "Provider" in p1, leaves p2 identical.
    const edited = units.map((u) => {
      if (u.id !== "p1") return u;
      return {
        ...u,
        spans: [
          { text: "The ", marks: [] },
          { text: "Provider", marks: [{ type: "bold" }, { type: "highlight" }] },
          { text: " shall pay.", marks: [] },
        ],
      };
    });

    const res = ai.applyRichEdit(edited);
    expect(res.applied).toBe(true);
    expect(res.changed).toEqual(["p1"]); // p2 unchanged, not touched
    // The highlight lands as a tracked mark-change, no text churn.
    const marks = markChanges(editor);
    expect(marks.some((c) => c.type === "mark-change" && c.mark.type.name === "highlight")).toBe(true);
  });

  it("returns applied:false when nothing changed", () => {
    const { ai } = build();
    const res = ai.applyRichEdit(ai.getRichBlocks()); // echo back unchanged
    expect(res.applied).toBe(false);
    expect(res.changed).toEqual([]);
  });

  it("skips a stale whole-unit edit when the source hash no longer matches", () => {
    const { editor, ai } = build();
    const source = ai.getRichBlocks().find((u) => u.id === "p2")!;
    const edited = {
      ...source,
      expectedContentHash: unitRichHash(source),
      spans: [{ text: "Second clause revised.", marks: [] }],
      text: "Second clause revised.",
    };

    const live = findNodeById(editor.getState().doc, "p2")!;
    editor.applyTransaction(editor.getState().tr.insertText(" live", live.pos + 1 + "Second clause".length));

    const res = ai.applyRichEdit([edited]);
    expect(res.applied).toBe(false);
    expect(res.stale).toEqual(["p2"]);
    expect(editor.getState().doc.textContent).toContain("Second clause live.");
  });

  it("reports a whole-unit target that no longer exists", () => {
    const { ai } = build();
    const source = ai.getRichBlocks()[0]!;
    const missing = { ...source, id: "missing", nodeIds: ["missing"] };

    const res = ai.applyRichEdit([missing]);

    expect(res.applied).toBe(false);
    expect(res.notFound).toEqual(["missing"]);
  });
});

describe("AiToolkit.applyRichEdit — explicit edits + stale guard", () => {
  it("applies an explicit span edit", () => {
    const { editor, ai } = build();
    const res = ai.applyRichEdit([
      { nodeId: "p2", spans: [{ text: "Second clause.", marks: [{ type: "bold" }] }] },
    ]);
    expect(res.applied).toBe(true);
    expect(markChanges(editor).some((c) => c.type === "mark-change" && c.mark.type.name === "bold")).toBe(true);
  });

  it("skips a stale edit whose expectedContentHash no longer matches", () => {
    const { ai } = build();
    const res = ai.applyRichEdit([
      { nodeId: "p2", spans: [{ text: "Different.", marks: [] }], expectedContentHash: "deadbeef" },
    ]);
    expect(res.applied).toBe(false);
    expect(res.stale).toEqual(["p2"]);
  });
});

describe("round-trip fidelity — echoing what the agent saw is a no-op", () => {
  // The merge diffs against the SAME text derivation the agent was shown by
  // getRichBlocks; a verbatim echo must produce ZERO changes, whatever the
  // block shape. This is the guard against whole-document churn.
  function richEditor() {
    return new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { nodeId: "h", level: 1 }, content: [{ type: "text", text: "Title" }] },
          { type: "paragraph", attrs: { nodeId: "plain" }, content: [{ type: "text", text: "A plain sentence." }] },
          { type: "paragraph", attrs: { nodeId: "fmt" }, content: [
            { type: "text", text: "Has a " }, { type: "text", text: "bold", marks: [{ type: "bold" }] }, { type: "text", text: " word." },
          ] },
          { type: "paragraph", attrs: { nodeId: "brk" }, content: [
            { type: "text", text: "Line one" }, { type: "hardBreak" }, { type: "text", text: "line two" },
          ] },
          { type: "paragraph", attrs: { nodeId: "tracked" }, content: [
            { type: "text", text: "Keep " }, { type: "text", text: "ins ", marks: [{ type: "trackedInsert" }] },
            { type: "text", text: "del ", marks: [{ type: "trackedDelete" }] }, { type: "text", text: "tail" },
          ] },
          { type: "orderedList", attrs: { nodeId: "list" }, content: [
            { type: "listItem", content: [{ type: "paragraph", attrs: { nodeId: "li1" }, content: [{ type: "text", text: "one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", attrs: { nodeId: "li2" }, content: [{ type: "text", text: "two" }] }] },
          ] },
        ],
      },
    });
  }

  it("echoing every leaf from getRichBlocks yields zero tracked changes", () => {
    const editor = richEditor();
    const ai = getAiToolkit(editor)!;
    // Echo every editable leaf verbatim: a unit's own spans when it is a leaf,
    // otherwise each of its container parts (list items, cells).
    const explicit = ai.getRichBlocks().flatMap((u) =>
      u.parts
        ? u.parts.map((p) => ({ nodeId: p.nodeId, spans: p.spans ?? [{ text: p.text, marks: [] }] }))
        : [{ nodeId: u.id, spans: u.spans ?? [{ text: u.text, marks: [] }] }],
    );
    const res = ai.applyRichEdit(explicit);
    expect(res.applied).toBe(false);
    expect(trackChangesPluginKey.getState(editor.getState())?.changeSet.changes ?? []).toHaveLength(0);
  });

  it("edits a list item's leaf by its own nodeId without churn", () => {
    const editor = richEditor();
    const ai = getAiToolkit(editor)!;
    // Leaf-based: address the item's paragraph directly and bold its word.
    const list = ai.getRichBlocks().find((u) => u.type === "list")!;
    const second = list.parts!.find((p) => p.text === "two")!;
    expect(second.nodeId).toBe("li2");

    applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
      edits: [{ nodeId: second.nodeId, spans: [{ text: "two", marks: [{ type: "bold" }] }] }],
      authorID: "AI Assistant",
    });
    const changes = trackChangesPluginKey.getState(editor.getState())?.changeSet.changes ?? [];
    const bold = changes.filter((c) => c.type === "mark-change" && c.mark.type.name === "bold");
    expect(bold).toHaveLength(1); // only "two" bolded
    expect(changes.filter((c) => c.type === "text-change")).toHaveLength(0); // no churn
  });

  it("auto-diffs edited parts returned inside a whole container unit", () => {
    const editor = richEditor();
    const ai = getAiToolkit(editor)!;
    const units = ai.getRichBlocks();
    const edited = units.map((unit) => {
      if (unit.id !== "list") return unit;
      return {
        ...unit,
        parts: unit.parts!.map((part) =>
          part.nodeId === "li2"
            ? { ...part, spans: [{ text: part.text, marks: [{ type: "bold" }] }] }
            : part,
        ),
      };
    });

    const res = ai.applyRichEdit(edited);

    expect(res.applied).toBe(true);
    expect(res.changed).toEqual(["li2"]);
    expect(res.rejected).toEqual([]);
    const bold = markChanges(editor).filter((change) => change.type === "mark-change" && change.mark.type.name === "bold");
    expect(bold).toHaveLength(1);
  });
});

describe("mark-change grouping (engine fix, no coalesce workaround)", () => {
  // A formatting edit spanning several diff tokens must land as ONE mark-change,
  // fused by the same mergeTrackedMarks the live editor uses — not one per token.
  it("highlighting a multi-word phrase produces a single mark-change", () => {
    const { editor, ai } = build();
    // p2 = "Second clause." → highlight "Second clause" (two words, spans tokens).
    ai.applyRichEdit([
      { nodeId: "p2", spans: [{ text: "Second clause", marks: [{ type: "highlight" }] }, { text: ".", marks: [] }] },
    ]);
    const highlights = markChanges(editor).filter((c) => c.type === "mark-change" && c.mark.type.name === "highlight");
    expect(highlights).toHaveLength(1);
  });
});
