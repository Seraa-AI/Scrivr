import { describe, expect, it } from "vitest";
import { ServerEditor } from "./ServerEditor";
import { StarterKit } from "./extensions/StarterKit";

describe("Markdown export", () => {
  it("keeps the words of text whose formatting Markdown cannot write, such as a colour", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "plain " },
        { type: "text", text: "red", marks: [{ type: "color", attrs: { color: "#ff0000" } }] },
        { type: "text", text: " and ", marks: [{ type: "fontSize", attrs: { size: 20 } }] },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
      ] }] },
    });
    expect(editor.getMarkdown().trim()).toBe("plain red and **bold**");
  });
});
