/**
 * Cross-document unit keys.
 *
 * `unitContentHash` answers "did this unit change between two versions of the
 * same document" — so it folds in the breadcrumb, and a nodeId scopes it to one
 * instance. Neither survives a move to another document: the same clause under a
 * different heading, in a differently-numbered agreement, is a different hash.
 *
 * `unitContentKey` is the other question — "is this the same clause as one I
 * already hold, in some other document" — so it covers the clause text alone,
 * normalized for the whitespace that survives a round-trip through DOCX.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { InlineSpan, SemanticUnit } from "@scrivr/core";
import { toSemanticUnits } from "../toSemanticUnits";
// Imported through the barrel: an export dropped from `index.ts` fails here
// rather than passing against the module it happens to live in.
import {
  unitContentHash,
  unitContentKey,
  unitAlignmentInput,
  unitRichInput,
  semanticPartRichInput,
  semanticPartRichHash,
} from "../index";
import { fnv1aHex, stableStringify } from "@scrivr/core";

const para = (nodeId: string, text: string) => ({
  type: "paragraph",
  attrs: { nodeId },
  content: [{ type: "text", text }],
});
const heading = (nodeId: string, level: number, text: string) => ({
  type: "heading",
  attrs: { nodeId, level },
  content: [{ type: "text", text }],
});
// Alignment reads the ungrouped emission: grouping folds a heading and its lede
// into one unit, and a clause is keyed on the clause, not on the heading above it.
const emit = (content: unknown[]): SemanticUnit[] =>
  toSemanticUnits(new ServerEditor({ extensions: [StarterKit], content: { type: "doc", content } }), {
    groupBlocks: false,
  });

const CLAUSE =
  "Neither party shall be liable for any indirect or consequential loss arising under this Agreement.";

describe("unitContentKey", () => {
  it("matches the same clause across two unrelated documents", () => {
    // Same clause text, different instance id, different heading path, different
    // document order — everything an instance id or a version hash keys on.
    const [, a] = emit([heading("h1", 1, "Limitation of Liability"), para("p-a", CLAUSE)]);
    const [, , b] = emit([heading("h9", 2, "Exclusions"), para("filler", "Unrelated."), para("p-b", CLAUSE)]);

    expect(unitContentKey(a!)).toBe(unitContentKey(b!));
    // The version hash deliberately disagrees — it is scoped to one document.
    expect(unitContentHash(a!)).not.toBe(unitContentHash(b!));
  });

  it("ignores the whitespace a format round-trip introduces", () => {
    const [a] = emit([para("p-a", CLAUSE)]);
    const [b] = emit([para("p-b", `  Neither party shall be liable for any indirect or consequential\n loss arising under this Agreement.  `)]);

    expect(unitContentKey(a!)).toBe(unitContentKey(b!));
  });

  it("separates clauses that differ in substance", () => {
    const [a] = emit([para("p-a", CLAUSE)]);
    const [b] = emit([para("p-b", CLAUSE.replace("Neither party", "Neither Supplier"))]);

    expect(unitContentKey(a!)).not.toBe(unitContentKey(b!));
  });

  it("is deterministic and derived from the published preimage", () => {
    const [, u] = emit([heading("h", 1, "Terms"), para("p", CLAUSE)]);

    expect(unitContentKey(u!)).toBe(unitContentKey(u!));
    expect(unitContentKey(u!)).toBe(fnv1aHex(unitAlignmentInput(u!)));
    // The alignment preimage is the clause alone — no heading path.
    expect(unitAlignmentInput(u!)).not.toContain("Terms");
  });
});

describe("published rich preimages", () => {
  it("hash to the digests the rich lane already publishes", () => {
    const [list] = emit([
      { type: "bulletList", attrs: { nodeId: "l" }, content: [
        { type: "listItem", attrs: { nodeId: "li" }, content: [para("lp", "An item.")] },
      ] },
    ]);
    const part = list!.parts?.[0];
    expect(part).toBeDefined();

    expect(fnv1aHex(stableStringify(semanticPartRichInput(part!)))).toBe(semanticPartRichHash(part!));
    // A unit's rich preimage is structured, not a string — the diff lane reads
    // its spans rather than re-deriving them from text, and reads them without
    // asserting its way past the return type.
    const input = unitRichInput(list!);
    const spans: InlineSpan[] = input.spans;
    expect(spans).toEqual(expect.any(Array));
    expect(input).toMatchObject({ type: list!.type, text: list!.text });
  });
});
