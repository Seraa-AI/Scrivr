// @vitest-environment happy-dom
/**
 * In the browser, `importHtmlFromFile` asks for an .html file and replaces the
 * document of the editor that asked with it.
 */
import { describe, expect, it, vi } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { HtmlImport } from "./HtmlImport";

const editorWith = (text: string) =>
  new ServerEditor({
    extensions: [StarterKit, HtmlImport],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  });

/** Answer the file picker the command opened with `html`. */
function chooseFile(html: string): void {
  const input = document.querySelector("input[type=file]");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file picker opened");
  expect(input.accept).toContain(".html");
  Object.defineProperty(input, "files", { value: [new File([html], "draft.html", { type: "text/html" })] });
  input.dispatchEvent(new Event("change"));
}

describe("HtmlImport", () => {
  it("replaces the document of the editor that asked", async () => {
    const asking = editorWith("Alpha");
    const other = editorWith("Bravo");

    expect(asking.commands["importHtmlFromFile"]?.()).toBe(true);
    chooseFile(`<h1 style="text-align:center">Draft</h1><p>Body</p>`);

    await vi.waitFor(() => expect(asking.getState().doc.textContent).toBe("DraftBody"));
    expect(asking.getState().doc.child(0).attrs).toMatchObject({ level: 1, align: "center" });
    expect(other.getState().doc.textContent).toBe("Bravo");
  });

  it("logs what the file said that the document could not carry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = editorWith("Alpha");
    editor.commands["importHtmlFromFile"]?.();
    chooseFile(`<p style="line-height:2">x</p>`);

    await vi.waitFor(() => expect(editor.getState().doc.textContent).toBe("x"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("line-height"));
    warn.mockRestore();
  });
});
