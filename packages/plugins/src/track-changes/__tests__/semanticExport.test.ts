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
    expect(units[0]!.changes).toEqual([{ type: "suggestedDelete", text: "deleted " }]);
  });

  it("keeps tracked marks out of formatting spans", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1" })],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: " inserted", marks: [{ type: "trackedInsert" }] },
              { type: "text", text: " gone", marks: [{ type: "trackedDelete" }] },
            ],
          },
        ],
      },
    });
    const spans = toSemanticUnits(editor)[0]!.spans!;
    // bold is a formatting span; inserted text is kept but WITHOUT the review
    // mark; deleted text is absent entirely.
    expect(spans).toEqual([
      { text: "bold", marks: [{ type: "bold" }] },
      { text: " inserted", marks: [] },
    ]);
  });

  it("excludes suggested-deletion text from heading breadcrumbs", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1" })],
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [
              { type: "text", text: "Current " },
              {
                type: "text",
                text: "obsolete",
                marks: [{
                  type: "trackedDelete",
                  attrs: {
                    dataTracked: {
                      id: "change-1",
                      authorID: "u1",
                      status: "pending",
                      createdAt: 123,
                      groupId: "replacement-1",
                    },
                  },
                }],
              },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "x".repeat(250) }] },
        ],
      },
    });

    const units = toSemanticUnits(editor);
    expect(units[1]!.breadcrumb).toEqual(["Current "]);
    expect(units[0]!.changes).toEqual([{
      type: "suggestedDelete",
      text: "obsolete",
      id: "change-1",
      authorId: "u1",
      status: "pending",
      createdAt: 123,
      groupId: "replacement-1",
    }]);
  });

  it("excludes suggested-deletion text from structured table cells", () => {
    const editor = new ServerEditor({
      extensions: [
        StarterKit.configure({ table: true }),
        TrackChanges.configure({ userID: "u1" }),
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: { grid: [100] },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          { type: "text", text: "keep " },
                          {
                            type: "text",
                            text: "deleted",
                            marks: [{ type: "trackedDelete" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(toSemanticUnits(editor)[0]!.cells!.rows[0]!.cells[0]!.text).toBe("keep ");
    expect(toSemanticUnits(editor)[0]!.cells!.rows[0]!.cells[0]!.changes).toEqual([
      { type: "suggestedDelete", text: "deleted" },
    ]);
    expect(toSemanticUnits(editor)[0]!.changes).toEqual([
      { type: "suggestedDelete", text: "deleted" },
    ]);
  });
});
