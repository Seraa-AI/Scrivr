import { describe, it, expect } from "vitest";
// Imported through the package barrel on purpose: these are the types a
// consumer writes a DOCX import handler against, and `tsc` fails here the
// moment one stops being exported.
import type {
  DocxBlock,
  DocxBlockTransform,
  DocxImportContext,
  DocxImports,
  DocxMark,
  DocxMarkTransform,
} from "../index";

describe("the DOCX import contract a consumer writes against", () => {
  it("is enough to author a container handler", () => {
    // A handler that owns a container reads its children through the context
    // rather than re-deriving what a paragraph is.
    const handler: DocxBlockTransform = (block, _content, ctx: DocxImportContext) => {
      if (block.type !== "sdt") return null;
      const nested: readonly DocxBlock[] = block.content;
      const children = ctx.walkBlocks(nested);
      return children.length > 0 ? children : null;
    };

    const contribution: DocxImports = { blocks: { sdt: handler } };
    expect(contribution.blocks?.["sdt"]).toBe(handler);
  });

  it("is enough to author a mark handler that resolves a relationship", () => {
    // The shape `Link` uses: a run property whose real target lives in the
    // part's rels rather than in the mark itself.
    const handler: DocxMarkTransform = (mark: DocxMark, ctx: DocxImportContext) => {
      const relId = mark.attrs?.["relId"];
      const target =
        typeof relId === "string" ? ctx.rels.resolveHyperlink(relId) : undefined;
      const type = ctx.schema.marks["link"];
      return target !== undefined && type ? type.create({ href: target }) : null;
    };

    const contribution: DocxImports = { marks: { hyperlink: handler } };
    expect(contribution.marks?.["hyperlink"]).toBe(handler);
  });
});
