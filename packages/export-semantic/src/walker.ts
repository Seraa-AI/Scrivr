import type { Node as PmNode } from "@scrivr/core/pm";
import { breakOf, outlineLevelOf, outlineTitleOf, type SemanticChange, type SemanticHeading, type SemanticNodeResult, type SemanticPart, type SemanticTextView, type SemanticUnit, type UnitCtx } from "@scrivr/core";
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

function unplaced({ at: _at, length: _length, ...change }: SemanticChange): SemanticChange {
  return change;
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
  view: SemanticTextView = "proposed",
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
  const proposed = proposedBlocksOnce(doc, handlers, view);

  // What the proposed view leaves out of a title: what the lane reports
  // removed, and a text run its mark handlers drop (a tracked deletion).
  const removed = (node: PmNode): boolean =>
    ctx.isRemoved(node) || (node.isText && (node.text ?? "") !== "" && ctx.toText(node) === "");
  // A block heads a section when its spec declares an outline level and its
  // title is not empty, titled by the rule the PDF bookmarks use.
  const headingOf = (node: PmNode): { level: number; title: string } | null => {
    const level = outlineLevelOf(node);
    if (level === null) return null;
    const title = outlineTitleOf(node, removed);
    return title === "" ? null : { level, title };
  };
  // A heading sits under the open headings shallower than it, then heads
  // what follows it.
  const enter = (heading: { level: number; title: string }): string[] => {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) stack.pop();
    const under = stack.map((s) => s.title);
    stack.push(heading);
    return under;
  };

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

    // A heading unit's breadcrumb is its true ancestors (a sibling heading
    // must not inherit the previous section); any other unit reads the open
    // headings. Headings nested inside the unit then head what follows it.
    const nodeIds = group.map(resolveNodeId);
    const anchorHeading = headingOf(anchor);
    const breadcrumb = anchorHeading ? enter(anchorHeading) : stack.map((s) => s.title);
    const headings: SemanticHeading[] = anchorHeading
      ? [{ nodeId: nodeIds[0]!, ...anchorHeading, breadcrumb }]
      : [];
    for (const node of nodes) {
      node.descendants((child) => {
        const nested = headingOf(child);
        if (nested) {
          const raw = child.attrs["nodeId"];
          const nodeId = typeof raw === "string" && raw.length > 0 ? raw : `${nodeIds[0]!}/h${headings.length}`;
          headings.push({ nodeId, ...nested, breadcrumb: enter(nested) });
        }
        return !child.isTextblock;
      });
    }

    const text = result.text ?? ctx.toText(nodes);
    const unit: SemanticUnit = {
      id: nodeIds[0]!,
      nodeIds,
      type: result.type,
      role: "body",
      view,
      breadcrumb,
      order: order++,
      text,
    };
    // Offsets index the walker's own text; a handler that overrides it gets none.
    const placed = ctx.toChanges(nodes);
    const changes = result.text === undefined || result.text === ctx.toText(nodes) ? placed : placed.map(unplaced);
    if (changes.length > 0) unit.changes = changes;
    if (anchorHeading) unit.headingLevel = anchorHeading.level;
    if (headings.length > 0) unit.headings = headings;
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
    const markdown = changes.length === 0
      ? result.markdown ?? ctx.toMarkdown(nodes)
      : proposedMarkdown(nodes, nodeIds, text, proposed(), handlers, ctx);
    if (markdown.length > 0) unit.markdown = markdown;
    if (result.cells !== undefined) unit.cells = result.cells;
    if (result.image !== undefined) unit.image = result.image;
    // A grouped unit is gone only when every block in it is.
    if (nodes.every((node) => ctx.isRemoved(node))) unit.proposedForDeletion = true;
    // Container units (list, table, …) expose their inner leaf textblocks as
    // individually addressable `parts` — the edit surface. A leaf unit has none.
    const parts = extractParts(nodes, ctx, breadcrumb);
    if (parts) unit.parts = parts;

    units.push(unit);
  }

  return units;
}

/**
 * A getter for the blocks of the proposed document — every pending change
 * accepted — by id, built on the first call only, so a call with no changes
 * never builds it. Null when the view is not the proposed one, no contribution
 * supplies that document, or supplying it fails: markdown is a convenience, so
 * it is left out rather than the whole export failing.
 */
function proposedBlocksOnce(doc: PmNode, handlers: ResolvedHandlers, view: SemanticTextView): () => Map<string, PmNode> | null {
  let blocks: Map<string, PmNode> | null | undefined;
  return () => {
    if (blocks !== undefined) return blocks;
    blocks = null;
    if (view !== "proposed") return blocks;
    for (const supply of handlers.proposedDocuments) {
      let accepted: PmNode | null;
      try {
        accepted = supply(doc);
      } catch {
        return blocks;
      }
      if (!accepted) continue;
      const byId = new Map<string, PmNode>();
      accepted.forEach((node) => {
        const id = node.attrs["nodeId"];
        if (typeof id === "string" && id.length > 0) byId.set(id, node);
      });
      blocks = byId;
      break;
    }
    return blocks;
  };
}

/**
 * A unit with changes as markdown: its blocks as the proposal leaves them,
 * through the same node handler, so one that declines markdown (a table with
 * merged cells) still does. Only where none of the unit's blocks is proposed
 * for deletion — a move's old place shares its id with the new one — and the
 * proposed document holds every one of them, reading as the unit does: the
 * same text and the same inline objects. So not for a block a pending deletion
 * joins to the next, or one with no stored id, and a unit never carries
 * another unit's words or images. Without the proposed document there is
 * none, rather than the live blocks' redlines.
 */
function proposedMarkdown(
  live: readonly PmNode[],
  nodeIds: readonly string[],
  text: string,
  blocks: Map<string, PmNode> | null,
  handlers: ResolvedHandlers,
  ctx: UnitCtx,
): string {
  if (!blocks || live.some((node) => ctx.isRemoved(node))) return "";
  const nodes = nodeIds.map((id) => blocks.get(id));
  if (!nodes.every((node): node is PmNode => node !== undefined)) return "";
  if (ctx.toText(nodes) !== text) return "";
  if (inlineObjects(nodes, () => true) !== inlineObjects(live, (node) => !ctx.isRemoved(node))) return "";
  const handled = handlers.nodes[nodes[0]!.type.name]?.(nodes[0]!, ctx);
  return handled?.markdown ?? ctx.toMarkdown(nodes);
}

/** How many inline objects (images, fields) `nodes` hold that `counts` keeps; a line break reads as text. */
function inlineObjects(nodes: readonly PmNode[], counts: (node: PmNode) => boolean): number {
  let objects = 0;
  for (const node of nodes) {
    node.descendants((child) => {
      if (child.isInline && child.isLeaf && !child.isText && breakOf(child.type) !== "line" && counts(child)) objects++;
    });
  }
  return objects;
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
        const changes = ctx.toChanges(child);
        if (changes.length > 0) part.changes = changes;
        if (ctx.isRemoved(child)) part.proposedForDeletion = true;
        out.push(part);
      }
      return; // textblocks hold only inline content — nothing deeper to collect
    }

    collectParts(child, ctx, childBreadcrumb, out);
  });
}
