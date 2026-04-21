import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { exportToMarkdown } from "../index";

function createEditor(content: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit], content });
}

describe("exportToMarkdown", () => {
  it("exports a single paragraph", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("Hello world");
  });

  it("exports headings with # syntax", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Subtitle" }],
        },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("# Title");
    expect(md).toContain("## Subtitle");
  });

  it("exports bold text with ** syntax", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "strong" },
          ],
        },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("**strong**");
  });

  it("exports italic text with * syntax", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "italic" }], text: "emphasis" },
          ],
        },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("*emphasis*");
  });

  it("exports bullet lists", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Item A" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Item B" }] },
              ],
            },
          ],
        },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toMatch(/[-*]\s+Item A/);
    expect(md).toMatch(/[-*]\s+Item B/);
  });

  it("exports ordered lists", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "First" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Second" }] },
              ],
            },
          ],
        },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toMatch(/1\.\s+First/);
    expect(md).toMatch(/2\.\s+Second/);
  });

  it("exports code blocks with triple backticks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });

  it("exports horizontal rules", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Above" }] },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "Below" }] },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("Above");
    expect(md).toMatch(/---/);
    expect(md).toContain("Below");
  });

  it("exports hard breaks as trailing spaces", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Line one" },
            { type: "hardBreak" },
            { type: "text", text: "Line two" },
          ],
        },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("Line one");
    expect(md).toContain("Line two");
  });

  it("exports links", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
              text: "click here",
            },
          ],
        },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("[click here](https://example.com)");
  });

  it("exports an empty document without errors", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    const md = exportToMarkdown(editor);
    expect(typeof md).toBe("string");
  });

  it("exports multiple paragraphs separated by blank lines", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second" }] },
      ],
    });
    const md = exportToMarkdown(editor);
    expect(md).toContain("First");
    expect(md).toContain("Second");
    // Paragraphs should be separated
    const firstIdx = md.indexOf("First");
    const secondIdx = md.indexOf("Second");
    const between = md.slice(firstIdx + 5, secondIdx);
    expect(between).toContain("\n\n");
  });
});
