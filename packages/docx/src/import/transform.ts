/**
 * Stage 2: transform the normalized `DocxImportModel` into a ProseMirror
 * `Node` using the editor's schema. Dispatch via extension contributions
 * from `editor.getImportContributions()` plus per-call overrides.
 *
 * Handlers return real `Node` / `Mark` instances — no invented JSON shape
 * to drift from ProseMirror.
 *
 * Dispatch lanes:
 *   - `blocks[block.type]` — claim a `DocxBlock` kind (paragraph,
 *     horizontalRule, …)
 *   - `paragraphStyles[styleId]` — override the paragraph transform when
 *     the paragraph has a matching `pStyle` (Heading1 → heading node)
 *   - `marks[mark.kind]` — claim a `DocxMark` kind (b, i, color, …)
 *
 * Universal fallbacks (paragraph, horizontalRule, pageBreak) live here so
 * a schema with the bare StarterKit nodes works without per-extension
 * import registration.
 */

import type { Node as PmNode, Mark as PmMark } from "prosemirror-model";
import type {
  DocxBlock,
  DocxImportContext,
  DocxImportModel,
  DocxImports,
  DocxInline,
  DocxMark,
} from "@scrivr/core";

export interface ResolvedImportHandlers {
  blocks: Record<string, NonNullable<DocxImports["blocks"]>[string]>;
  paragraphStyles: Record<
    string,
    NonNullable<DocxImports["paragraphStyles"]>[string]
  >;
  marks: Record<string, NonNullable<DocxImports["marks"]>[string]>;
}

export function transformToProseMirror(
  model: DocxImportModel,
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
): PmNode {
  const blocks: PmNode[] = [];
  for (const block of model.blocks) {
    const node = transformBlock(block, ctx, handlers);
    if (node) blocks.push(node);
  }
  // Schemas typically require at least one block child in `doc`.
  if (blocks.length === 0) {
    const para = ctx.schema.nodes["paragraph"];
    if (para) blocks.push(para.create());
  }
  return ctx.schema.topNodeType.create(null, blocks);
}

function transformBlock(
  block: DocxBlock,
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
): PmNode | null {
  // Paragraph-style override fires first — Heading extension claims
  // `Heading1` / `Heading2` / etc. before the default paragraph transform.
  if (block.type === "paragraph") {
    const content = transformInlines(block.content, ctx, handlers);
    const styleId = block.attrs.styleId;
    if (styleId) {
      const override = handlers.paragraphStyles[styleId];
      if (override) return override(block, content, ctx);
    }
    const blockHandler = handlers.blocks["paragraph"];
    if (blockHandler) return blockHandler(block, content, ctx);
    return fallbackParagraph(block, content, ctx);
  }

  const blockHandler = handlers.blocks[block.type];
  if (blockHandler) return blockHandler(block, [], ctx);
  return fallbackBlock(block, ctx);
}

function transformInlines(
  inlines: DocxInline[],
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
): PmNode[] {
  const out: PmNode[] = [];
  for (const item of inlines) {
    if (item.type === "text") {
      if (item.text.length === 0) continue;
      const marks = transformMarks(item.marks, ctx, handlers);
      out.push(ctx.schema.text(item.text, marks.length > 0 ? marks : undefined));
    } else if (item.type === "hardBreak") {
      const hb = ctx.schema.nodes["hardBreak"];
      if (hb) {
        out.push(hb.create());
      } else {
        ctx.diagnostics.warn({
          code: "schema-missing-hardBreak",
          message: "Schema has no `hardBreak` node — line break dropped",
          nodeType: "hardBreak",
        });
      }
    } else if (item.type === "image") {
      // Image extension claims via blocks dispatch in the image milestone.
      ctx.diagnostics.warn({
        code: "image-import-pending",
        message: "Inline image import lands with the image milestone",
        nodeType: "image",
      });
    }
  }
  return out;
}

function transformMarks(
  marks: DocxMark[],
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
): PmMark[] {
  const out: PmMark[] = [];
  for (const mark of marks) {
    const handler = handlers.marks[mark.kind];
    if (!handler) {
      // Unknown mark kind — drop with diagnostic. Reserved kinds we don't
      // map yet (like spacing, kern, lang) flood diagnostics noisily; skip
      // the warning for them. The well-known kinds we *do* expect callers
      // to claim are formatting marks (b, i, u, strike, color, highlight,
      // shd, sz, rFonts).
      if (NOISY_RPR_KINDS.has(mark.kind)) continue;
      ctx.diagnostics.warn({
        code: "unsupported-mark",
        message: `No import handler for OOXML run-property "${mark.kind}"`,
        markType: mark.kind,
      });
      continue;
    }
    const result = handler(mark, ctx);
    if (result) out.push(result);
  }
  return out;
}

// rPr children that almost never need to round-trip — silenced so the
// diagnostic stream stays useful. Extensions that want any of these
// register handlers and override the silence.
const NOISY_RPR_KINDS = new Set([
  "lang",
  "noProof",
  "spacing",
  "kern",
  "position",
  "snapToGrid",
  "vertAlign",
  "w",
  "webHidden",
]);

// ── Universal fallbacks ─────────────────────────────────────────────────────

function fallbackParagraph(
  block: DocxBlock & { type: "paragraph" },
  content: PmNode[],
  ctx: DocxImportContext,
): PmNode | null {
  const paragraph = ctx.schema.nodes["paragraph"];
  if (!paragraph) {
    ctx.diagnostics.warn({
      code: "schema-missing-paragraph",
      message: "Schema has no `paragraph` node — block dropped",
      nodeType: "paragraph",
    });
    return null;
  }
  const attrs: Record<string, unknown> = {};
  if (block.attrs.align && "align" in (paragraph.spec.attrs ?? {})) {
    attrs.align = block.attrs.align;
  }
  return paragraph.create(
    Object.keys(attrs).length > 0 ? attrs : null,
    content,
  );
}

function fallbackBlock(
  block: DocxBlock,
  ctx: DocxImportContext,
): PmNode | null {
  if (block.type === "horizontalRule") {
    const hr = ctx.schema.nodes["horizontalRule"];
    if (hr) return hr.create();
  }
  if (block.type === "pageBreak") {
    const pb = ctx.schema.nodes["pageBreak"];
    if (pb) return pb.create();
  }
  ctx.diagnostics.warn({
    code: "unsupported-block",
    message: `No import handler (and no fallback) for block kind "${block.type}"`,
  });
  return null;
}
