/**
 * TrackChanges contributes a `semantic` mark handler (via addExports) so the
 * chunk emitter excludes suggested-deletion text from unit text — a reviewer's
 * pending deletion must never be embedded — while inserted text is kept.
 *
 * Importing `@scrivr/export-semantic` here also loads the `semantic`
 * FormatHandlers augmentation into this package's typecheck, which is what lets
 * TrackChanges' `addExports().semantic` return type-check.
 */
import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "@scrivr/export-semantic";
import { TrackChanges } from "../TrackChanges";

describe("TrackChanges — semantic mark seam", () => {
  it("excludes suggested-deletion text and keeps inserted text", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1" })],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Keep " },
              { type: "text", text: "inserted ", marks: [{ type: "trackedInsert" }] },
              { type: "text", text: "deleted ", marks: [{ type: "trackedDelete" }] },
              { type: "text", text: "tail" },
            ],
          },
        ],
      },
    });
    const units = toSemanticUnits(editor);
    expect(units[0]!.text).toBe("Keep inserted tail");
  });
});
