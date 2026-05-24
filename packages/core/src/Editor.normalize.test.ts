/**
 * Browser `Editor` ingestion-time normalization. The pipeline lives in
 * `BaseEditor`'s constructor so both `Editor` and `ServerEditor` get
 * URL safety, table repair, and stable `nodeId`s on initial load —
 * not just after the first transaction fires the plugins.
 *
 * Server-side parity is covered by
 * `normalizeDocument.test.ts > ServerEditor wire-up`. This file proves
 * the same code path is reached through the browser editor that React
 * consumers use.
 */
import { describe, it, expect } from "vitest";
import { createTestEditor } from "./test-utils";

describe("Editor (browser) — normalize at construction", () => {
  it("stamps nodeIds on every id-bearing block in the initial JSON content", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
          { type: "paragraph", content: [{ type: "text", text: "b" }] },
        ],
      },
    });
    try {
      const ids: string[] = [];
      editor.getState().doc.descendants((node) => {
        if (typeof node.attrs["nodeId"] === "string") ids.push(node.attrs["nodeId"]);
        return true;
      });
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    } finally {
      editor.destroy();
    }
  });

  it("populates editor.lastNormalizeResult with warnings + fingerprint", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
      },
    });
    try {
      const result = editor.lastNormalizeResult;
      expect(result).not.toBeNull();
      expect(result!.warnings.some((w) => w.code === "ids-assigned")).toBe(true);
      expect(typeof result!.fingerprint).toBe("string");
      expect(result!.changed).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("strips an unsafe link href at construction (no transaction needed)", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "click",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      },
    });
    try {
      let hasLink = false;
      editor.getState().doc.descendants((n) => {
        if (n.marks.some((m) => m.type.name === "link")) hasLink = true;
      });
      expect(hasLink).toBe(false);
      expect(
        editor.lastNormalizeResult!.warnings.some((w) => w.code === "urls-sanitized"),
      ).toBe(true);
    } finally {
      editor.destroy();
    }
  });

});
