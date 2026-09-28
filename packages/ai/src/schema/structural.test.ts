/**
 * The structural half of the edit protocol (RFC Phase 2).
 *
 * Every op addresses the document through a stable `nodeId` and a `position`,
 * never an index or a ProseMirror position — the agent names a neighbour it was
 * shown, not a coordinate it inferred.
 */
import { describe, expect, it } from "vitest";
import { SemanticEditSchema, StructuralSemanticEditSchema, parseSemanticEdits } from "./edit";

const insertBlock = {
  kind: "structural",
  op: "insertBlock",
  position: "after",
  anchorNodeId: "p1",
  block: { type: "paragraph", spans: [{ text: "A new clause.", marks: [] }] },
};

describe("StructuralSemanticEditSchema", () => {
  it("accepts the six Phase 2 ops", () => {
    const ops: unknown[] = [
      insertBlock,
      { kind: "structural", op: "deleteBlock", nodeId: "p2" },
      { kind: "structural", op: "insertListItem", position: "before", anchorNodeId: "li1", item: { spans: [{ text: "Enterprise tier", marks: [] }] } },
      { kind: "structural", op: "deleteListItem", nodeId: "li2" },
      { kind: "structural", op: "insertTableRow", position: "after", anchorNodeId: "c1" },
      { kind: "structural", op: "deleteTableRow", anchorNodeId: "c2" },
    ];
    for (const op of ops) expect(StructuralSemanticEditSchema.safeParse(op).success).toBe(true);
  });

  it("rejects the ops specced for later phases rather than half-applying them", () => {
    // Move (Phase 3) and column ops (Phase 4) are in the RFC but not built. A
    // schema that accepted them would report success and change nothing.
    const later: unknown[] = [
      { kind: "structural", op: "moveBlock", nodeId: "p1", position: "after", anchorNodeId: "p2" },
      { kind: "structural", op: "moveListItem", nodeId: "li1", position: "after", anchorNodeId: "li2" },
      { kind: "structural", op: "insertTableColumn", position: "after", anchorNodeId: "c1" },
      { kind: "structural", op: "deleteTableColumn", anchorNodeId: "c1" },
    ];
    for (const op of later) expect(StructuralSemanticEditSchema.safeParse(op).success).toBe(false);
  });

  it("refuses a positional anchor", () => {
    const positional = { kind: "structural", op: "insertBlock", position: "after", index: 4, block: { type: "paragraph" } };
    expect(StructuralSemanticEditSchema.safeParse(positional).success).toBe(false);
  });

  it("holds an inserted block to the types a semantic block can be", () => {
    expect(StructuralSemanticEditSchema.safeParse({ ...insertBlock, block: { type: "table" } }).success).toBe(false);
    expect(StructuralSemanticEditSchema.safeParse({ ...insertBlock, block: { type: "heading", level: 2 } }).success).toBe(true);
  });
});

describe("SemanticEditSchema", () => {
  it("discriminates rich from structural on `kind`", () => {
    const rich = { kind: "richText", nodeId: "p1", spans: [{ text: "x", marks: [] }] };
    expect(SemanticEditSchema.safeParse(rich).success).toBe(true);
    expect(SemanticEditSchema.safeParse(insertBlock).success).toBe(true);
    expect(SemanticEditSchema.safeParse({ kind: "nonsense", nodeId: "p1" }).success).toBe(false);
  });
});

describe("parseSemanticEdits", () => {
  it("validates both kinds and quarantines what it cannot read", () => {
    const { edits, rejected } = parseSemanticEdits([
      { kind: "richText", nodeId: "p1", spans: [{ text: "x", marks: [] }] },
      insertBlock,
      { kind: "structural", op: "deleteBlock" },
    ]);
    expect(edits).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.index).toBe(2);
  });
});
