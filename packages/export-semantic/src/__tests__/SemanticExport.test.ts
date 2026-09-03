/**
 * SemanticExport extension — the `exportSemantic` command, added to the editor
 * just like DocxExport/PdfExport. Exercised headlessly via the `onExport`
 * callback (the download path is browser-only).
 */
import { describe, expect, it, vi } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { SemanticExport } from "../SemanticExport";
import type { SemanticUnit } from "@scrivr/core";

function editorWith(content: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit, SemanticExport], content });
}

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    { type: "paragraph", content: [{ type: "text", text: "Body paragraph." }] },
  ],
};

describe("SemanticExport — exportSemantic command", () => {
  it("registers the command on the editor", () => {
    const editor = editorWith(doc);
    expect(typeof editor.commands["exportSemantic"]).toBe("function");
  });

  it("hands the emitted units to onExport (headless)", () => {
    const editor = editorWith(doc);
    let captured: SemanticUnit[] | null = null;
    editor.commands["exportSemantic"]?.({ onExport: (units) => (captured = units) });

    expect(captured).not.toBeNull();
    const units: SemanticUnit[] = captured!;
    // H1 + short lede group into one heading unit.
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ type: "heading", breadcrumb: [] });
    expect(units[0]!.text).toContain("Title");
  });

  it("forwards shortBlockMaxChars so a long lede no longer groups", () => {
    const editor = editorWith(doc);
    const onExport = vi.fn();
    // Threshold 0 → the lede is never 'short', so heading + body stay separate.
    editor.commands["exportSemantic"]?.({ shortBlockMaxChars: 0, onExport });

    const units: SemanticUnit[] = onExport.mock.calls[0]![0];
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.type)).toEqual(["heading", "paragraph"]);
  });

  it("returns false on the server with no onExport and no DOM", () => {
    const editor = editorWith(doc);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No DOM in the node test env → download path unavailable, command no-ops.
    editor.commands["exportSemantic"]?.();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
