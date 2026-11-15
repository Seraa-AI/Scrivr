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
 * Unknown marks always record a warning; the run is still emitted (the
 * unknown mark is silently absent).
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

export interface WalkerHandlers {
  nodes: Record<string, DocxNodeHandler>;
  marks: Record<string, DocxMarkHandler>;
  /** Marks that wrap their runs — hyperlinks. See `DocxRunWrapper`. */
  markWrappers?: Record<string, DocxRunWrapper>;
}

/** Walk the body of a document — skips the implicit root and returns body content. */
export function walkDocument(
  doc: Node,
  ctx: DocxContext,
  handlers: WalkerHandlers,
): XmlNode[] {
  const out: XmlNode[] = [];
  doc.forEach((child) => {
    const meta: DocxNodeMeta = { inline: child.isInline };
    out.push(...walkNode(child, ctx, handlers, meta));
  });
  return out;
}

export function walkNode(
  node: Node,
  ctx: DocxContext,
  handlers: WalkerHandlers,
  meta: DocxNodeMeta,
): XmlNode[] {
  // Text nodes own their mark stack — emit a single <w:r> with merged props,
  // then let any wrapping marks (hyperlinks) enclose it.
  if (node.isText) return wrapRuns([textRun(node, ctx, handlers)], ctx, handlers);

  // Consecutive runs under one wrapping mark are wrapped together, so they
  // are gathered before anything else interrupts them.
  const children: XmlNode[] = [];
  let runs: PendingRun[] = [];
  node.forEach((child) => {
    if (child.isText) {
      runs.push(textRun(child, ctx, handlers));
      return;
    }
    // A line break inside a link or a field belongs to its stretch.
    if (child.isInline) {
      const wrapping = wrappingMarks(child, handlers);
      runs.push(...walkNode(child, ctx, handlers, { inline: true }).map((xml) => ({ xml, wrapping })));
      return;
    }
    children.push(...wrapRuns(runs, ctx, handlers));
    runs = [];
    const childMeta: DocxNodeMeta = { inline: child.isInline };
    children.push(...walkNode(child, ctx, handlers, childMeta));
  });
  children.push(...wrapRuns(runs, ctx, handlers));

  const handler = handlers.nodes[node.type.name];
  if (!handler) {
    return applyUnsupportedPolicy(node, children, ctx);
  }

  const result = handler(node, children, ctx, meta);
  return Array.isArray(result) ? result : [result];
}

function mergeMarks(
  marks: readonly Mark[],
  ctx: DocxContext,
  handlers: WalkerHandlers,
): DocxRunProps {
  let props: DocxRunProps = {};
  for (const mark of marks) {
    const handler = handlers.marks[mark.type.name];
    // A mark that wraps its runs has said how it exports.
    if (!handler && handlers.markWrappers?.[mark.type.name]) continue;
    if (!handler) {
      ctx.diagnostics.warn({
        code: "unsupported-mark",
        message: `No DOCX handler registered for mark "${mark.type.name}"`,
        markType: mark.type.name,
      });
      continue;
    }
    props = handler(props, mark, ctx);
  }
  return props;
}

/** A rendered run and the marks that still have to wrap it. */
interface PendingRun {
  xml: XmlNode;
  wrapping: readonly Mark[];
}

/** A text node's run, with the marks that will wrap it. */
function textRun(node: Node, ctx: DocxContext, handlers: WalkerHandlers): PendingRun {
  return {
    xml: renderRun(node.text ?? "", mergeMarks(node.marks, ctx, handlers)),
    wrapping: wrappingMarks(node, handlers),
  };
}

/**
 * The marks on `node` that wrap their runs. One with no wrapper is not a gap:
 * `mergeMarks` warns about a mark with neither, and most legitimately have
 * nothing to wrap with.
 */
function wrappingMarks(node: Node, handlers: WalkerHandlers): readonly Mark[] {
  const wrappers = handlers.markWrappers;
  return wrappers ? node.marks.filter((mark) => wrappers[mark.type.name]) : [];
}

/**
 * Wrap consecutive runs once per stretch of each wrapping mark. Where marks
 * overlap, the one covering the most runs goes outermost, so a content
 * control around a link stays one element.
 */
function wrapRuns(runs: readonly PendingRun[], ctx: DocxContext, handlers: WalkerHandlers): XmlNode[] {
  const out: XmlNode[] = [];
  let i = 0;
  while (i < runs.length) {
    const stretch = (mark: Mark) => {
      let end = i;
      while (end < runs.length && mark.isInSet(runs[end]!.wrapping)) end++;
      return end;
    };
    let outer: Mark | null = null;
    let end = i + 1;
    for (const mark of runs[i]!.wrapping) {
      const reach = stretch(mark);
      if (outer === null || reach > end) {
        outer = mark;
        end = reach;
      }
    }
    if (outer === null) {
      out.push(runs[i]!.xml);
      i++;
      continue;
    }
    const without = outer;
    const inner = wrapRuns(
      runs.slice(i, end).map((run) => ({ xml: run.xml, wrapping: without.removeFromSet(run.wrapping) })),
      ctx,
      handlers,
    );
    const wrapped = handlers.markWrappers![outer.type.name]!(inner, outer, ctx);
    out.push(...(Array.isArray(wrapped) ? wrapped : [wrapped]));
    i = end;
  }
  return out;
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
