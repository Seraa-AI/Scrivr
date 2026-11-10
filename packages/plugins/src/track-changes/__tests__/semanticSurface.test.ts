/**
 * What a host imports to read review changes, from the package barrels it
 * would use.
 */
import "@scrivr/export-semantic/augment";
import { describe, expect, it } from "vitest";
import { Extension, semanticImage, ServerEditor, StarterKit } from "@scrivr/core";
import type { SemanticHandlers } from "@scrivr/core";
import { toSemanticUnits } from "@scrivr/export-semantic";
import type { SemanticImage, SemanticNodeChange, SemanticPart } from "@scrivr/export-semantic";
import { moveShadowRanges } from "@scrivr/plugins";

describe("the review-reading surface", () => {
  it("is importable from the barrels a host uses", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "https://example.com/a.png", alt: "A" } }] }] },
    });
    const image = editor.getState().doc.child(0).child(0);
    const described: SemanticImage | null = semanticImage(image);
    expect(described?.src).toBe("https://example.com/a.png");
    expect(moveShadowRanges(editor.getState().doc)).toEqual([]);
    const change: SemanticNodeChange = { change: { type: "suggestedAttrs", text: "" }, place: "covers" };
    const part: Pick<SemanticPart, "changes"> = { changes: [change.change] };
    expect(part.changes).toHaveLength(1);
  });

  it("lets a handler leave a formatting mark off the spans", () => {
    const hideBold: SemanticHandlers["isMarkRemoved"] = (mark) => mark.type.name === "bold";
    const HideBold = Extension.create({ name: "hideBold", addExports: () => ({ semantic: { isMarkRemoved: hideBold } }) });
    const editor = new ServerEditor({
      extensions: [StarterKit, HideBold],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha", marks: [{ type: "bold" }] }] }] },
    });
    expect(toSemanticUnits(editor)[0]?.spans).toBeUndefined();
  });
});
