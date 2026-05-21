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

import type { Node, Mark } from "prosemirror-model";
import { xml } from "./xml";
import type { XmlNode, DocxContext } from "./context";
import type {
  DocxNodeHandler,
  DocxMarkHandler,
  DocxNodeMeta,
  DocxRunProps,
} from "./handlers";
import { DocxExportError } from "./error";

export interface WalkerHandlers {
  nodes: Record<string, DocxNodeHandler>;
  marks: Record<string, DocxMarkHandler>;
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
  // Text nodes own their mark stack — emit a single <w:r> with merged props.
  if (node.isText) {
    return [renderRun(node.text ?? "", mergeMarks(node.marks, ctx, handlers))];
  }

  const children: XmlNode[] = [];
  node.forEach((child) => {
    const childMeta: DocxNodeMeta = { inline: child.isInline };
    children.push(...walkNode(child, ctx, handlers, childMeta));
  });

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
    children.push(xml("w:color", { "w:val": props.color.replace(/^#/, "") }));
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
