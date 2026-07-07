import type { Node as PmNode } from "prosemirror-model";
import type { SemanticNodeResult, SemanticUnit, UnitCtx } from "@scrivr/core";
import type { ResolvedHandlers } from "./collectHandlers";
import { groupBlocks } from "./grouping";
import { resolveNodeId, type BlockEntry } from "./id";

const warnedTypes = new Set<string>();

function warnUnknown(name: string): void {
  if (warnedTypes.has(name)) return;
  warnedTypes.add(name);
  const env = typeof process !== "undefined" ? process.env["NODE_ENV"] : undefined;
  if (env === "production" || env === "test") return;
  // A node with no registered `semantic` handler is not dropped — it emits a
  // default `unknown` unit. Surface it once so the gap is visible, not silent.
  console.warn(`[semantic] no handler for node type "${name}" — emitting type:"unknown"`);
}

function headingLevelOf(node: PmNode): number {
  const raw = node.attrs["level"];
  return typeof raw === "number" ? raw : 1;
}

/**
 * Walk the document body in order, apply cohesive-pair grouping, thread the
 * heading stack for breadcrumbs, and emit one `SemanticUnit` per group. The
 * walker owns identity (id/nodeIds/order), breadcrumb, and role; per-node
 * handlers own classification + structured extras (table cells).
 */
export function walkSemantic(
  doc: PmNode,
  ctx: UnitCtx,
  handlers: ResolvedHandlers,
  shortBlockMaxChars: number,
): SemanticUnit[] {
  const entries: BlockEntry[] = [];
  doc.forEach((node, _offset, index) => {
    entries.push({ node, index });
  });

  const groups = groupBlocks(entries, shortBlockMaxChars);
  const units: SemanticUnit[] = [];
  const stack: { level: number; title: string }[] = [];
  let order = 0;

  for (const group of groups) {
    const anchor = group[0]!.node;
    const nodes = group.map((e) => e.node);

    const handler = handlers.nodes[anchor.type.name];
    let result: SemanticNodeResult;
    if (handler) {
      result = handler(anchor, ctx);
    } else {
      warnUnknown(anchor.type.name);
      result = { type: "unknown" };
    }

    // Breadcrumb is the ancestor heading path. For a heading unit, pop
    // same/shallower-level entries FIRST so its own breadcrumb reflects only
    // true ancestors (a sibling heading — or a top-level heading with none —
    // must not inherit the previous section). Body units then read the full
    // active-heading stack.
    const isHeading = anchor.type.name === "heading";
    let headingLevel: number | undefined;
    if (isHeading) {
      headingLevel = headingLevelOf(anchor);
      while (stack.length > 0 && stack[stack.length - 1]!.level >= headingLevel) {
        stack.pop();
      }
    }
    const breadcrumb = stack.map((s) => s.title);
    if (isHeading && headingLevel !== undefined) {
      // Breadcrumbs are embedding input too, so they must use the same
      // mark-aware extraction as unit text (notably excluding tracked deletes).
      stack.push({ level: headingLevel, title: ctx.toText(anchor) });
    }

    const nodeIds = group.map(resolveNodeId);
    const unit: SemanticUnit = {
      id: nodeIds[0]!,
      nodeIds,
      type: result.type,
      role: "body",
      breadcrumb,
      order: order++,
      text: result.text ?? ctx.toText(nodes),
    };
    if (headingLevel !== undefined) unit.headingLevel = headingLevel;
    // Block styling markdown can't express (alignment, indent, font, …), taken
    // from the anchor block. Only present when non-default.
    const attrs = ctx.attrsOf(anchor);
    if (attrs) unit.attrs = attrs;
    // Inline formatting runs — lossless where markdown is not. Emit only when
    // something is actually formatted, so plain units stay lean.
    const spans = ctx.toSpans(nodes);
    if (spans.some((s) => s.marks.length > 0)) unit.spans = spans;
    const markdown = result.markdown ?? ctx.toMarkdown(nodes);
    if (markdown.length > 0) unit.markdown = markdown;
    if (result.cells !== undefined) unit.cells = result.cells;
    const changes = ctx.toChanges(nodes);
    if (changes.length > 0) unit.changes = changes;

    units.push(unit);
  }

  return units;
}
