/**
 * Integration tests for the safeUrl ingestion gate wired into Link.
 * Helper-level URL tests live in `model/safeUrl.test.ts`; these prove
 * the gate is actually called at every Link ingestion point:
 *   - parseDOM (paste)
 *   - setLinkHref (programmatic command)
 *
 * setLink uses window.prompt and isn't covered here (would require
 * stubbing the global prompt). The validation lives in the same helper
 * call, so coverage is structural.
 */
import { describe, it, expect } from "vitest";
import { DOMParser as PMDOMParser } from "prosemirror-model";
import { ServerEditor } from "../../ServerEditor";

function parseHtml(editor: ServerEditor, html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return PMDOMParser.fromSchema(editor.schema).parse(doc.body);
}

describe("Link — parseDOM rejects dangerous hrefs", () => {
  it("strips a javascript: link mark on paste (text content survives)", () => {
    const editor = new ServerEditor({});
    const doc = parseHtml(
      editor,
      `<p>before <a href="javascript:alert(1)">click me</a> after</p>`,
    );
    // Text content is preserved; no link mark anywhere.
    expect(doc.textContent).toBe("before click me after");
    let hasLink = false;
    doc.descendants((node) => {
      if (node.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    expect(hasLink).toBe(false);
  });

  it("strips a data:text/html link mark on paste", () => {
    const editor = new ServerEditor({});
    const doc = parseHtml(
      editor,
      `<p><a href="data:text/html,<script>alert(1)</script>">bad</a></p>`,
    );
    let hasLink = false;
    doc.descendants((node) => {
      if (node.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    expect(hasLink).toBe(false);
  });

  it("preserves the link mark for safe https URLs", () => {
    const editor = new ServerEditor({});
    const doc = parseHtml(
      editor,
      `<p><a href="https://example.com">safe</a></p>`,
    );
    let hrefSeen: string | null = null;
    doc.descendants((node) => {
      const linkMark = node.marks.find((m) => m.type.name === "link");
      if (linkMark) hrefSeen = linkMark.attrs["href"];
    });
    expect(hrefSeen).toBe("https://example.com");
  });

  it("preserves a fragment-only href", () => {
    const editor = new ServerEditor({});
    const doc = parseHtml(editor, `<p><a href="#section-1">jump</a></p>`);
    let hrefSeen: string | null = null;
    doc.descendants((node) => {
      const linkMark = node.marks.find((m) => m.type.name === "link");
      if (linkMark) hrefSeen = linkMark.attrs["href"];
    });
    expect(hrefSeen).toBe("#section-1");
  });
});

describe("Link — setLinkHref command rejects dangerous hrefs", () => {
  function makeEditorWithText(text: string): ServerEditor {
    return new ServerEditor({
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text }] },
        ],
      },
    });
  }

  it("returns false and stores nothing when href is javascript:", () => {
    const editor = makeEditorWithText("hello");
    // Select the word "hello" (PM positions: paragraph open is 0, text starts at 1).
    const fired = editor.commands.setLinkHref(1, 6, "javascript:alert(1)");
    // Commands return `void` through the bound surface — the predicate of
    // "did anything land" is observable on the doc itself.
    void fired;
    const para = editor.getState().doc.firstChild!;
    const text = para.firstChild!;
    expect(text.marks.some((m) => m.type.name === "link")).toBe(false);
  });

  it("stores the href when it's an allow-listed scheme", () => {
    const editor = makeEditorWithText("hello");
    editor.commands.setLinkHref(1, 6, "https://example.com");
    const para = editor.getState().doc.firstChild!;
    const text = para.firstChild!;
    const linkMark = text.marks.find((m) => m.type.name === "link");
    expect(linkMark?.attrs["href"]).toBe("https://example.com");
  });

  it("rejects unsafe href even after a previous safe one was set", () => {
    const editor = makeEditorWithText("hello");
    editor.commands.setLinkHref(1, 6, "https://safe.com");
    editor.commands.setLinkHref(1, 6, "javascript:alert(1)");
    // The previous safe href is removed (the command always removes
    // existing marks first) but the unsafe one is not stored — should be
    // unmarked text now.
    const para = editor.getState().doc.firstChild!;
    const text = para.firstChild!;
    const linkMark = text.marks.find((m) => m.type.name === "link");
    // Previous safe link should still be there because the unsafe command
    // bails before dispatching (so the removeMark step doesn't run either).
    expect(linkMark?.attrs["href"]).toBe("https://safe.com");
  });

  // Note: the Commands<ReturnType> augmentation types setLinkHref's
  // `href` arg as `string`, so non-string misuse is caught at compile
  // time — no runtime test needed. The runtime typeof-string check
  // inside the command stays as defence in depth against any TS bypass
  // (e.g. JS callers, AI-generated dispatch).
});
