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

  // Emphasis that opens or closes on whitespace is not emphasis in Markdown.
  it.each([
    ["a colour", [{ type: "color", attrs: { color: "#ff0000" } }], "**Name:** John"],
    ["a font", [{ type: "fontFamily", attrs: { family: "Georgia" } }], "**Name:** John"],
    ["a size and a highlight", [{ type: "fontSize", attrs: { size: 20 } }, { type: "highlight" }], "**Name:** John"],
    ["an underline", [{ type: "underline" }], "**<u>Name:</u>** John"],
    ["a strikethrough", [{ type: "strikethrough" }], "**~~Name:~~** John"],
    ["a link", [{ type: "link", attrs: { href: "https://example.com" } }], "**[Name:](https://example.com)** John"],
  ])("closes bold before the space that follows it, with %s on it too", (_name, marks, expected) => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "Name: ", marks: [{ type: "bold" }, ...marks] },
        { type: "text", text: "John" },
      ] }] },
    });
    expect(editor.getMarkdown().trim()).toBe(expected);
  });

  it("opens bold after the space that precedes it, with a colour on it too", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "a" },
        { type: "text", text: " b", marks: [{ type: "bold" }, { type: "color", attrs: { color: "#ff0000" } }] },
      ] }] },
    });
    expect(editor.getMarkdown().trim()).toBe("a **b**");
  });

  it("takes the space after struck text out of the marks", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "gone ", marks: [{ type: "strikethrough" }] },
        { type: "text", text: "kept" },
      ] }] },
    });
    expect(editor.getMarkdown().trim()).toBe("~~gone~~ kept");
  });
});
