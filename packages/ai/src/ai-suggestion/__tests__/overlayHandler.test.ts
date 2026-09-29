/**
 * What the overlay actually asks to be drawn.
 *
 * The handler decides, per block, whether to build render instructions at all.
 * It used to ask only when the block contained a deletion — which a formatting
 * proposal never does — so the drawing existed and was never reached. Testing
 * the instruction builder alone cannot see that; the handler has to run.
 */
import { describe, expect, it } from "vitest";
import type { CharacterMap, IEditor, PageConfig, ResolvedTheme } from "@scrivr/core";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { createSuggestionOverlayHandler } from "../AiSuggestion";
import { AiTestEditor, doc, p } from "./helpers";

/** A canvas context that records which decorations were drawn. */
function recordingContext() {
  const strokes: number[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, stroke() { strokes.push(1); },
    moveTo() {}, lineTo() {}, setLineDash() {}, fillRect() {},
    strokeStyle: "", lineWidth: 0, lineCap: "", globalAlpha: 1, fillStyle: "",
  };
  return { ctx, strokes };
}

describe("the overlay handler", () => {
  it("asks for instructions on a block that only proposes formatting", () => {
    const editor = new AiTestEditor(doc(p("plain and more", "p1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [
        { text: "plain ", marks: [] },
        { text: "and", marks: [{ type: "bold" }] },
        { text: " more", marks: [] },
      ] }],
      authorID: "AI Assistant",
    })!;
    // No deletion anywhere — the case the old gate excluded.
    expect(suggestion.blocks[0]!.ops.some((op) => op.type === "delete")).toBe(false);

    editor.showSuggestion(suggestion);
    // "all" so the assertion is about what the handler draws, not about which
    // block happens to hold the caret.
    const handler = createSuggestionOverlayHandler(editor as unknown as IEditor, "all");

    const glyphs: unknown[] = [];
    const charMap = {
      linesInRange: () => [{ y: 0, height: 12, page: 0 }],
      glyphsInRange: () => [{ docPos: 7, x: 0, y: 0, width: 10, height: 12, lineY: 0, page: 0 }],
      coordsAtPos: () => ({ x: 0, y: 0, height: 12, page: 0 }),
    };
    const { ctx, strokes } = recordingContext();

    handler(
      ctx as unknown as CanvasRenderingContext2D,
      0,
      { margins: { left: 40, right: 40, top: 40, bottom: 40 } } as unknown as PageConfig,
      charMap as unknown as CharacterMap,
      {} as ResolvedTheme,
    );

    // The margin stripe alone is not the formatting decoration: the underline
    // is an extra stroke over the run whose appearance changes.
    expect(glyphs.length).toBe(0);
    expect(strokes.length).toBeGreaterThan(1);
  });
});
