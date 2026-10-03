/**
 * The `exportDocx` command's editor identity. One configured extension can
 * serve several editors, so the command has to resolve the editor that asked
 * rather than whichever one registered last.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { IBaseEditor } from "@scrivr/core";

// Never resolves: the assertion is which editor it was handed, and the
// download path that follows needs a real DOM.
const runExportDocx = vi.hoisted(() =>
  vi.fn((_editor: unknown, _opts: unknown) => new Promise<never>(() => {})),
);
vi.mock("./export", () => ({ exportDocx: runExportDocx }));

const { DocxExport } = await import("./DocxExport");

const editorWith = (text: string) =>
  new ServerEditor({
    extensions: [StarterKit, DocxExport],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  });

const isBaseEditor = (value: unknown): value is IBaseEditor =>
  typeof value === "object" && value !== null && "getState" in value;

const textOf = (editor: IBaseEditor) => editor.getState().doc.textContent;

describe("DocxExport — one configured extension, two editors", () => {
  beforeEach(() => {
    runExportDocx.mockClear();
    // The command is browser-gated; the identity it resolves is not.
    vi.stubGlobal("document", {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("exports the document of the editor that asked", () => {
    const a = editorWith("Alpha");
    editorWith("Bravo");

    a.commands["exportDocx"]?.();

    expect(runExportDocx).toHaveBeenCalledTimes(1);
    const exported = runExportDocx.mock.calls[0]![0];
    expect(isBaseEditor(exported) && textOf(exported)).toBe("Alpha");
  });
});
