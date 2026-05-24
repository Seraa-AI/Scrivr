import { describe, it, expect } from "vitest";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { DefaultContent } from "./DefaultContent";

describe("DefaultContent — extension surface", () => {
  it("seeds the editor from a JSON ProseMirror document", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello from JSON" }],
        },
      ],
    };
    const editor = new ServerEditor({
      extensions: [StarterKit, DefaultContent.configure({ json })],
    });
    expect(editor.getText()).toBe("Hello from JSON");
  });

  it("seeds the editor from a markdown string", () => {
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        DefaultContent.configure({ markdown: "# Hello\n\nA paragraph." }),
      ],
    });
    const json = editor.toJSON();
    const content = (json["content"] as Array<{ type: string }>) ?? [];
    expect(content[0]?.type).toBe("heading");
    expect(content[1]?.type).toBe("paragraph");
    expect(editor.getText()).toContain("Hello");
    expect(editor.getText()).toContain("A paragraph.");
  });

  it("throws when both markdown and json are provided", () => {
    expect(
      () =>
        new ServerEditor({
          extensions: [
            StarterKit,
            DefaultContent.configure({
              markdown: "# x",
              json: { type: "doc", content: [] },
            }),
          ],
        }),
    ).toThrow(/exactly one of/i);
  });

  it("throws when neither markdown nor json are provided", () => {
    expect(
      () =>
        new ServerEditor({
          extensions: [StarterKit, DefaultContent.configure({})],
        }),
    ).toThrow(/exactly one of/i);
  });
});

describe("BaseEditor — content option", () => {
  it("accepts a markdown string and parses it via the merged token map", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: "## Heading two\n\nBody text.",
    });
    const content = (editor.toJSON()["content"] as Array<{ type: string; attrs?: Record<string, unknown> }>) ?? [];
    expect(content[0]?.type).toBe("heading");
    expect(content[0]?.attrs?.["level"]).toBe(2);
    expect(editor.getText()).toContain("Heading two");
    expect(editor.getText()).toContain("Body text.");
  });

  it("accepts a ProseMirror JSON object (existing behaviour)", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "from json" }] },
      ],
    };
    const editor = new ServerEditor({ extensions: [StarterKit], content: json });
    expect(editor.getText()).toBe("from json");
  });

  it("constructor `content` overrides any DefaultContent extension contribution", () => {
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        DefaultContent.configure({ markdown: "# from extension" }),
      ],
      content: "# from constructor",
    });
    expect(editor.getText()).toBe("from constructor");
  });
});
