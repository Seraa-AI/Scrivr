/**
 * Tests for the markdown ingestion path used when an editor is
 * constructed with `content: "..."` (a markdown string).
 *
 * Covers the structural / URL guarantees we expect to hold for any
 * markdown that lands in the document. Raw HTML in markdown source
 * survives as literal text under `MarkdownIt({ html: false })` — that's
 * safe (canvas can't execute text; DOM renderers must use textContent),
 * so we don't assert on it. The structural and URL invariants do hold.
 */
import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "../ServerEditor";

const FORBIDDEN_SCHEMES = ["javascript:", "data:", "vbscript:", "file:"];
const FORBIDDEN_NODE_TYPES = [
  "script", "style", "iframe", "object", "embed", "form",
];
const URL_ATTR_KEYS = ["href", "src", "url", "action", "formaction"];

function startsWithForbiddenScheme(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase().trimStart();
  return FORBIDDEN_SCHEMES.some((s) => lower.startsWith(s));
}

function assertSafe(doc: Node, label: string): void {
  doc.descendants((node) => {
    if (FORBIDDEN_NODE_TYPES.includes(node.type.name)) {
      throw new Error(
        `[${label}] Schema accepted a "${node.type.name}" node from markdown — it should not be declared.`,
      );
    }
    for (const key of URL_ATTR_KEYS) {
      if (startsWithForbiddenScheme(node.attrs[key])) {
        throw new Error(
          `[${label}] Node "${node.type.name}" kept dangerous URL ${key}="${node.attrs[key]}".`,
        );
      }
    }
    for (const mark of node.marks) {
      for (const key of URL_ATTR_KEYS) {
        if (startsWithForbiddenScheme(mark.attrs[key])) {
          throw new Error(
            `[${label}] Mark "${mark.type.name}" kept dangerous URL ${key}="${mark.attrs[key]}".`,
          );
        }
      }
    }
  });
}

describe("markdown ingestion — happy path", () => {
  it("parses headings", () => {
    const editor = new ServerEditor({ content: "# Hello" });
    const first = editor.getState().doc.firstChild!;
    expect(first.type.name).toBe("heading");
    expect(first.textContent).toBe("Hello");
  });

  it("parses paragraphs with inline marks", () => {
    const editor = new ServerEditor({ content: "**bold** and *italic*" });
    const para = editor.getState().doc.firstChild!;
    expect(para.type.name).toBe("paragraph");
    expect(para.textContent).toBe("bold and italic");
  });
});

describe("markdown ingestion — hostile inputs are inert", () => {
  it("treats inline <script> as literal text, not as a node", () => {
    // MarkdownIt({ html: false }) preserves raw HTML as text. The text
    // is not executable in any of our render targets — canvas paints
    // glyphs, exports use textContent / structured writers, and the
    // security model requires DOM renderers to use textContent.
    const editor = new ServerEditor({
      content: "# Heading\n\n<script>alert(1)</script>\n\nbody",
    });
    assertSafe(editor.getState().doc, "markdown with script tag");
    // The textContent will contain the literal source — that's expected
    // and safe.
    expect(editor.getState().doc.textContent).toContain("Heading");
  });

  it("treats inline <iframe> as literal text", () => {
    const editor = new ServerEditor({
      content: "text\n\n<iframe src=\"https://evil.example.com\"></iframe>\n\nmore",
    });
    assertSafe(editor.getState().doc, "markdown with iframe");
  });
});
