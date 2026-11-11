/**
 * The `exportPdf` command's gate and its editor identity. Export renders from
 * a live layout pipeline, so the command refuses a headless editor — but it
 * has to accept any editor that has one, and hand it the document that asked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { DocumentLayout, IBaseEditor } from "@scrivr/core";
import { PAGE_CONFIG } from "./fixtures";

const exportToPdf = vi.hoisted(() =>
  // Never resolves: the assertion is which editor it was handed.
  vi.fn((_editor: unknown, _opts: unknown) => new Promise<never>(() => {})),
);
vi.mock("../index", () => ({ exportToPdf }));

const { PdfExport } = await import("../PdfExport");

const emptyLayout: DocumentLayout = {
  pages: [],
  pageConfig: PAGE_CONFIG,
  version: 1,
  totalContentHeight: 0,
  fragments: [],
};

/**
 * A layout-capable editor that is not the concrete browser `Editor` — the case
 * a `measurer` probe refused, and the PDF lane supports: `exportToPdf` reads
 * `layout` and `ensureFullLayout` and builds its own measurer from pdf-lib faces.
 */
class LayoutCapableEditor extends ServerEditor {
  get layout(): DocumentLayout {
    return emptyLayout;
  }
  ensureFullLayout(): void {}
}

const contentWith = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const isBaseEditor = (value: unknown): value is IBaseEditor =>
  typeof value === "object" && value !== null && "getState" in value;

const textOf = (editor: IBaseEditor) => editor.getState().doc.textContent;

describe("PdfExport — exportPdf", () => {
  beforeEach(() => {
    exportToPdf.mockClear();
    vi.stubGlobal("document", {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("exports the document of the editor that asked", () => {
    const opts = { extensions: [StarterKit, PdfExport] };
    const a = new LayoutCapableEditor({ ...opts, content: contentWith("Alpha") });
    new LayoutCapableEditor({ ...opts, content: contentWith("Bravo") });

    a.commands["exportPdf"]?.();

    expect(exportToPdf).toHaveBeenCalledTimes(1);
    const exported = exportToPdf.mock.calls[0]![0];
    expect(isBaseEditor(exported) && textOf(exported)).toBe("Alpha");
  });

  it("refuses a headless editor, and says which call to use instead", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, PdfExport],
      content: contentWith("Alpha"),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    editor.commands["exportPdf"]?.();

    expect(exportToPdf).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toContain("exportToPdf(editor, opts)");
    warn.mockRestore();
  });
});
