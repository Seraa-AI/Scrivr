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
import { isIgnored } from "./ignored";
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
  NOT_MINE,
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
  // Links a walk left pending belong to that walk: one that threw leaves none for this one.
  unlanded.length = 0;
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
    const styleMarks = ctx.styles.runMarks(styleId);
    const content = transformInlines(block.content, ctx, handlers, recorder, styleMarks);
    settleUnlanded(recorder);
    if (!dispatch) return fallbackParagraph(block, content, ctx, recorder);
    const result = recorder.handle(
      dispatch.owner,
      "paragraph",
      () => dispatch.handler(block, content, ctx),
      producedNodes,
    );
    chargeLeftOut(content, result, styleMarks, dispatch.owner, recorder);
    return result;
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
      const { marks, sources } = transformMarks(layer(inherited, item.marks), ctx, handlers, recorder);
      const text = ctx.schema.text(item.text, marks.length > 0 ? marks : undefined);
      builtInlines.set(text, { sources });
      out.push(text);
      recorder.carried("text");
    } else if (item.type === "hardBreak") {
      const hb = ctx.schema.nodes["hardBreak"];
      if (hb) {
        // Marked like its run, so a break inside a field stays inside it.
        const { marks, sources } = transformMarks(layer(inherited, item.marks), ctx, handlers, recorder);
        const hardBreak = hb.create(null, null, marks);
        builtInlines.set(hardBreak, { sources });
        out.push(hardBreak);
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
    const { marks, sources } = transformMarks(layer(inherited, item.marks), ctx, handlers, recorder);
    // A `null` is "not my tag": the content below still lands.
    const claimed = recorder.handle(
      ownerOf(handlers.owners.inlines, "sdt"),
      "sdt",
      () => handler(item, marks, ctx),
      built,
      NOT_MINE,
    );
    if (claimed) {
      builtInlines.set(claimed, { sources, atom: "sdt" });
      return [claimed];
    }
  }

  // The control's mark is counted once, on the first run under it, so the
  // control itself is recorded here only when no mark can carry it.
  if (!entryOf(handlers.marks, "sdt")) {
    dropUnhandled(ctx, recorder, "sdt", NO_HANDLER);
    // A prompt nobody owns is Word's, not the document's text.
    if (item.placeholder) return [];
    return transformInlines(item.content, ctx, handlers, recorder, layer(inherited, item.marks));
  }
  const control: DocxMark[] = [
    { kind: "sdt", attrs: { tag: item.tag, placeholder: item.placeholder } },
  ];
  if (item.placeholder && transformMarks(control, ctx, handlers, recorder).marks.length === 0) return [];
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
  // A link over the atom is counted where it lands, not here: the atom only
  // records its outcome when it lands, and otherwise leaves it to the runs.
  const wrappers = marks.filter((mark) => WRAPPER_KINDS.has(mark.kind) && !mark.off);
  const formatting = marks.filter((mark) => !WRAPPER_KINDS.has(mark.kind));
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
    for (const mark of formatting) {
      if (!mark.off) recorder.unhandled(mark.kind, insideDropped(item.type));
    }
    wrappers.forEach((mark) => unlanded.push({ mark, atom: item.type }));
    return null;
  }
  const owner = ownerOf(handlers.owners.inlines, item.type);
  let sources: MarkSource[] = [];
  const node = recorder.subtree(
    () => {
      const formattingMarks = transformMarks(formatting, ctx, handlers, recorder);
      const pmMarks = formattingMarks.marks;
      sources = formattingMarks.sources;
      for (const mark of wrappers) {
        const wrapper = buildWrapper(mark, ctx, handlers, recorder).mark;
        if (wrapper) {
          pmMarks.push(wrapper);
          sources.push({ docx: mark, pm: wrapper });
        }
      }
      return recorder.handle(owner, item.type, () => handler(item, pmMarks, ctx), built);
    },
    (atom) => (atom ? null : { kind: item.type, owner }),
  );
  if (node) builtInlines.set(node, { sources, atom: item.type });
  for (const mark of wrappers) {
    if (!node) unlanded.push({ mark, atom: item.type });
    else if (!countedWrappers.has(mark)) {
      countedWrappers.add(mark);
      const { mark: wrapper, outcomeRecorded } = builtWrappers.get(mark) ?? { mark: null, outcomeRecorded: false };
      if (!entryOf(handlers.marks, mark.kind)) dropUnhandled(ctx, recorder, mark.kind, NO_HANDLER);
      else if (wrapper || !outcomeRecorded) recorder.handle(ownerOf(handlers.owners.marks, mark.kind), mark.kind, () => wrapper, built);
    }
  }
  return node;
}

/** What a wrapper's handler built for it, and whether its outcome is already in the report. */
interface BuiltWrapper {
  mark: PmMark | null;
  outcomeRecorded: boolean;
}
const builtWrappers = new WeakMap<DocxMark, BuiltWrapper>();

/**
 * A wrapper's handler runs once per wrapper, however many runs carry it, so
 * what it reports — a link it cannot resolve — is reported once.
 */
function buildWrapper(
  mark: DocxMark,
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): BuiltWrapper {
  const cached = builtWrappers.get(mark);
  if (cached) return cached;
  const handler = entryOf(handlers.marks, mark.kind);
  const droppedBefore = recorder.count(mark.kind).dropped;
  const built = handler ? recorder.fileUnder(ownerOf(handlers.owners.marks, mark.kind), () => handler(mark, ctx)) : null;
  const result = { mark: built, outcomeRecorded: recorder.count(mark.kind).dropped > droppedBefore };
  builtWrappers.set(mark, result);
  return result;
}

/**
 * Links lost with every atom they covered, waiting for the end of their
 * paragraph: one that lands on a run there is counted kept, one that never
 * does is counted dropped once.
 */
const unlanded: Array<{ mark: DocxMark; atom: string }> = [];

function settleUnlanded(recorder: DocxReportRecorder): void {
  for (const { mark, atom } of unlanded.splice(0)) {
    if (countedWrappers.has(mark)) continue;
    countedWrappers.add(mark);
    // A wrapper whose handler already reported it dropped is not lost a second time.
    if (builtWrappers.get(mark)?.outcomeRecorded) continue;
    recorder.unhandled(mark.kind, insideDropped(atom));
  }
}

/**
 * Marks a wrapping element puts on each run it wraps — a hyperlink, a content
 * control — are one mark object per wrapper. They count once where they land,
 * as one link or one control, however many runs carry them.
 */
const WRAPPER_KINDS: ReadonlySet<string> = new Set(["hyperlink", "sdt"]);
const countedWrappers = new WeakSet<DocxMark>();

/** The marks built for a run, and the Word mark behind each. */
interface BuiltMarks {
  marks: PmMark[];
  sources: MarkSource[];
}

function transformMarks(
  marks: readonly DocxMark[],
  ctx: DocxImportContext,
  handlers: ResolvedImportHandlers,
  recorder: DocxReportRecorder,
): BuiltMarks {
  const out: PmMark[] = [];
  const sources: MarkSource[] = [];
  const push = (docx: DocxMark, pm: PmMark) => {
    out.push(pm);
    sources.push({ docx, pm });
  };
  for (const mark of marks) {
    // The run refused this formatting. It has already outranked whatever the
    // style offered; there is nothing left to draw.
    if (mark.off) continue;
    const handler = entryOf(handlers.marks, mark.kind);
    if (WRAPPER_KINDS.has(mark.kind)) {
      if (countedWrappers.has(mark)) {
        const repeated = builtWrappers.get(mark)?.mark;
        if (repeated) push(mark, repeated);
        continue;
      }
      countedWrappers.add(mark);
      const prebuilt = builtWrappers.get(mark);
      if (prebuilt) {
        // Built over an atom that was lost; this run is where it lands.
        if (prebuilt.mark) {
          recorder.handle(ownerOf(handlers.owners.marks, mark.kind), mark.kind, () => prebuilt.mark, built);
          push(mark, prebuilt.mark);
        } else if (!prebuilt.outcomeRecorded) {
          recorder.handle(ownerOf(handlers.owners.marks, mark.kind), mark.kind, () => null, built);
        }
        continue;
      }
    }
    if (!handler) {
      // A property dropped on purpose raises no warning. It is still counted:
      // the report is the inventory, and a property nobody reads is still a
      // property dropped.
      dropUnhandled(
        ctx,
        recorder,
        mark.kind,
        NO_HANDLER,
        isIgnored("w:rPr", `w:${mark.kind}`)
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
    // Later runs under the same wrapper reuse this, without asking the handler again.
    if (WRAPPER_KINDS.has(mark.kind)) builtWrappers.set(mark, { mark: result, outcomeRecorded: true });
    if (result) push(mark, result);
  }
  return { marks: out, sources };
}

/** The Word mark that built a piece of formatting, so a handler that leaves it out can be charged for it. */
interface MarkSource {
  docx: DocxMark;
  pm: PmMark;
}
/**
 * Each inline node the converter built: the Word marks behind its formatting,
 * and, for an object an extension built (an image, a field, a content
 * control), the Word kind it was counted as.
 */
const builtInlines = new WeakMap<PmNode, { sources: MarkSource[]; atom?: string }>();

/**
 * A paragraph handler hands back a node built from `content`. Formatting and
 * inline objects in `content` that the node does not carry — a code block
 * keeping only text — were counted kept as they were built, so they move to
 * dropped under the handler. Formatting is compared by how much text carries
 * it, which joining or copying text nodes does not change; the paragraph
 * style's own formatting is what the node stands for, so it is never charged.
 */
function chargeLeftOut(
  content: readonly PmNode[],
  result: PmNode | PmNode[] | null,
  styleMarks: readonly DocxMark[],
  owner: HandlerOwner,
  recorder: DocxReportRecorder,
): void {
  if (!result || !producedNodes(result)) return;
  // An object is counted by the Word kind it was built from; a line break is
  // not one, since a handler can keep it as a newline.
  const atomKinds = new Map<string, string>();
  for (const node of content) {
    const atom = builtInlines.get(node)?.atom;
    if (atom) atomKinds.set(node.type.name, atom);
  }
  const weight = (node: PmNode) => (node.isText ? (node.text ?? "").length : 1);
  const tally = (nodes: readonly PmNode[]) => {
    const marks = new Map<string, number>();
    const atoms = new Map<string, number>();
    const visit = (node: PmNode) => {
      node.marks.forEach((mark) => marks.set(mark.type.name, (marks.get(mark.type.name) ?? 0) + weight(node)));
      const atom = atomKinds.get(node.type.name);
      if (atom) atoms.set(atom, (atoms.get(atom) ?? 0) + 1);
    };
    for (const node of nodes) {
      visit(node);
      node.descendants((child) => void visit(child));
    }
    return { marks, atoms };
  };
  const given = tally(content);
  const kept = tally(Array.isArray(result) ? result : [result]);
  const fromStyle = new Set(styleMarks);
  const charged = new Set<DocxMark>();
  for (const [type, amount] of given.marks) {
    let missing = amount - (kept.marks.get(type) ?? 0);
    for (const node of content) {
      for (const { docx, pm } of builtInlines.get(node)?.sources ?? []) {
        if (missing <= 0 || pm.type.name !== type) continue;
        // The style's own formatting accounts for its share of what is missing, uncharged.
        missing -= weight(node);
        if (charged.has(docx) || fromStyle.has(docx)) continue;
        charged.add(docx);
        recorder.leftOut(docx.kind, owner);
      }
    }
  }
  for (const [type, count] of given.atoms) {
    for (let i = count - (kept.atoms.get(type) ?? 0); i > 0; i--) recorder.leftOut(type, owner);
  }
}

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
  countLost(innerBlocks(block), insideDropped(block.type), ctx, recorder);
  return null;
}

/**
 * What a lost block held, counted as dropped with it. Only counted: a handler
 * run on content that is then thrown away could still leave something behind
 * — a field's answer, a resolved image — for content that is not in the
 * document. It counts what the walk would have: a paragraph's runs under its
 * style's formatting, no empty text, no content control's prompt.
 */
function countLost(
  blocks: readonly DocxBlock[],
  reason: string,
  ctx: DocxImportContext,
  recorder: DocxReportRecorder,
): void {
  const countMarks = (marks: readonly DocxMark[]) => {
    for (const mark of marks) {
      if (mark.off || countedWrappers.has(mark)) continue;
      if (WRAPPER_KINDS.has(mark.kind)) countedWrappers.add(mark);
      recorder.unhandled(mark.kind, reason);
    }
  };
  const countInlines = (inlines: readonly DocxInline[], inherited: readonly DocxMark[]): void => {
    for (const inline of inlines) {
      if (inline.type === "text" && inline.text.length === 0) continue;
      recorder.unhandled(inline.type, reason);
      if (inline.type === "sdt") {
        if (!inline.placeholder) countInlines(inline.content, layer(inherited, inline.marks));
        continue;
      }
      countMarks(layer(inherited, inline.marks));
    }
  };
  for (const block of blocks) {
    if (block.type === "paragraph") {
      recorder.unhandled("paragraph", reason);
      countInlines(block.content, ctx.styles.runMarks(block.attrs.styleId));
    } else {
      recorder.unhandled(block.type, reason);
      countLost(innerBlocks(block), reason, ctx, recorder);
    }
  }
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
