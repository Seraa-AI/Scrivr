/**
 * TrackChanges contributes a `semantic` mark handler (via addExports) so the
 * chunk emitter excludes suggested-deletion text from unit text — a reviewer's
 * pending deletion must never be embedded — while inserted text is kept.
 *
 * Importing `@scrivr/export-semantic` here also loads the `semantic`
 * FormatHandlers augmentation into this package's typecheck, which is what lets
 * TrackChanges' `addExports().semantic` return type-check.
 */
// Opt into the FormatHandlers "semantic" key so TrackChanges' addExports().semantic
// return type-checks. The package's runtime index no longer side-effect-loads this
// (so AiToolkit can import export-semantic without polluting plugins' DTS build).
import "@scrivr/export-semantic/augment";
import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "@scrivr/export-semantic";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";

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
    expect(units[0]!.view).toBe("proposed");
    expect(units[0]!.text).toBe("Keep inserted tail");
    expect(units[0]?.changes).toEqual([
      { type: "suggestedInsert", text: "inserted ", at: 5, length: 9 },
      { type: "suggestedDelete", text: "deleted ", at: 14, length: 0 },
    ]);
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

  it("preserves suggested deletion metadata when dataTracked is an empty array", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1" })],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "keep " },
              {
                type: "text",
                text: "deleted",
                marks: [{ type: "trackedDelete", attrs: { dataTracked: [] } }],
              },
            ],
          },
        ],
      },
    });

    const units = toSemanticUnits(editor);
    expect(units[0]!.text).toBe("keep ");
    expect(units[0]?.changes).toEqual([{ type: "suggestedDelete", text: "deleted", at: 5, length: 0 }]);
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
    expect(units[1]!.breadcrumb).toEqual(["Current"]);
    expect(units[0]!.changes).toEqual([{
      type: "suggestedDelete",
      text: "obsolete",
      at: 8,
      length: 0,
      id: "change-1",
      authorId: "u1",
      status: "pending",
      createdAt: 123,
      groupId: "replacement-1",
    }]);
  });

  it("uses mark-aware text when deciding whether to group a heading with a short lede", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1" })],
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Intro" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "short" },
              {
                type: "text",
                text: "x".repeat(250),
                marks: [{ type: "trackedDelete" }],
              },
            ],
          },
        ],
      },
    });

    const units = toSemanticUnits(editor);
    expect(units).toHaveLength(1);
    expect(units[0]!.nodeIds).toHaveLength(2);
    expect(units[0]!.text).toBe("Intro\nshort");
    expect(units[0]?.changes).toEqual([{ type: "suggestedDelete", text: "x".repeat(250), at: 11, length: 0 }]);
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
      { type: "suggestedDelete", text: "deleted", at: 5, length: 0 },
    ]);
    expect(toSemanticUnits(editor)[0]!.changes).toEqual([
      { type: "suggestedDelete", text: "deleted", at: 5, length: 0 },
    ]);
  });
});

describe("a unit with pending changes keeps markdown of the proposed view", () => {
  const suggesting = (content: unknown[]) => new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled })],
    content: { type: "doc", content },
  });
  const para = (nodeId: string, content: unknown[]) => ({ type: "paragraph", attrs: { nodeId }, content });

  it("reads as the proposal would, its formatting kept", () => {
    const editor = suggesting([para("p1", [
      { type: "text", text: "keep " }, { type: "text", text: "this", marks: [{ type: "bold" }] }, { type: "text", text: " word" },
    ])]);
    editor.applyTransaction(editor.getState().tr.insertText("new ", 6));
    const word = editor.getState().doc.textContent.indexOf("word") + 1;
    editor.applyTransaction(editor.getState().tr.delete(word, word + 4));

    const unit = toSemanticUnits(editor)[0]!;
    expect(unit.changes?.length).toBeGreaterThan(0);
    expect(unit.markdown).toBe("keep new **this** ");
  });

  it("keeps a heading's markdown", () => {
    const editor = suggesting([{ type: "heading", attrs: { nodeId: "h1", level: 2 }, content: [{ type: "text", text: "Scope" }] }]);
    editor.applyTransaction(editor.getState().tr.insertText(" and terms", 6));

    expect(toSemanticUnits(editor)[0]!.markdown).toBe("## Scope and terms");
  });

  it("has none for a block proposed for deletion", () => {
    const editor = suggesting([para("p1", [{ type: "text", text: "stays" }]), para("p2", [{ type: "text", text: "goes" }])]);
    const second = editor.getState().doc.child(0).nodeSize;
    editor.applyTransaction(editor.getState().tr.delete(second, second + editor.getState().doc.child(1).nodeSize));

    const units = toSemanticUnits(editor);
    const gone = units.find((unit) => unit.id === "p2");
    expect(gone?.proposedForDeletion).toBe(true);
    expect(gone?.markdown).toBeUndefined();
  });

  it("leaves the original view as it reads", () => {
    const editor = suggesting([para("p1", [{ type: "text", text: "keep this" }])]);
    editor.applyTransaction(editor.getState().tr.insertText(" new", 10));

    expect(toSemanticUnits(editor, { view: "original" })[0]!.markdown).toBe("keep this");
  });
});
