// @vitest-environment happy-dom
/**
 * The `importDocxFromFile` command writes into the editor, so the editor it
 * resolves is the document that gets replaced. One configured extension can
 * serve several editors; the command has to write into the one that asked.
 */
import { describe, expect, it, vi } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { IBaseEditor } from "@scrivr/core";

const importDocx = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ doc: null, diagnostics: [] })),
);
const applyImportedDocument = vi.hoisted(() => vi.fn());
vi.mock("./import", () => ({ importDocx }));
vi.mock("./applyDocument", () => ({ applyImportedDocument }));

const { DocxImport } = await import("./DocxImport");

const editorWith = (text: string) =>
  new ServerEditor({
    extensions: [StarterKit, DocxImport],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  });

const isBaseEditor = (value: unknown): value is IBaseEditor =>
  typeof value === "object" && value !== null && "getState" in value;

/** Resolve the file picker the command opens with a stand-in .docx. */
function pickFile(): Promise<void> {
  const input = document.querySelector("input[type=file]");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file picker opened");
  const file = new File([new Uint8Array([1])], "doc.docx");
  Object.defineProperty(input, "files", { value: [file] });
  input.dispatchEvent(new Event("change"));
  // Let the command's promise chain run to applyImportedDocument.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("DocxImport — one configured extension, two editors", () => {
  it("imports into the editor that asked", async () => {
    const a = editorWith("Alpha");
    editorWith("Bravo");

    a.commands["importDocxFromFile"]?.();
    await pickFile();

    expect(applyImportedDocument).toHaveBeenCalledTimes(1);
    const target = applyImportedDocument.mock.calls[0]![0];
    expect(isBaseEditor(target) && target.getState().doc.textContent).toBe("Alpha");
  });
});
