/**
 * sanitizeDocUrls — post-parse URL allow-list pass for raw PM JSON.
 *
 * The parseDOM gate (Link/Image) catches URLs that come in via HTML
 * paste. But the editor also accepts ProseMirror JSON straight from
 * disk / API / collab snapshot via `schema.nodeFromJSON`, which
 * bypasses parseDOM entirely. A saved doc with
 * `link.attrs.href = "javascript:..."` would round-trip unmolested.
 *
 * This pass walks the PM doc after construction, drops nodes whose
 * URL attr is unsafe (image with javascript: src → gone), and strips
 * marks whose URL attr is unsafe (link with javascript: href → text
 * preserved, mark removed). Same semantic as parseDOM returning false.
 */
import { describe, it, expect } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { sanitizeDocUrls } from "./sanitizeDocUrls";

function buildEditor() {
  return new ServerEditor({});
}

describe("sanitizeDocUrls — image src", () => {
  it("drops an image node with javascript: src", () => {
    const editor = buildEditor();
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "before " },
          { type: "image", attrs: { src: "javascript:alert(1)", alt: "x" } },
          { type: "text", text: " after" },
        ],
      }],
    });
    const cleaned = sanitizeDocUrls(doc, editor.schema);
    expect(cleaned.textContent).toBe("before  after");
    let seenImage = false;
    cleaned.descendants((n) => {
      if (n.type.name === "image") seenImage = true;
    });
    expect(seenImage).toBe(false);
  });

  it("drops an image with data:text/html src", () => {
    const editor = buildEditor();
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "image", attrs: { src: "data:text/html,<script>alert(1)</script>", alt: "" } }],
      }],
    });
    const cleaned = sanitizeDocUrls(doc, editor.schema);
    let seenImage = false;
    cleaned.descendants((n) => {
      if (n.type.name === "image") seenImage = true;
    });
    expect(seenImage).toBe(false);
  });

  it("preserves an image with safe https src", () => {
    const editor = buildEditor();
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "image", attrs: { src: "https://example.com/a.png", alt: "a" } }],
      }],
    });
    const cleaned = sanitizeDocUrls(doc, editor.schema);
    let seenSrc: string | null = null;
    cleaned.descendants((n) => {
      if (n.type.name === "image") seenSrc = n.attrs["src"];
    });
    expect(seenSrc).toBe("https://example.com/a.png");
  });
});

describe("sanitizeDocUrls — link href", () => {
  it("strips a link mark with javascript: href (text preserved)", () => {
    const editor = buildEditor();
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "click me",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        }],
      }],
    });
    const cleaned = sanitizeDocUrls(doc, editor.schema);
    expect(cleaned.textContent).toBe("click me");
    let hasLink = false;
    cleaned.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    expect(hasLink).toBe(false);
  });

  it("strips a link mark with data: href", () => {
    const editor = buildEditor();
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "x",
          marks: [{ type: "link", attrs: { href: "data:text/html,<script>" } }],
        }],
      }],
    });
    const cleaned = sanitizeDocUrls(doc, editor.schema);
    let hasLink = false;
    cleaned.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    expect(hasLink).toBe(false);
  });

  it("preserves a link mark with safe https href", () => {
    const editor = buildEditor();
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "safe",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        }],
      }],
    });
    const cleaned = sanitizeDocUrls(doc, editor.schema);
    let hrefSeen: string | null = null;
    cleaned.descendants((n) => {
      const linkMark = n.marks.find((m) => m.type.name === "link");
      if (linkMark) hrefSeen = linkMark.attrs["href"];
    });
    expect(hrefSeen).toBe("https://example.com");
  });

  it("strips only the unsafe link mark — co-occurring marks survive", () => {
    const editor = buildEditor();
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "bold link",
          marks: [
            { type: "bold" },
            { type: "link", attrs: { href: "javascript:alert(1)" } },
          ],
        }],
      }],
    });
    const cleaned = sanitizeDocUrls(doc, editor.schema);
    let markNames: string[] = [];
    cleaned.descendants((n) => {
      if (n.isText) markNames = n.marks.map((m) => m.type.name);
    });
    expect(markNames).toEqual(["bold"]);
  });
});

describe("sanitizeDocUrls — fast path", () => {
  it("returns the same doc reference when nothing needed cleaning", () => {
    // Cheap idempotency: a clean doc shouldn't pay the cost of a rebuild.
    const editor = buildEditor();
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "hello " },
          {
            type: "text",
            text: "world",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      }],
    });
    const cleaned = sanitizeDocUrls(doc, editor.schema);
    expect(cleaned).toBe(doc);
  });
});

describe("sanitizeDocUrls — ServerEditor integration", () => {
  it("constructor JSON path sanitizes link.href", () => {
    // Codex-flagged scenario: a saved doc on disk contains a malicious
    // link mark. Loading it via `new ServerEditor({ content: json })`
    // must not let that href survive into the editor's state.
    const editor = new ServerEditor({
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{
            type: "text",
            text: "click",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          }],
        }],
      },
    });
    let hasLink = false;
    editor.getState().doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    expect(hasLink).toBe(false);
  });

  it("constructor JSON path drops unsafe image.src", () => {
    const editor = new ServerEditor({
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "hi " },
            { type: "image", attrs: { src: "javascript:alert(1)", alt: "" } },
          ],
        }],
      },
    });
    let hasImage = false;
    editor.getState().doc.descendants((n) => {
      if (n.type.name === "image") hasImage = true;
    });
    expect(hasImage).toBe(false);
  });

  it("setContent() runtime JSON load also sanitizes", () => {
    // ServerEditor.setContent is a separate ingestion path from the
    // constructor — covered by the same sanitiser call.
    const editor = new ServerEditor({});
    editor.setContent({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "click",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        }],
      }],
    });
    let hasLink = false;
    editor.getState().doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    expect(hasLink).toBe(false);
  });
});
