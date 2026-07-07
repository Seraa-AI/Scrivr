/**
 * Determinism + identity — the contract that lets downstream change-detection
 * trust unit ids. On the headless read path (ServerEditor) loading is
 * deterministic and never fabricates ids: persisted `nodeId`s are used, and
 * blocks without one get a deterministic positional fallback. Two loads of the
 * same JSON produce the same unit ids — the whole point.
 */
import { describe, expect, it } from "vitest";
import { ExtensionManager, ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../index";
import { resolveNodeId } from "../id";

const para = (text: string, nodeId?: string) => ({
  type: "paragraph",
  ...(nodeId ? { attrs: { nodeId } } : {}),
  content: [{ type: "text", text }],
});
const heading = (level: number, text: string, nodeId?: string) => ({
  type: "heading",
  attrs: { level, ...(nodeId ? { nodeId } : {}) },
  content: [{ type: "text", text }],
});
const LONG = "x".repeat(250);

const IDLESS = { type: "doc", content: [heading(1, "Title"), para(LONG), para("Another")] };
const WITH_IDS = {
  type: "doc",
  content: [heading(1, "Title", "h1"), para(LONG, "p1"), para("Another", "p2")],
};

function edit(content: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit], content });
}

describe("toSemanticUnits — determinism", () => {
  it("is identical across two independent loads of the same JSON", () => {
    // The real fix: two server loads no longer diverge (no random id churn).
    expect(toSemanticUnits(edit(IDLESS))).toEqual(toSemanticUnits(edit(IDLESS)));
  });

  it("falls back to deterministic positional ids when the doc has no nodeIds", () => {
    const units = toSemanticUnits(edit(IDLESS));
    // Top-level indices: heading=0, first paragraph=1, second paragraph=2.
    expect(units.map((u) => u.id)).toEqual(["p:0", "p:1", "p:2"]);
  });

  it("uses persisted nodeIds when present", () => {
    const units = toSemanticUnits(edit(WITH_IDS));
    expect(units.map((u) => u.id)).toEqual(["h1", "p1", "p2"]);
  });
});

describe("resolveNodeId — positional fallback", () => {
  const schema = new ExtensionManager([StarterKit]).schema;

  it("derives a deterministic positional id when nodeId is absent", () => {
    const p = schema.node("paragraph", null, [schema.text("hi")]);
    expect(p.attrs["nodeId"]).toBeNull();
    expect(resolveNodeId({ node: p, index: 2 })).toBe("p:2");
  });

  it("uses the real nodeId when present", () => {
    const p = schema.node("paragraph", { nodeId: "abc123" }, [schema.text("hi")]);
    expect(resolveNodeId({ node: p, index: 2 })).toBe("abc123");
  });
});
