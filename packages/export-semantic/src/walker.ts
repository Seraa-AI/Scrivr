import type { Node as PmNode } from "@scrivr/core/pm";
import type { SemanticNodeResult, SemanticPart, SemanticUnit, UnitCtx } from "@scrivr/core";
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
  group = true,
): SemanticUnit[] {
  const entries: BlockEntry[] = [];
  doc.forEach((node, _offset, index) => {
    entries.push({ node, index });
  });

  // One unit per block (the edit read path) bypasses cohesive-pair grouping so
  // each unit maps to exactly one block. Container units still expose their
  // inner leaves as `parts` either way.
  const groups = group
    ? groupBlocks(entries, shortBlockMaxChars, (node) => ctx.toText(node))
    : entries.map((e) => [e]);
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
    const text = result.text ?? ctx.toText(nodes);
    const unit: SemanticUnit = {
      id: nodeIds[0]!,
      nodeIds,
      type: result.type,
      role: "body",
      view: "proposed",
      breadcrumb,
      order: order++,
      text,
    };
    const changes = ctx.toChanges(nodes);
    if (changes.length > 0) unit.changes = changes;
    if (headingLevel !== undefined) unit.headingLevel = headingLevel;
    // Block styling markdown can't express (alignment, indent, font, …), taken
    // from the anchor block. Only present when non-default.
    const attrs = ctx.attrsOf(anchor);
    if (attrs) unit.attrs = attrs;
    // Inline formatting runs — lossless where markdown is not. Emit only when
    // something is actually formatted, so plain units stay lean. If a handler
    // overrides text, generated spans from the source nodes may no longer
    // reconstruct the final unit text; omit them rather than emit contradictory
    // output.
    const spans = ctx.toSpans(nodes);
    if (spans.map((s) => s.text).join("") === text && spans.some((s) => s.marks.length > 0)) {
      unit.spans = spans;
    }
    const markdown = result.markdown ?? ctx.toMarkdown(nodes);
    if (changes.length === 0 && markdown.length > 0) unit.markdown = markdown;
    if (result.cells !== undefined) unit.cells = result.cells;
    // Container units (list, table, …) expose their inner leaf textblocks as
    // individually addressable `parts` — the edit surface. A leaf unit has none.
    const parts = extractParts(nodes, ctx, breadcrumb);
    if (parts) unit.parts = parts;

    units.push(unit);
  }

  return units;
}

/** Location label for a positional container level in a part breadcrumb. */
const CONTAINER_LABELS: Record<string, string> = {
  listItem: "item",
  tableRow: "row",
  tableCell: "col",
  tableHeader: "col",
};

/** The textblock types exposed as editable parts (matches `SemanticPart.type`). */
function partTypeOf(name: string): SemanticPart["type"] | null {
  switch (name) {
    case "paragraph":
      return "paragraph";
    case "heading":
      return "heading";
    case "codeBlock":
      return "codeBlock";
    default:
      return null;
  }
}

/**
 * Collect the editable leaf textblocks nested inside a unit's blocks. Only
 * containers (list, table) yield parts; a group whose blocks are all leaf
 * textblocks yields none (those are addressed as the unit itself). Breadcrumb
 * extends the unit's with positional context (`item 2`, `row 1`, `col 2`).
 */
function extractParts(
  nodes: readonly PmNode[],
  ctx: UnitCtx,
  unitBreadcrumb: string[],
): SemanticPart[] | undefined {
  const parts: SemanticPart[] = [];
  for (const node of nodes) {
    // A top-level leaf block is the unit itself, not a nested part.
    if (node.isTextblock) continue;
    collectParts(node, ctx, unitBreadcrumb, parts);
  }
  return parts.length > 0 ? parts : undefined;
}

function collectParts(
  node: PmNode,
  ctx: UnitCtx,
  breadcrumb: string[],
  out: SemanticPart[],
): void {
  node.forEach((child, _offset, index) => {
    const label = CONTAINER_LABELS[child.type.name];
    const childBreadcrumb = label ? [...breadcrumb, `${label} ${index + 1}`] : breadcrumb;

    if (child.isTextblock) {
      const partType = partTypeOf(child.type.name);
      const nodeId = child.attrs["nodeId"];
      if (partType && typeof nodeId === "string" && nodeId.length > 0) {
        const part: SemanticPart = {
          nodeId,
          type: partType,
          breadcrumb: childBreadcrumb,
          text: ctx.toText(child),
        };
        const spans = ctx.toSpans(child);
        if (spans.map((s) => s.text).join("") === part.text && spans.some((s) => s.marks.length > 0)) {
          part.spans = spans;
        }
        const attrs = ctx.attrsOf(child);
        if (attrs) part.attrs = attrs;
        out.push(part);
      }
      return; // textblocks hold only inline content — nothing deeper to collect
    }

    collectParts(child, ctx, childBreadcrumb, out);
  });
}
