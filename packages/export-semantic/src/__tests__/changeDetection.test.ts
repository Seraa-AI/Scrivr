/**
 * Change-detection substrate — per-unit content hash + version diff. Proves the
 * "paragraph cost, not document cost" property: editing one block marks exactly
 * one unit changed.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../toSemanticUnits";
import { unitContentHash, unitRichHash, unitEmbeddingInput, diffSemanticUnits } from "../changeDetection";
import type { SemanticUnit } from "@scrivr/core";

// Build units from content whose blocks carry persisted nodeIds (so diff can
// match by id across versions — positional fallbacks would shift on edit).
const para = (nodeId: string, text: string, marks?: unknown[]) => ({
  type: "paragraph",
  attrs: { nodeId },
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});
const heading = (nodeId: string, level: number, text: string) => ({
  type: "heading",
  attrs: { nodeId, level },
  content: [{ type: "text", text }],
});
const emit = (content: unknown[]): SemanticUnit[] =>
  toSemanticUnits(new ServerEditor({ extensions: [StarterKit], content: { type: "doc", content } }));

describe("unitContentHash", () => {
  it("is deterministic and covers breadcrumb + text", () => {
    const [u] = emit([heading("h", 1, "Terms"), para("p", "x".repeat(250))]);
    expect(unitContentHash(u!)).toBe(unitContentHash(u!));
    expect(unitEmbeddingInput(emit([para("p", "hi")])[0]!)).toBe("hi");
  });

  it("ignores formatting-only changes (same vector ⇒ same hash)", () => {
    const plain = emit([para("p", "The Provider shall indemnify the Client.")])[0]!;
    const bold = emit([
      { type: "paragraph", attrs: { nodeId: "p" }, content: [
        { type: "text", text: "The " },
        { type: "text", text: "Provider", marks: [{ type: "bold" }, { type: "color", attrs: { color: "#f00" } }] },
        { type: "text", text: " shall indemnify the Client." },
      ] },
    ])[0]!;
    // Same embedding input despite bold+color → same hash → no re-embed.
    expect(bold.spans).toBeDefined();
    expect(unitContentHash(bold)).toBe(unitContentHash(plain));
  });

  it("changes when text or breadcrumb changes", () => {
    const a = emit([para("p", "original text")])[0]!;
    const b = emit([para("p", "edited text")])[0]!;
    expect(unitContentHash(a)).not.toBe(unitContentHash(b));

    // Same text, different section path → different hash (breadcrumb is embedded).
    const underH1 = emit([heading("h1", 1, "Section A"), para("p", "x".repeat(250))])[1]!;
    const underH2 = emit([heading("h2", 1, "Section B"), para("p", "x".repeat(250))])[1]!;
    expect(unitContentHash(underH1)).not.toBe(unitContentHash(underH2));
  });
});

describe("unitRichHash", () => {
  const plain = emit([para("p", "The Provider shall indemnify the Client.")])[0]!;
  const bold = emit([
    { type: "paragraph", attrs: { nodeId: "p" }, content: [
      { type: "text", text: "The " },
      { type: "text", text: "Provider", marks: [{ type: "bold" }, { type: "color", attrs: { color: "#f00" } }] },
      { type: "text", text: " shall indemnify the Client." },
    ] },
  ])[0]!;

  it("DOES change on a formatting-only edit (unlike unitContentHash)", () => {
    // Same text/breadcrumb, only marks differ.
    expect(unitContentHash(bold)).toBe(unitContentHash(plain)); // embedding view: unchanged
    expect(unitRichHash(bold)).not.toBe(unitRichHash(plain));   // rich view: changed
  });

  it("changes on a block-attr edit (alignment)", () => {
    const left = emit([para("p", "centered?")])[0]!;
    const centered = emit([
      { type: "paragraph", attrs: { nodeId: "p", align: "center" }, content: [{ type: "text", text: "centered?" }] },
    ])[0]!;
    expect(unitContentHash(left)).toBe(unitContentHash(centered)); // same text
    expect(unitRichHash(left)).not.toBe(unitRichHash(centered));   // different styling
  });

  it("is deterministic and stable across runs", () => {
    expect(unitRichHash(bold)).toBe(unitRichHash(emit([
      { type: "paragraph", attrs: { nodeId: "p" }, content: [
        { type: "text", text: "The " },
        { type: "text", text: "Provider", marks: [{ type: "bold" }, { type: "color", attrs: { color: "#f00" } }] },
        { type: "text", text: " shall indemnify the Client." },
      ] },
    ])[0]!));
  });

  it("changes on a table cell styling edit (cell text unchanged)", () => {
    // A cell alignment change leaves cell TEXT and top-level text/spans/attrs
    // identical, but the rendered table differs — must be detected.
    const tableWith = (cellAttrs: Record<string, unknown>): SemanticUnit =>
      toSemanticUnits(
        new ServerEditor({
          extensions: [StarterKit.configure({ table: true })],
          content: {
            type: "doc",
            content: [
              { type: "table", attrs: { nodeId: "t", grid: [100] }, content: [
                { type: "tableRow", content: [
                  { type: "tableCell", attrs: cellAttrs, content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                ] },
              ] },
            ],
          },
        }),
      )[0]!;

    const left = tableWith({});
    const centered = tableWith({ hAlign: "center" });
    expect(unitContentHash(left)).toBe(unitContentHash(centered)); // cell text unchanged
    expect(unitRichHash(left)).not.toBe(unitRichHash(centered));   // cell styling changed
  });
});

describe("diffSemanticUnits", () => {
  const v1 = emit([
    heading("h", 1, "Fees"),
    para("a", "x".repeat(250)),
    para("b", "y".repeat(250)),
    para("c", "z".repeat(250)),
  ]);

  it("marks exactly the edited unit changed, rest unchanged (paragraph cost)", () => {
    const v2 = emit([
      heading("h", 1, "Fees"),
      para("a", "x".repeat(250)),
      para("b", "EDITED".repeat(50)), // only 'b' changed
      para("c", "z".repeat(250)),
    ]);
    const d = diffSemanticUnits(v1, v2);
    expect(d.changed.map((u) => u.id)).toEqual(["b"]);
    expect(d.unchanged.map((u) => u.id).sort()).toEqual(["a", "c", "h"]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("detects added and removed units by id", () => {
    const v2 = emit([
      heading("h", 1, "Fees"),
      para("a", "x".repeat(250)),
      // 'b' removed, 'd' added
      para("c", "z".repeat(250)),
      para("d", "new".repeat(100)),
    ]);
    const d = diffSemanticUnits(v1, v2);
    expect(d.added.map((u) => u.id)).toEqual(["d"]);
    expect(d.removed.map((u) => u.id)).toEqual(["b"]);
  });

  it("is a no-op when nothing changed", () => {
    const d = diffSemanticUnits(v1, emit([
      heading("h", 1, "Fees"),
      para("a", "x".repeat(250)),
      para("b", "y".repeat(250)),
      para("c", "z".repeat(250)),
    ]));
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toHaveLength(4);
  });
});
