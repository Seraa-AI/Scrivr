import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { AiToolkit } from "../ai-toolkit/AiToolkit";
import { getAiToolkit } from "../ai-toolkit/aiToolkitRegistry";
import { RichSemanticEditSchema, parseRichEdits } from "./edit";

describe("RichSemanticEditSchema", () => {
  const valid = {
    kind: "richText",
    nodeId: "p1",
    spans: [{ text: "hi", marks: [{ type: "bold" }] }],
  };

  it("accepts a well-formed richText edit", () => {
    expect(RichSemanticEditSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing nodeId", () => {
    const { kind, spans } = valid;
    expect(RichSemanticEditSchema.safeParse({ kind, spans }).success).toBe(false);
  });

  it("rejects an empty nodeId", () => {
    expect(RichSemanticEditSchema.safeParse({ ...valid, nodeId: "" }).success).toBe(false);
  });

  it("rejects the wrong kind", () => {
    expect(RichSemanticEditSchema.safeParse({ ...valid, kind: "structural" }).success).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(RichSemanticEditSchema.safeParse({ ...valid, parentPath: [0, 1] }).success).toBe(false);
  });

  it("rejects a non-string mark type", () => {
    const bad = { ...valid, spans: [{ text: "hi", marks: [{ type: 42 }] }] };
    expect(RichSemanticEditSchema.safeParse(bad).success).toBe(false);
  });

  it("allows open attrs on the edit and on marks", () => {
    const ok = {
      kind: "richText",
      nodeId: "p1",
      attrs: { align: "center", indent: 2 },
      spans: [{ text: "x", marks: [{ type: "link", attrs: { href: "https://a.co" } }] }],
    };
    expect(RichSemanticEditSchema.safeParse(ok).success).toBe(true);
  });
});

describe("parseRichEdits", () => {
  it("splits a mixed batch into valid edits and rejections", () => {
    const { edits, rejected } = parseRichEdits([
      { kind: "richText", nodeId: "a", spans: [{ text: "ok", marks: [] }] },
      { kind: "richText" }, // missing nodeId
      { kind: "structural", nodeId: "c" }, // wrong kind
    ]);
    expect(edits.map((e) => e.nodeId)).toEqual(["a"]);
    expect(rejected.map((r) => r.index)).toEqual([1, 2]);
    expect(rejected[0]!.error).toContain("nodeId");
  });

  it("rejects non-array input with index -1", () => {
    const { edits, rejected } = parseRichEdits({ kind: "richText", nodeId: "a" });
    expect(edits).toHaveLength(0);
    expect(rejected).toEqual([{ index: -1, error: "expected an array of edits" }]);
  });

  it("round-trips: parsed edits apply through applyRichEdit as suggestions", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
      content: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [{ type: "text", text: "plain word" }] }],
      },
    });
    const ai = getAiToolkit(editor)!;

    const { edits, rejected } = parseRichEdits([
      { kind: "richText", nodeId: "p1", spans: [{ text: "plain ", marks: [] }, { text: "word", marks: [{ type: "bold" }] }] },
    ]);
    expect(rejected).toHaveLength(0);

    const res = ai.applySemanticEdits(edits);
    expect(res.applied).toBe(true);
    expect(res.unsupported).toEqual([]);
    const changes = trackChangesPluginKey.getState(editor.getState())?.changeSet.changes ?? [];
    expect(changes.filter((c) => c.type === "mark-change" && c.mark.type.name === "bold")).toHaveLength(1);
    expect(changes.filter((c) => c.type === "text-change")).toHaveLength(0);
  });
});
