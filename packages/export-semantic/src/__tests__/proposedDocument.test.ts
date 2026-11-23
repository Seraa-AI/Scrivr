/**
 * A unit with review changes renders `markdown` from the document a
 * contribution's `proposedDocument` supplies, and has none without it — the
 * hook's contract, pinned here with a stand-in for review records: bold text
 * reads as a proposed insertion.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit, type SemanticHandlers } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { toSemanticUnits } from "../index";

const editor = () => new ServerEditor({
  extensions: [StarterKit],
  content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [
    { type: "text", text: "keep " }, { type: "text", text: "new", marks: [{ type: "bold" }] },
  ] }] },
});
const proposing: SemanticHandlers = {
  marks: { bold: (run) => ({ text: run.text, changes: [{ type: "suggestedInsert", text: run.text }] }) },
};
/** The proposal as its own document: the same block, its new word as plain text. */
const accepted = (live: PmNode) => live.type.create(null, [
  live.type.schema.nodes["paragraph"]!.create({ nodeId: "p1" }, live.type.schema.text("keep new")),
]);

describe("proposedDocument", () => {
  it("gives a unit with changes the markdown of the supplied document", () => {
    const unit = toSemanticUnits(editor(), { overrides: { ...proposing, proposedDocument: accepted } })[0]!;
    expect(unit.changes?.length).toBe(1);
    expect(unit.markdown).toBe("keep new");
  });

  it("leaves the markdown out when nothing supplies the document", () => {
    expect(toSemanticUnits(editor(), { overrides: proposing })[0]!.markdown).toBeUndefined();
    expect(toSemanticUnits(editor(), { overrides: { ...proposing, proposedDocument: () => null } })[0]!.markdown).toBeUndefined();
  });

  it("leaves the markdown out, and still exports, when supplying the document fails", () => {
    const failing = () => { throw new Error("engine fault"); };
    const units = toSemanticUnits(editor(), { overrides: { ...proposing, proposedDocument: failing } });
    expect(units[0]!.text).toBe("keep new");
    expect(units[0]!.markdown).toBeUndefined();
  });

  it("is not asked for while nothing has changes", () => {
    let asked = 0;
    const plain = new ServerEditor({ extensions: [StarterKit], content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [{ type: "text", text: "plain" }] }] } });
    toSemanticUnits(plain, { overrides: { proposedDocument: (doc) => { asked++; return doc; } } });
    expect(asked).toBe(0);
  });
});
