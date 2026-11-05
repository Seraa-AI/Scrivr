/**
 * Stage 2: transform the normalized `DocxImportModel` into a ProseMirror
 * `Node` using the editor's schema. Dispatch via extension contributions
 * from `editor.getFormatContributions()` plus per-call overrides.
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
 *
 * Every block, inline and mark this stage meets is recorded in the report as
 * kept or dropped, attributed to the extension whose handler took it — see
 * `../report`. Fallback output is recorded with a `null` owner.
 */

import type { Node as PmNode, Mark as PmMark } from "@scrivr/core/pm";
import { layer } from "./styles";
import type {
  DocxBlock,
  DocxImportContext,
  DocxImportModel,
  DocxImports,
  DocxInline,
  DocxMark,
} from "@scrivr/core";
import {
  NO_HANDLER,
  ownerOf,
  reportRecorderOf,
  type DocxReportRecorder,
  type HandlerOwner,
  type LostItem,
} from "../report";

export interface ResolvedImportHandlers {
  blocks: Record<string, NonNullable<DocxImports["blocks"]>[string]>;
  paragraphStyles: Record<
    string,
    NonNullable<DocxImports["paragraphStyles"]>[string]
  >;
  marks: Record<string, NonNullable<DocxImports["marks"]>[string]>;
  inlines: Record<string, NonNullable<DocxImports["inlines"]>[string]>;
  /** Who contributed each handler above, by the same keys. */
  owners: {
    blocks: Record<string, HandlerOwner>;
    paragraphStyles: Record<string, HandlerOwner>;
    marks: Record<string, HandlerOwner>;
    inlines: Record<string, HandlerOwner>;
  };
}

export function transformToProseMirror(
  model: DocxImportModel,
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
): PmNode {
  const blocks = [...ctx.walkBlocks(model.blocks)];
  // Schemas typically require at least one block child in `doc`.
  if (blocks.length === 0) {
    const para = ctx.schema.nodes["paragraph"];
    if (para) blocks.push(para.create());
  }
  return ctx.schema.topNodeType.create(null, blocks);
}

/**
 * The recursion a contribution reaches through `ctx.walkBlocks`. It lives here
 * because it has to re-enter this module's dispatch, and `importDocx` installs
 * it as soon as the handler set exists — before the lifecycle hooks, so a
 * contribution can walk blocks from `onBeforeImport` like it can `walkPart`.
 */
export function createBlockWalker(
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
): (blocks: readonly DocxBlock[]) => PmNode[] {
  const recorder = reportRecorderOf(ctx);
  return (blocks) =>
    blocks.flatMap((block) => asNodes(transformBlock(block, ctx, handlers, recorder)));
}

function asNodes(result: PmNode | PmNode[] | null): PmNode[] {
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

/** A block handler's result put something in the document. */
function producedNodes(result: PmNode | PmNode[] | null): boolean {
  return asNodes(result).length > 0;
}

/** An inline or mark handler built something — what dispatch keeps. */
function built(result: PmNode | PmMark | null): boolean {
  return Boolean(result);
}

/** The item a subtree held, when its result put nothing in the document. */
function lostUnlessProduced(
  kind: string,
  owner: HandlerOwner,
): (result: PmNode | PmNode[] | null) => LostItem | null {
  return (result) => (producedNodes(result) ? null : { kind, owner });
}

function transformBlock(
  block: DocxBlock,
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): PmNode | PmNode[] | null {
  if (block.type === "paragraph") {
    return transformParagraph(block, ctx, handlers, recorder);
  }

  if (block.type === "sdt") {
    const blockHandler = handlers.blocks["sdt"];
    const owner = ownerOf(handlers.owners.blocks, "sdt");
    return recorder.subtree(
      () => {
        const contentNodes = ctx.walkBlocks(block.content);
        if (blockHandler) {
          const handled = recorder.handle(
            owner,
            "sdt",
            () => blockHandler(block, contentNodes, ctx),
            producedNodes,
          );
          if (handled) return handled;
        } else {
          recorder.unhandled("sdt", NO_HANDLER);
        }
        // Degrade gracefully by returning the unwrapped children.
        return contentNodes;
      },
      // A handler's `null` falls through to the unwrapped children above;
      // only an empty array from it loses them.
      lostUnlessProduced("sdt", owner),
    );
  }

  const blockHandler = handlers.blocks[block.type];
  if (blockHandler) {
    const owner = ownerOf(handlers.owners.blocks, block.type);
    // A container — a table, a list — walks its own content from inside the
    // handler, so the subtree covers the handler call.
    return recorder.subtree(
      () => recorder.handle(owner, block.type, () => blockHandler(block, [], ctx), producedNodes),
      lostUnlessProduced(block.type, owner),
    );
  }
  return fallbackBlock(block, ctx, recorder);
}

function transformParagraph(
  block: DocxBlock & { type: "paragraph" },
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): PmNode | PmNode[] | null {
  const styleId = block.attrs.styleId;
  // Paragraph-style override fires first — Heading extension claims
  // `Heading1` / `Heading2` / etc. before the default paragraph transform.
  const override = styleId ? handlers.paragraphStyles[styleId] : undefined;
  const blockHandler = handlers.blocks["paragraph"];
  const owner =
    styleId && override
      ? ownerOf(handlers.owners.paragraphStyles, styleId)
      : blockHandler
        ? ownerOf(handlers.owners.blocks, "paragraph")
        : null;

  // The runs are counted as they are built, before the paragraph's handler
  // has decided; a paragraph that comes back empty takes them with it.
  return recorder.subtree(() => {
    // The paragraph's style is what its runs inherit. Resolved here rather
    // than in the parser, because a style chain is a document-wide question
    // and the parser reads one element at a time.
    const content = transformInlines(
      block.content,
      ctx,
      handlers,
      recorder,
      ctx.styles.runMarks(styleId),
    );
    if (override) {
      return recorder.handle(owner, "paragraph", () => override(block, content, ctx), producedNodes);
    }
    if (blockHandler) {
      return recorder.handle(owner, "paragraph", () => blockHandler(block, content, ctx), producedNodes);
    }
    return fallbackParagraph(block, content, ctx, recorder);
  }, lostUnlessProduced("paragraph", owner));
}

function transformInlines(
  inlines: DocxInline[],
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
  inherited: readonly DocxMark[] = [],
): PmNode[] {
  const out: PmNode[] = [];
  for (const item of inlines) {
    if (item.type === "text") {
      if (item.text.length === 0) continue;
      const marks = transformMarks(layer(inherited, item.marks), ctx, handlers, recorder);
      out.push(ctx.schema.text(item.text, marks.length > 0 ? marks : undefined));
      recorder.carried("text");
    } else if (item.type === "hardBreak") {
      const hb = ctx.schema.nodes["hardBreak"];
      if (hb) {
        out.push(hb.create());
        recorder.carried("hardBreak");
      } else {
        ctx.diagnostics.warn({
          code: "schema-missing-hardBreak",
          message: "Schema has no `hardBreak` node — line break dropped",
          nodeType: "hardBreak",
        });
        recorder.unhandled("hardBreak", "the schema has no hardBreak node");
      }
    } else {
      const node = transformAtom(item, inherited, ctx, handlers, recorder);
      if (node) out.push(node);
    }
  }
  return out;
}

/**
 * An inline an extension builds — an image or a field. Its marks are counted
 * as they are built, so they go with it when the handler builds nothing.
 */
function transformAtom(
  item: DocxInline & { type: "image" | "field" },
  inherited: readonly DocxMark[],
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): PmNode | null {
  const handler = handlers.inlines[item.type];
  if (!handler) {
    if (item.type === "image") {
      ctx.diagnostics.warn({
        code: "image-no-handler",
        message: "No image import handler registered — image dropped",
        nodeType: "image",
      });
    } else {
      ctx.diagnostics.warn({
        code: "field-no-handler",
        message: `No import handler for field "${item.instr.trim()}" — dropped`,
      });
    }
    recorder.unhandled(item.type, NO_HANDLER);
    return null;
  }
  const owner = ownerOf(handlers.owners.inlines, item.type);
  return recorder.subtree(
    () => {
      const marks = transformMarks(layer(inherited, item.marks), ctx, handlers, recorder);
      return recorder.handle(owner, item.type, () => handler(item, marks, ctx), built);
    },
    (node) => (node ? null : { kind: item.type, owner }),
  );
}

function transformMarks(
  marks: readonly DocxMark[],
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): PmMark[] {
  const out: PmMark[] = [];
  for (const mark of marks) {
    // The run refused this formatting. It has already outranked whatever the
    // style offered; there is nothing left to draw.
    if (mark.off) continue;
    const handler = handlers.marks[mark.kind];
    if (!handler) {
      // Counted even when the warning below is silenced: the report is the
      // inventory, and a property nobody reads is still a property dropped.
      recorder.unhandled(mark.kind, NO_HANDLER);
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
    const result = recorder.handle(
      ownerOf(handlers.owners.marks, mark.kind),
      mark.kind,
      () => handler(mark, ctx),
      built,
    );
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
  recorder: DocxReportRecorder,
): PmNode | null {
  const paragraph = ctx.schema.nodes["paragraph"];
  if (!paragraph) {
    ctx.diagnostics.warn({
      code: "schema-missing-paragraph",
      message: "Schema has no `paragraph` node — block dropped",
      nodeType: "paragraph",
    });
    recorder.unhandled("paragraph", "the schema has no paragraph node");
    return null;
  }
  const attrs: Record<string, unknown> = {};
  if (block.attrs.align && "align" in (paragraph.spec.attrs ?? {})) {
    attrs.align = block.attrs.align;
  }
  const paragraphNode = paragraph.create(
    Object.keys(attrs).length > 0 ? attrs : null,
    content,
  );
  recorder.carried("paragraph");
  return paragraphNode;
}

function fallbackBlock(
  block: DocxBlock,
  ctx: DocxImportContext,
  recorder: DocxReportRecorder,
): PmNode | null {
  if (block.type === "horizontalRule") {
    const hr = ctx.schema.nodes["horizontalRule"];
    if (hr) {
      const rule = hr.create();
      recorder.carried("horizontalRule");
      return rule;
    }
  }
  if (block.type === "pageBreak") {
    const pb = ctx.schema.nodes["pageBreak"];
    if (pb) {
      const pageBreak = pb.create();
      recorder.carried("pageBreak");
      return pageBreak;
    }
  }
  ctx.diagnostics.warn({
    code: "unsupported-block",
    message: `No import handler (and no fallback) for block kind "${block.type}"`,
  });
  recorder.unhandled(block.type, NO_HANDLER);
  return null;
}
