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
 * `../report`. Drops by the converter's own fallbacks carry a `null` owner.
 */

import type { Node as PmNode, Mark as PmMark } from "@scrivr/core/pm";
import { layer } from "./styles";
import type {
  DocxBlock,
  DocxDiagnostic,
  DocxImportContext,
  DocxImportModel,
  DocxImports,
  DocxInline,
  DocxMark,
} from "@scrivr/core";
import {
  DECLINED,
  NO_HANDLER,
  entryOf,
  insideDropped,
  noSchemaNode,
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

/**
 * Content the converter itself drops: one warning for the diagnostics and one
 * entry for the report, so neither channel can be forgotten at a drop site.
 * Without a warning it records the drop alone, for kinds whose warnings are
 * silenced but which the inventory still counts.
 */
function dropUnhandled(
  ctx: DocxImportContext,
  recorder: DocxReportRecorder,
  kind: string,
  reason: string,
  warning?: Omit<DocxDiagnostic, "level">,
): void {
  if (warning) ctx.diagnostics.warn(warning);
  recorder.unhandled(kind, reason);
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
    const blockHandler = entryOf(handlers.blocks, "sdt");
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
          dropUnhandled(ctx, recorder, "sdt", NO_HANDLER);
        }
        // Degrade gracefully by returning the unwrapped children.
        return contentNodes;
      },
      // A handler's `null` falls through to the unwrapped children above;
      // only an empty array from it loses them.
      lostUnlessProduced("sdt", owner),
    );
  }

  const blockHandler = entryOf(handlers.blocks, block.type);
  if (blockHandler) {
    const owner = ownerOf(handlers.owners.blocks, block.type);
    // A container — a table, a list — walks its own content from inside the
    // handler, so the subtree covers the handler call.
    return recorder.subtree(
      () => recorder.handle(owner, block.type, () => blockHandler(block, [], ctx), producedNodes),
      lostUnlessProduced(block.type, owner),
    );
  }
  return fallbackBlock(block, ctx, handlers, recorder);
}

function transformParagraph(
  block: DocxBlock & { type: "paragraph" },
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): PmNode | PmNode[] | null {
  const styleId = block.attrs.styleId;
  const dispatch = paragraphHandler(styleId, handlers);

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
    if (!dispatch) return fallbackParagraph(block, content, ctx, recorder);
    return recorder.handle(
      dispatch.owner,
      "paragraph",
      () => dispatch.handler(block, content, ctx),
      producedNodes,
    );
  }, lostUnlessProduced("paragraph", dispatch?.owner ?? null));
}

type ParagraphTransform = (
  block: DocxBlock & { type: "paragraph" },
  content: PmNode[],
  ctx: DocxImportContext,
) => PmNode | PmNode[] | null;

/**
 * Who builds a paragraph: the override for its style when one is registered —
 * the Heading extension claims `Heading1`, `Heading2`, … — otherwise the
 * `paragraph` block handler. `null` leaves it to the converter's fallback.
 */
function paragraphHandler(
  styleId: string | undefined,
  handlers: ResolvedImportHandlers,
): { handler: ParagraphTransform; owner: HandlerOwner } | null {
  if (styleId !== undefined) {
    const override = entryOf(handlers.paragraphStyles, styleId);
    if (override) {
      return { handler: override, owner: ownerOf(handlers.owners.paragraphStyles, styleId) };
    }
  }
  const blockHandler = entryOf(handlers.blocks, "paragraph");
  if (blockHandler) {
    return { handler: blockHandler, owner: ownerOf(handlers.owners.blocks, "paragraph") };
  }
  return null;
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
        // Marked like its run, so a break inside a field stays inside it.
        const marks = transformMarks(layer(inherited, item.marks), ctx, handlers, recorder);
        out.push(hb.create(null, null, marks));
        recorder.carried("hardBreak");
      } else {
        dropUnhandled(ctx, recorder, "hardBreak", noSchemaNode("hardBreak"), {
          code: "schema-missing-hardBreak",
          message: "Schema has no `hardBreak` node — line break dropped",
          nodeType: "hardBreak",
        });
      }
    } else if (item.type === "sdt") {
      out.push(...transformControl(item, inherited, ctx, handlers, recorder));
    } else {
      const node = transformAtom(item, inherited, ctx, handlers, recorder);
      if (node) out.push(node);
    }
  }
  return out;
}

/**
 * An inline content control. The extension that owns its tag builds it; one
 * nobody builds keeps its content, under an `sdt` mark an extension may claim
 * instead. The control is lost only when neither claims it.
 */
function transformControl(
  item: DocxInline & { type: "sdt" },
  inherited: readonly DocxMark[],
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): PmNode[] {
  const handler = entryOf(handlers.inlines, "sdt");
  if (handler) {
    const marks = transformMarks(layer(inherited, item.marks), ctx, handlers, recorder);
    // A `null` is "not my tag": the content below still lands.
    const claimed = recorder.handle(
      ownerOf(handlers.owners.inlines, "sdt"),
      "sdt",
      () => handler(item, marks, ctx),
      built,
      DECLINED,
    );
    if (claimed) return [claimed];
  }

  // Each run under the mark records whether the control crossed with it, so
  // the control itself is recorded here only when no mark can carry it.
  if (!entryOf(handlers.marks, "sdt")) {
    dropUnhandled(ctx, recorder, "sdt", NO_HANDLER);
    // A prompt nobody owns is Word's, not the document's text.
    if (item.placeholder) return [];
    return transformInlines(item.content, ctx, handlers, recorder, layer(inherited, item.marks));
  }
  const control: DocxMark[] = [
    { kind: "sdt", attrs: { tag: item.tag, placeholder: item.placeholder } },
  ];
  if (item.placeholder && transformMarks(control, ctx, handlers, recorder).length === 0) return [];
  return transformInlines(
    item.content,
    ctx,
    handlers,
    recorder,
    layer(inherited, [...item.marks, ...control]),
  );
}

/**
 * An inline an extension builds — an image or a field. Its marks are counted
 * as they are built, so they go with it when it is not built.
 */
function transformAtom(
  item: DocxInline & { type: "image" | "field" },
  inherited: readonly DocxMark[],
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): PmNode | null {
  const marks = layer(inherited, item.marks);
  const handler = entryOf(handlers.inlines, item.type);
  if (!handler) {
    dropUnhandled(
      ctx,
      recorder,
      item.type,
      NO_HANDLER,
      item.type === "image"
        ? {
            code: "image-no-handler",
            message: "No image import handler registered — image dropped",
            nodeType: "image",
          }
        : {
            code: "field-no-handler",
            message: `No import handler for field "${item.instr.trim()}" — dropped`,
          },
    );
    // Its formatting goes with it. Not dispatched: nothing would carry the
    // marks, and a mark nobody claims would add an `unsupported-mark`, which
    // fails an import under `unsupported: "throw"`, though this drop is not fatal.
    for (const mark of marks) {
      if (!mark.off) recorder.unhandled(mark.kind, insideDropped(item.type));
    }
    return null;
  }
  const owner = ownerOf(handlers.owners.inlines, item.type);
  return recorder.subtree(
    () => {
      const pmMarks = transformMarks(marks, ctx, handlers, recorder);
      return recorder.handle(owner, item.type, () => handler(item, pmMarks, ctx), built);
    },
    (node) => (node ? null : { kind: item.type, owner }),
  );
}

/**
 * Marks a wrapping element puts on each run it wraps — a hyperlink, a content
 * control — are one mark object per wrapper. They count once, as one link or
 * one control, however many runs carry them; export counts them the same way.
 */
const WRAPPER_KINDS: ReadonlySet<string> = new Set(["hyperlink", "sdt"]);
const countedWrappers = new WeakSet<DocxMark>();

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
    const handler = entryOf(handlers.marks, mark.kind);
    if (WRAPPER_KINDS.has(mark.kind)) {
      if (countedWrappers.has(mark)) {
        const repeated = handler?.(mark, ctx);
        if (repeated) out.push(repeated);
        continue;
      }
      countedWrappers.add(mark);
    }
    if (!handler) {
      // Reserved kinds we don't map yet (like spacing, kern, lang) flood
      // diagnostics noisily, so their warning is silenced. They are still
      // counted: the report is the inventory, and a property nobody reads is
      // still a property dropped.
      dropUnhandled(
        ctx,
        recorder,
        mark.kind,
        NO_HANDLER,
        NOISY_RPR_KINDS.has(mark.kind)
          ? undefined
          : {
              code: "unsupported-mark",
              message: `No import handler for OOXML run-property "${mark.kind}"`,
              markType: mark.kind,
            },
      );
      continue;
    }
    // A handler that returns nothing for a value Word uses to mean "no
    // formatting" — `w:color="auto"` — reports the property kept itself, so
    // what is recorded here as dropped is formatting that did not cross.
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
    dropUnhandled(ctx, recorder, "paragraph", noSchemaNode("paragraph"), {
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
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): PmNode | null {
  const hasFallback = block.type === "horizontalRule" || block.type === "pageBreak";
  if (hasFallback) {
    const type = ctx.schema.nodes[block.type];
    if (type) {
      const node = type.create();
      recorder.carried(block.type);
      return node;
    }
  }
  dropUnhandled(ctx, recorder, block.type, hasFallback ? noSchemaNode(block.type) : NO_HANDLER, {
    code: "unsupported-block",
    message: `No import handler (and no fallback) for block kind "${block.type}"`,
  });
  // What the block held is lost with it, so it is counted as dropped inside it.
  recorder.subtree(
    () => innerBlocks(block).forEach((inner) => transformBlock(inner, ctx, handlers, recorder)),
    () => ({ kind: block.type, owner: null }),
  );
  return null;
}

/** The blocks a container holds: a table's cells', a list's items', a content control's. */
function innerBlocks(block: DocxBlock): DocxBlock[] {
  switch (block.type) {
    case "table":
      return block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.content));
    case "list":
      return block.items.flatMap((item) => item.content);
    case "sdt":
      return block.content;
    default:
      return [];
  }
}
