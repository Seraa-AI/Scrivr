import { describe, it, expect } from "vitest";
import type { Schema } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { ServerEditor } from "../ServerEditor";
import { normalizeDocument } from "./normalizeDocument";

const schema: Schema = new ExtensionManager([
  StarterKit.configure({ table: true }),
]).schema;

interface JsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

const doc = (...content: JsonNode[]): Record<string, unknown> => ({
  type: "doc",
  content,
});
const para = (text = "hello"): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("normalizeDocument — clean input", () => {
  it("returns changed:false with no warnings for an already-normalized doc", () => {
    // Seed by running once, then re-normalize the output's JSON.
    const first = normalizeDocument(doc(para("hi")), { schema });
    const second = normalizeDocument(first.doc.toJSON() as Record<string, unknown>, { schema });
    expect(second.changed).toBe(false);
    expect(second.warnings).toEqual([]);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("populates doc, fingerprint, and warnings array on every call", () => {
    const result = normalizeDocument(doc(para("hi")), { schema });
    expect(result.doc.type.name).toBe("doc");
    expect(typeof result.fingerprint).toBe("string");
    expect(result.fingerprint.length).toBeGreaterThan(0);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

describe("normalizeDocument — block ID assignment", () => {
  it("assigns ids to blocks missing nodeId and reports it as a warning", () => {
    const result = normalizeDocument(doc(para("a"), para("b")), { schema });
    expect(result.changed).toBe(true);
    expect(result.doc.firstChild!.attrs["nodeId"]).toBeTypeOf("string");
    expect(result.warnings.some((w) => w.code === "ids-assigned")).toBe(true);
  });

  it("uses the injected generator", () => {
    let n = 0;
    const result = normalizeDocument(doc(para("a"), para("b")), {
      schema,
      generate: () => `g-${++n}`,
    });
    const ids: string[] = [];
    result.doc.descendants((node) => {
      if (typeof node.attrs["nodeId"] === "string") ids.push(node.attrs["nodeId"]);
      return true;
    });
    expect(ids).toEqual(["g-1", "g-2"]);
  });

  it("can disable ID assignment via assignIds:false", () => {
    const result = normalizeDocument(doc(para("a")), {
      schema,
      assignIds: false,
    });
    expect(result.doc.firstChild!.attrs["nodeId"]).toBeNull();
    expect(result.warnings.some((w) => w.code === "ids-assigned")).toBe(false);
  });
});

describe("normalizeDocument — URL safety", () => {
  it("drops an image with javascript: src and emits urls-sanitized", () => {
    const input = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "ok" },
        // Image is a block node in this schema; place it at the doc root.
      ],
    }, {
      type: "image",
      attrs: { src: "javascript:alert(1)", alt: "bad", title: null },
    });
    const result = normalizeDocument(input, { schema });
    expect(result.changed).toBe(true);
    expect(result.warnings.some((w) => w.code === "urls-sanitized")).toBe(true);
    // The image is gone — only the paragraph remains.
    expect(result.doc.childCount).toBe(1);
    expect(result.doc.firstChild!.type.name).toBe("paragraph");
  });

  it("strips a link mark with javascript: href but preserves the text", () => {
    const input = doc({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "click me",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)", target: null } }],
        },
      ],
    });
    const result = normalizeDocument(input, { schema });
    expect(result.changed).toBe(true);
    expect(result.warnings.some((w) => w.code === "urls-sanitized")).toBe(true);
    const text = result.doc.firstChild!.firstChild!;
    expect(text.text).toBe("click me");
    expect(text.marks).toHaveLength(0);
  });
});

describe("normalizeDocument — table repair", () => {
  it("repairs a table cell with gridSpan: 0 and emits tables-normalized", () => {
    const input = doc({
      type: "table",
      attrs: { layout: "fixed", grid: [100] },
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { gridSpan: 0, vMerge: "none" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
            },
          ],
        },
      ],
    });
    const result = normalizeDocument(input, { schema });
    expect(result.warnings.some((w) => w.code === "tables-normalized")).toBe(true);
    let cellGridSpan: unknown = null;
    result.doc.descendants((node) => {
      if (node.type.name === "tableCell") cellGridSpan = node.attrs["gridSpan"];
      return true;
    });
    expect(cellGridSpan).toBe(1);
  });
});

describe("normalizeDocument — fingerprint", () => {
  it("is deterministic across calls with the same input", () => {
    const a = normalizeDocument(doc(para("hi")), { schema, assignIds: false });
    const b = normalizeDocument(doc(para("hi")), { schema, assignIds: false });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("differs for structurally different docs", () => {
    const a = normalizeDocument(doc(para("hi")), { schema, assignIds: false });
    const b = normalizeDocument(doc(para("bye")), { schema, assignIds: false });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("normalizeDocument — ServerEditor wire-up", () => {
  it("setContent populates lastNormalizeResult with warnings + fingerprint", () => {
    const editor = new ServerEditor({});
    expect(editor.lastNormalizeResult).toBeNull();

    editor.setContent({
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
    });

    const result = editor.lastNormalizeResult;
    expect(result).not.toBeNull();
    expect(result!.warnings.some((w) => w.code === "urls-sanitized")).toBe(true);
    expect(result!.warnings.some((w) => w.code === "ids-assigned")).toBe(true);
    expect(typeof result!.fingerprint).toBe("string");
    expect(result!.changed).toBe(true);
    // The applied doc must be the normalized one — link stripped.
    let hasLink = false;
    editor.getState().doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    expect(hasLink).toBe(false);
  });

  it("a clean setContent produces no warnings beyond ids-assigned", () => {
    const editor = new ServerEditor({});
    editor.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
    const codes = editor.lastNormalizeResult!.warnings.map((w) => w.code);
    expect(codes).not.toContain("urls-sanitized");
    expect(codes).not.toContain("tables-normalized");
  });
});

describe("normalizeDocument — bounds", () => {
  it("throws in strict mode when maxNodes is exceeded", () => {
    const many = Array.from({ length: 50 }, () => para("x"));
    expect(() =>
      normalizeDocument(doc(...many), { schema, mode: "strict", maxNodes: 10 }),
    ).toThrow(/maxNodes/);
  });

  it("emits a bounds-exceeded warning in repair mode and returns the doc anyway", () => {
    const many = Array.from({ length: 50 }, () => para("x"));
    const result = normalizeDocument(doc(...many), { schema, maxNodes: 10 });
    expect(result.warnings.some((w) => w.code === "bounds-exceeded")).toBe(true);
    expect(result.doc.childCount).toBe(50);
  });

  it("does not warn when the doc fits within the bound", () => {
    const result = normalizeDocument(doc(para("hi")), { schema, maxNodes: 100 });
    expect(result.warnings.some((w) => w.code === "bounds-exceeded")).toBe(false);
  });
});
