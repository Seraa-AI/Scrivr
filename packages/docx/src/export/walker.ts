/**
 * Tree walker — composes child XML, dispatches node handlers, merges marks
 * into a run-property bag, and emits OOXML runs for text.
 *
 * The walker owns recursion. Handlers receive their children already walked
 * so they only have to wrap or position the result. Marks NEVER nest runs —
 * they accumulate as `DocxRunProps` and the walker emits one `<w:r>` per
 * text node with the merged properties.
 *
 * Unknown node types are resolved through `ctx.options.unsupported`:
 *   "drop"        → warning + bubble children up
 *   "placeholder" → warning + emit `[Unsupported Scrivr node: <type>]`
 *   "throw"       → abort with DocxExportError
 *
 * A mark with neither a property handler nor a wrapper records a warning; the
 * run is still emitted (the unknown mark is silently absent).
 *
 * The walker also keeps the report's count. Every node, mark and text run it
 * meets is recorded as kept or dropped, each handler call is attributed to the
 * extension that contributed it, and a node's content is moved to dropped when
 * the node is lost — see `../report`.
 */

import type { Node, Mark } from "@scrivr/core/pm";
import { cssColorToDocxHex } from "@scrivr/core";
import { xml } from "./xml";
import type { XmlNode, DocxContext } from "./context";
import type {
  DocxNodeHandler,
  DocxMarkHandler,
  DocxRunWrapper,
  DocxNodeMeta,
  DocxRunProps,
} from "./handlers";
import { DocxExportError } from "./error";
import {
  NO_HANDLER,
  WRAPPER_DECLINED,
  ownerOf,
  reportRecorderOf,
  type DocxReportRecorder,
  type HandlerOwner,
  type LostItem,
} from "../report";

export interface WalkerHandlers {
  nodes: Record<string, DocxNodeHandler>;
  marks: Record<string, DocxMarkHandler>;
  /** Marks that wrap their runs — hyperlinks. See `DocxRunWrapper`. */
  markWrappers?: Record<string, DocxRunWrapper>;
  /**
   * Who contributed each handler, keyed like the tables above, so the report
   * can say which extension kept or dropped what. A handler with no entry is
   * reported with a `null` owner.
   */
  owners?: WalkerHandlerOwners;
}

/** The contributing extension of each handler in `WalkerHandlers`, by the same keys. */
export interface WalkerHandlerOwners {
  nodes?: Record<string, HandlerOwner>;
  marks?: Record<string, HandlerOwner>;
  markWrappers?: Record<string, HandlerOwner>;
}

/** Walk the body of a document — skips the implicit root and returns body content. */
export function walkDocument(
  doc: Node,
  ctx: DocxContext,
  handlers: WalkerHandlers,
): XmlNode[] {
  const recorder = reportRecorderOf(ctx);
  const out: XmlNode[] = [];
  doc.forEach((child) => {
    const meta: DocxNodeMeta = { inline: child.isInline };
    out.push(...walk(child, ctx, handlers, meta, recorder));
  });
  return out;
}

export function walkNode(
  node: Node,
  ctx: DocxContext,
  handlers: WalkerHandlers,
  meta: DocxNodeMeta,
): XmlNode[] {
  return walk(node, ctx, handlers, meta, reportRecorderOf(ctx));
}

function walk(
  node: Node,
  ctx: DocxContext,
  handlers: WalkerHandlers,
  meta: DocxNodeMeta,
  recorder: DocxReportRecorder,
): XmlNode[] {
  // Text nodes own their mark stack — emit a single <w:r> with merged props,
  // then let any wrapping marks (hyperlinks) enclose it.
  if (node.isText) {
    recorder.carried("text");
    const run = renderRun(node.text ?? "", mergeMarks(node.marks, ctx, handlers, recorder));
    return [wrapRun(run, node.marks, ctx, handlers, recorder)];
  }

  const type = node.type.name;
  let lost: LostItem | null = null;
  return recorder.subtree(
    () => {
      const children: XmlNode[] = [];
      node.forEach((child) => {
        const childMeta: DocxNodeMeta = { inline: child.isInline };
        children.push(...walk(child, ctx, handlers, childMeta, recorder));
      });

      const handler = handlers.nodes[type];
      if (!handler) {
        recorder.unhandled(type, NO_HANDLER);
        // "drop" bubbles the children up; "placeholder" writes a stand-in
        // in their place.
        if (ctx.options.unsupported === "placeholder") lost = { kind: type, owner: null };
        return applyUnsupportedPolicy(node, children, ctx);
      }

      const owner = ownerOf(handlers.owners?.nodes, type);
      const result = recorder.handle(
        owner,
        type,
        () => handler(node, children, ctx, meta),
        wroteXml,
      );
      if (!wroteXml(result)) lost = { kind: type, owner };
      return Array.isArray(result) ? result : [result];
    },
    () => lost,
  );
}

/** A node handler's result put something in the document. */
function wroteXml(result: XmlNode | XmlNode[]): boolean {
  return Array.isArray(result) ? result.length > 0 : Boolean(result);
}

/**
 * Which of a mark's handlers accounts for it in the report. A mark is one item
 * however many handlers touch it, and the one that writes its element decides:
 * the wrapper when there is one (a hyperlink exists only if it wraps the run),
 * otherwise the property handler.
 */
function markAccountant(
  handlers: WalkerHandlers,
  type: string,
): "wrapper" | "properties" | "none" {
  if (handlers.markWrappers?.[type]) return "wrapper";
  if (handlers.marks[type]) return "properties";
  return "none";
}

function mergeMarks(
  marks: readonly Mark[],
  ctx: DocxContext,
  handlers: WalkerHandlers,
  recorder: DocxReportRecorder,
): DocxRunProps {
  let props: DocxRunProps = {};
  for (const mark of marks) {
    const type = mark.type.name;
    const accountant = markAccountant(handlers, type);
    const handler = handlers.marks[type];
    if (!handler) {
      // A wrapper alone carries a mark across, and `wrapRun` accounts for it.
      if (accountant === "none") {
        ctx.diagnostics.warn({
          code: "unsupported-mark",
          message: `No DOCX handler registered for mark "${type}"`,
          markType: type,
        });
        recorder.unhandled(type, NO_HANDLER);
      }
      continue;
    }
    const owner = ownerOf(handlers.owners?.marks, type);
    const apply = () => handler(props, mark, ctx);
    // A property handler always returns a bag, so when it is the accountant it
    // kept the mark unless it said otherwise.
    props = accountant === "properties"
      ? recorder.handle(owner, type, apply, () => true)
      : recorder.attribute(owner, apply);
  }
  return props;
}

/**
 * Enclose a run in whatever its wrapping marks produce.
 *
 * A mark with no wrapper is not a gap — most marks legitimately have nothing
 * to wrap with.
 */
function wrapRun(
  run: XmlNode,
  marks: readonly Mark[],
  ctx: DocxContext,
  handlers: WalkerHandlers,
  recorder: DocxReportRecorder,
): XmlNode {
  const wrappers = handlers.markWrappers;
  if (!wrappers) return run;

  let wrapped = run;
  for (const mark of marks) {
    const type = mark.type.name;
    const wrapper = wrappers[type];
    if (!wrapper) continue;
    const before = wrapped;
    wrapped = recorder.handle(
      ownerOf(handlers.owners?.markWrappers, type),
      type,
      () => wrapper(before, mark, ctx),
      (result) => result !== before,
      WRAPPER_DECLINED,
    );
  }
  return wrapped;
}

function renderRun(text: string, props: DocxRunProps): XmlNode {
  const rPr = buildRunProperties(props);
  // Text nodes can carry literal `\n` (e.g. multi-line `codeBlock` content)
  // — `<w:t>` is single-line, so split on newlines and intersperse `<w:br/>`
  // within the same `<w:r>` so run properties stay consistent across the
  // wrapped lines.
  const segments = text.split("\n");
  const body: XmlNode[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? "";
    const tAttrs = needsPreserveSpace(seg) ? { "xml:space": "preserve" } : undefined;
    body.push(xml("w:t", tAttrs, seg.length > 0 ? [seg] : undefined));
    if (i < segments.length - 1) body.push(xml("w:br"));
  }
  return xml("w:r", undefined, rPr ? [rPr, ...body] : body);
}

/**
 * Build `<w:rPr>` from merged props. Returns `null` when no properties are
 * set so the run stays compact (`<w:r><w:t>...</w:t></w:r>`).
 *
 * Children are emitted in OOXML spec order — Word is forgiving but
 * deterministic order keeps golden diffs stable.
 */
function buildRunProperties(props: DocxRunProps): XmlNode | null {
  const children: XmlNode[] = [];

  if (props.styleId) {
    children.push(xml("w:rStyle", { "w:val": props.styleId }));
  }
  if (props.fontFamily) {
    children.push(
      xml("w:rFonts", {
        "w:ascii": props.fontFamily,
        "w:hAnsi": props.fontFamily,
      }),
    );
  } else if (props.code) {
    children.push(
      xml("w:rFonts", {
        "w:ascii": "Courier New",
        "w:hAnsi": "Courier New",
      }),
    );
  }
  if (props.bold) children.push(xml("w:b"));
  if (props.italic) children.push(xml("w:i"));
  if (props.strike) children.push(xml("w:strike"));
  if (props.color) {
    const color = cssColorToDocxHex(props.color);
    if (color) children.push(xml("w:color", { "w:val": color }));
  }
  if (props.fontSize !== undefined) {
    // px → pt = ×0.75; half-points = pt × 2; net factor = ×1.5.
    const halfPoints = Math.round(props.fontSize * 1.5);
    children.push(xml("w:sz", { "w:val": String(halfPoints) }));
  }
  if (props.highlight) {
    children.push(xml("w:highlight", { "w:val": props.highlight }));
  }
  if (props.shadingFill) {
    children.push(
      xml("w:shd", {
        "w:val": "clear",
        "w:color": "auto",
        "w:fill": props.shadingFill,
      }),
    );
  }
  if (props.underline) children.push(xml("w:u", { "w:val": "single" }));

  // Reserved: trackedInsert / trackedDelete are intentionally NOT emitted
  // in the base walker. Track-changes XML wrappers (<w:ins>/<w:del>) need
  // surrounding author/date/comment-range semantics that belong in a
  // dedicated feature PR.

  return children.length > 0 ? xml("w:rPr", undefined, children) : null;
}

function needsPreserveSpace(text: string): boolean {
  if (text.length === 0) return false;
  return /^\s|\s$|\s{2,}/.test(text);
}

function applyUnsupportedPolicy(
  node: Node,
  children: XmlNode[],
  ctx: DocxContext,
): XmlNode[] {
  const message = `No DOCX handler registered for node "${node.type.name}"`;
  switch (ctx.options.unsupported) {
    case "throw": {
      ctx.diagnostics.error({
        code: "unsupported-node",
        message,
        nodeType: node.type.name,
      });
      throw new DocxExportError(message, ctx.diagnostics.list());
    }
    case "placeholder": {
      ctx.diagnostics.warn({
        code: "unsupported-node",
        message,
        nodeType: node.type.name,
      });
      return [
        xml("w:p", undefined, [
          xml("w:r", undefined, [
            xml("w:t", undefined, [`[Unsupported Scrivr node: ${node.type.name}]`]),
          ]),
        ]),
      ];
    }
    case "drop":
    default: {
      ctx.diagnostics.warn({
        code: "unsupported-node",
        message,
        nodeType: node.type.name,
      });
      // Drop the wrapper but keep children — preserves inline text inside
      // an unsupported block (custom callouts, etc.). When the dropped
      // node was a textblock (paragraph-like — held inline content), wrap
      // the bubbled children in <w:p>; otherwise bare runs would sit as
      // direct children of <w:body>, which is invalid OOXML and Word
      // refuses to open the file.
      if (node.isTextblock && children.length > 0) {
        return [xml("w:p", undefined, children)];
      }
      return children;
    }
  }
}
