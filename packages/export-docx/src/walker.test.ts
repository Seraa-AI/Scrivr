/**
 * Walker contract tests. Drives the walker through a real `ServerEditor`
 * schema (StarterKit) so the tree shapes match production.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor } from "@scrivr/core";
import type { Node } from "prosemirror-model";
import { walkDocument } from "./walker";
import { createDocxContext } from "./createContext";
import { serializeXml, xml } from "./xml";
import { DocxExportError } from "./error";
import type {
  DocxNodeHandler,
  DocxMarkHandler,
  DocxRunProps,
} from "./handlers";

interface MinimalHandlers {
  nodes: Record<string, DocxNodeHandler>;
  marks: Record<string, DocxMarkHandler>;
}

const paragraphHandler: DocxNodeHandler = (_n, children) =>
  xml("w:p", undefined, children);

const headingHandler: DocxNodeHandler = (node, children) =>
  xml(
    "w:p",
    undefined,
    [
      xml("w:pPr", undefined, [
        xml("w:pStyle", { "w:val": `Heading${node.attrs["level"] ?? 1}` }),
      ]),
      ...children,
    ],
  );

const boldMark: DocxMarkHandler = (props) => ({ ...props, bold: true });
const italicMark: DocxMarkHandler = (props) => ({ ...props, italic: true });
const underlineMark: DocxMarkHandler = (props) => ({ ...props, underline: true });
const strikeMark: DocxMarkHandler = (props) => ({ ...props, strike: true });
const colorMark: DocxMarkHandler = (props, mark) => {
  const v = mark.attrs["color"];
  return typeof v === "string" ? { ...props, color: v } : props;
};

function buildDocFrom(editor: ServerEditor, build: (s: import("prosemirror-model").Schema) => Node): Node {
  return build(editor.schema);
}

function walkBody(
  doc: Node,
  handlers: MinimalHandlers,
  opts: Partial<Omit<Parameters<typeof createDocxContext>[0], "editor">> = {},
  editor: ServerEditor = new ServerEditor(),
): { body: string; diagnostics: ReturnType<ReturnType<typeof createDocxContext>["ctx"]["diagnostics"]["list"]> } {
  const { ctx } = createDocxContext({ editor, ...opts });
  const out = walkDocument(doc, ctx, handlers);
  return {
    body: serializeXml(xml("w:body", undefined, out)),
    diagnostics: ctx.diagnostics.list(),
  };
}

describe("walker — text emission", () => {
  it("emits a single run for unformatted text", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [s.node("paragraph", null, [s.text("hello")])]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: {},
    });
    expect(body).toBe("<w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body>");
  });

  it("sets xml:space=preserve when text has edge whitespace", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [s.node("paragraph", null, [s.text(" hello ")])]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: {},
    });
    expect(body).toContain('<w:t xml:space="preserve"> hello </w:t>');
  });

  it("emits an empty paragraph for paragraphs with no text", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [s.node("paragraph")]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: {},
    });
    expect(body).toBe("<w:body><w:p/></w:body>");
  });
});

describe("walker — mark merging", () => {
  it("merges a single bold mark into one rPr", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [s.text("x", [s.mark("bold")])]),
      ]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: { bold: boldMark },
    });
    expect(body).toBe(
      "<w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>x</w:t></w:r></w:p></w:body>",
    );
  });

  it("merges bold+italic into a single run (never nests w:r)", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [
          s.text("x", [s.mark("bold"), s.mark("italic")]),
        ]),
      ]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: { bold: boldMark, italic: italicMark },
    });
    expect(body).toBe(
      "<w:body><w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>x</w:t></w:r></w:p></w:body>",
    );
    // The output must not contain a nested w:r — invalid OOXML.
    expect(body).not.toMatch(/<w:r>[^<]*<w:r>/);
  });

  it("strips the leading # from color marks before emitting w:color", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [
          s.text("x", [s.mark("color", { color: "#FF0000" })]),
        ]),
      ]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: { color: colorMark },
    });
    expect(body).toContain('<w:color w:val="FF0000"/>');
  });

  it("emits two separate runs for adjacent text with different marks", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [
          s.text("a", [s.mark("bold")]),
          s.text("b", [s.mark("italic")]),
        ]),
      ]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: { bold: boldMark, italic: italicMark },
    });
    expect(body).toBe(
      "<w:body><w:p>" +
        "<w:r><w:rPr><w:b/></w:rPr><w:t>a</w:t></w:r>" +
        "<w:r><w:rPr><w:i/></w:rPr><w:t>b</w:t></w:r>" +
        "</w:p></w:body>",
    );
  });

  it("emits all four standard formatting marks together", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [
          s.text("x", [
            s.mark("bold"),
            s.mark("italic"),
            s.mark("underline"),
            s.mark("strikethrough"),
          ]),
        ]),
      ]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: {
        bold: boldMark,
        italic: italicMark,
        underline: underlineMark,
        strikethrough: strikeMark,
      },
    });
    expect(body).toContain("<w:b/>");
    expect(body).toContain("<w:i/>");
    expect(body).toContain('<w:u w:val="single"/>');
    expect(body).toContain("<w:strike/>");
  });

  it("records a warning when a mark has no registered handler", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [s.text("x", [s.mark("bold")])]),
      ]),
    );
    const { body, diagnostics } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: {}, // no bold registered
    });
    expect(body).toBe("<w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body>");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        level: "warning",
        code: "unsupported-mark",
        markType: "bold",
      }),
    ]);
  });
});

describe("walker — handler composition", () => {
  it("passes child XML to the parent handler", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("heading", { level: 2 }, [s.text("Title")]),
      ]),
    );
    const { body } = walkBody(doc, {
      nodes: { heading: headingHandler },
      marks: {},
    });
    expect(body).toBe(
      "<w:body>" +
        '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>' +
        "<w:r><w:t>Title</w:t></w:r>" +
        "</w:p>" +
        "</w:body>",
    );
  });

  it("threads marks through unhandled inline wrappers (drop preserves text)", () => {
    // Paragraph handler missing — children (the run) bubble up untouched.
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [s.text("x", [s.mark("bold")])]),
      ]),
    );
    const { body, diagnostics } = walkBody(doc, {
      nodes: {},
      marks: { bold: boldMark },
    });
    expect(body).toContain("<w:b/>");
    expect(body).toContain("<w:t>x</w:t>");
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        level: "warning",
        code: "unsupported-node",
        nodeType: "paragraph",
      }),
    );
  });
});

describe("walker — unsupported policy", () => {
  it("'drop' (default) records a warning and bubbles children up", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [s.text("kept")]),
        s.node("heading", { level: 1 }, [s.text("dropped wrapper")]),
      ]),
    );
    const { body, diagnostics } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: {},
    });
    expect(body).toContain("<w:t>kept</w:t>");
    expect(body).toContain("<w:t>dropped wrapper</w:t>");
    expect(diagnostics.some((d) => d.code === "unsupported-node" && d.nodeType === "heading")).toBe(true);
  });

  it("'throw' aborts with DocxExportError carrying diagnostics", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [s.node("heading", { level: 1 }, [s.text("x")])]),
    );
    expect(() =>
      walkBody(doc, { nodes: {}, marks: {} }, { unsupported: "throw" }),
    ).toThrow(DocxExportError);
  });

  it("'placeholder' emits a marker paragraph", () => {
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [s.node("heading", { level: 1 }, [s.text("x")])]),
    );
    const { body } = walkBody(
      doc,
      { nodes: {}, marks: {} },
      { unsupported: "placeholder" },
    );
    expect(body).toContain("[Unsupported Scrivr node: heading]");
  });
});

describe("walker — fontSize unit conversion", () => {
  it("converts pixel fontSize to OOXML half-points (px × 1.5)", () => {
    const fontSizeMark: DocxMarkHandler = (props, mark) => {
      const v = mark.attrs["size"];
      return typeof v === "number" ? { ...props, fontSize: v } : props;
    };
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [
          s.text("x", [s.mark("fontSize", { size: 14 })]),
        ]),
      ]),
    );
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: { fontSize: fontSizeMark },
    });
    // 14px × 1.5 = 21 half-points.
    expect(body).toContain('<w:sz w:val="21"/>');
  });
});

// Type-system sanity — DocxRunProps reserves the future-feature fields but
// the walker must NOT emit <w:ins>/<w:del> wrappers in the base PR.
describe("walker — track-changes fields are reserved-only", () => {
  it("does not wrap runs in w:ins/w:del even if a mark sets trackedInsert", () => {
    const insMark: DocxMarkHandler = (props): DocxRunProps => ({
      ...props,
      trackedInsert: { author: "Alice", date: "2026-01-01T00:00:00Z", id: 1 },
    });
    const editor = new ServerEditor();
    const doc = buildDocFrom(editor, (s) =>
      s.node("doc", null, [
        s.node("paragraph", null, [
          s.text("x", [s.mark("bold")]),
        ]),
      ]),
    );
    // Register a custom "bold" mark handler that sets trackedInsert.
    const { body } = walkBody(doc, {
      nodes: { paragraph: paragraphHandler },
      marks: { bold: insMark },
    });
    expect(body).not.toContain("<w:ins");
    expect(body).not.toContain("<w:del");
  });
});
