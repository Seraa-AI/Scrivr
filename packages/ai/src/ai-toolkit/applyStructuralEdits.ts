/**
 * Structural edits → ordinary ProseMirror transactions.
 *
 * Nothing here marks a change as tracked. The track-changes engine already
 * tracks transactions it sees, producing node-level insert/delete changes, so an
 * op's whole job is to turn "an item after this one" into a position and a node.
 * Tracking a second time here would double-mark the same edit.
 *
 * Every op resolves through a `nodeId` the agent was shown. An id may name a
 * container (a `listItem`) or the leaf inside it (the item's paragraph) — the
 * agent sees leaves, so ops that act on a container climb to it.
 */
import { findNodeById, spansToFragment, tableColumnCount } from "@scrivr/core";
import { MAX_TRACKED_STEPS_PER_TR, findLiveNodeById, pickAgentAttrs, shadowRanges } from "@scrivr/plugins";
import type { Node as PmNode, Schema, Transaction } from "@scrivr/core/pm";

import type { SemanticBlockInput, SemanticCellInput, StructuralSemanticEdit } from "../schema/edit";
import { toCoreSpans } from "./spans";

export interface StructuralEditResult {
  /** nodeIds whose op produced a change. */
  changed: string[];
  /** nodeIds naming a node the document does not hold. */
  notFound: string[];
  /** nodeIds that resolved, but only to deleted content or a shape the op cannot act on. */
  rejected: string[];
}

type ResolveNode = (nodeId: string) => { node: PmNode; pos: number } | null;

/**
 * Shadow ranges are read once, from the document the batch starts on, and
 * mapped through the batch's own steps before each lookup — re-sliced per
 * lookup because later ops keep appending steps. The tracking engine runs
 * after dispatch, so a node this batch moved still has only one copy; the
 * entry shadows are the ones resolution has to exclude.
 */
function createLiveResolver(tr: Transaction): ResolveNode {
  const start = tr.mapping.maps.length;
  const entryShadows = shadowRanges(tr.doc);
  return (nodeId) => {
    const mapping = tr.mapping.slice(start);
    const mapped = entryShadows.map(
      ([from, to]) => [mapping.map(from, 1), mapping.map(to, -1)] as const,
    );
    return findLiveNodeById(tr.doc, nodeId, mapped);
  };
}

/** The node an id names, plus the ancestor of `type` that encloses it. */
function resolveAncestor(
  doc: PmNode,
  nodeId: string,
  typeName: string,
  resolve: ResolveNode,
): { node: PmNode; pos: number } | null {
  const found = resolve(nodeId);
  if (!found) return null;
  if (found.node.type.name === typeName) return found;
  const $pos = doc.resolve(found.pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === typeName) {
      return { node: $pos.node(depth), pos: $pos.before(depth) };
    }
  }
  return null;
}

/**
 * The block `nodeId` names, but only when it is a block of the document itself.
 *
 * `insertBlock` and `deleteBlock` act on the document's own flow. An id that
 * resolves inside a list or a table is not that, and climbing to the container
 * would turn "delete this clause" into deleting the whole table — so a nested id
 * is refused, and `deleteListItem` / `deleteTableRow` are how those are reached.
 */
function resolveTopLevel(doc: PmNode, nodeId: string, resolve: ResolveNode): { node: PmNode; pos: number } | null {
  const found = resolve(nodeId);
  if (!found) return null;
  return doc.resolve(found.pos).depth === 0 ? found : null;
}

function buildBlock(schema: Schema, block: SemanticBlockInput): PmNode | null {
  const type = schema.nodes[block.type];
  if (!type) return null;
  const attrs = { ...pickAgentAttrs(block.attrs ?? {}), ...(block.level !== undefined ? { level: block.level } : {}) };
  return type.createAndFill(attrs, spansToFragment(toCoreSpans(block.spans ?? []), schema, { parentType: type }));
}

function buildCell(schema: Schema, cell: SemanticCellInput | undefined): PmNode | null {
  const cellType = schema.nodes["tableCell"];
  const paragraph = schema.nodes["paragraph"];
  if (!cellType || !paragraph) return null;
  const content = paragraph.createAndFill({}, spansToFragment(toCoreSpans(cell?.spans ?? []), schema, { parentType: paragraph }));
  return content ? cellType.createAndFill(pickAgentAttrs(cell?.attrs ?? {}), content) : null;
}

/**
 * Deleting the last required child removes its list/table container. Letting
 * PM fit an empty slice inside `listItem+` / `tableRow+` invents a replacement
 * child, which changes the operation from deletion to clearing its content.
 */
function deleteContainerChild(tr: Transaction, target: { node: PmNode; pos: number }): void {
  const $pos = tr.doc.resolve(target.pos);
  if ($pos.depth > 0 && $pos.parent.childCount === 1) {
    tr.delete($pos.before(), $pos.after());
  } else {
    tr.delete(target.pos, target.pos + target.node.nodeSize);
  }
}

/**
 * Apply one structural op to `tr`. Returns the id it acted on, or records why
 * it could not — a missing anchor and a wrong-shaped anchor are different
 * answers, and a caller routing agent output needs to tell them apart.
 */
function applyOne(
  tr: Transaction,
  edit: StructuralSemanticEdit,
  result: StructuralEditResult,
  resolve: ResolveNode,
  moved: Set<string>,
): void {
  const schema = tr.doc.type.schema;

  switch (edit.op) {
    case "insertBlock": {
      const anchor = resolveTopLevel(tr.doc, edit.anchorNodeId, resolve);
      if (!anchor) return void rejectOrMiss(tr.doc, edit.anchorNodeId, result);
      const node = buildBlock(schema, edit.block);
      if (!node) return void result.rejected.push(edit.anchorNodeId);
      tr.insert(edit.position === "before" ? anchor.pos : anchor.pos + anchor.node.nodeSize, node);
      result.changed.push(edit.anchorNodeId);
      return;
    }
    case "deleteBlock": {
      const target = resolveTopLevel(tr.doc, edit.nodeId, resolve);
      if (!target) return void rejectOrMiss(tr.doc, edit.nodeId, result);
      tr.delete(target.pos, target.pos + target.node.nodeSize);
      result.changed.push(edit.nodeId);
      return;
    }
    case "moveBlock":
    case "moveListItem": {
      const resolveTarget = (id: string) => edit.op === "moveBlock"
        ? resolveTopLevel(tr.doc, id, resolve)
        : resolveAncestor(tr.doc, id, "listItem", resolve);
      const target = resolveTarget(edit.nodeId);
      if (!target) return void rejectOrMiss(tr.doc, edit.nodeId, result);
      const anchor = resolveTarget(edit.anchorNodeId);
      if (!anchor) return void rejectOrMiss(tr.doc, edit.anchorNodeId, result);
      // A second move of the same node in one transaction emits a second
      // overlapping delete/insert pair, which tracking pairs wrongly and
      // replays into a duplicated block. One move per node per batch.
      if (moved.has(edit.nodeId)) return void result.rejected.push(edit.nodeId);
      if (edit.op === "moveListItem") {
        const source = tr.doc.resolve(target.pos);
        const destination = tr.doc.resolve(anchor.pos);
        if (source.depth !== destination.depth || source.start() !== destination.start()) {
          result.rejected.push(edit.nodeId);
          return;
        }
      }
      const at = edit.position === "before" ? anchor.pos : anchor.pos + anchor.node.nodeSize;
      // Moving beside oneself or to the current boundary is already satisfied.
      if (target.pos === anchor.pos || at === target.pos || at === target.pos + target.node.nodeSize) return;
      tr.delete(target.pos, target.pos + target.node.nodeSize);
      tr.insert(at > target.pos ? at - target.node.nodeSize : at, target.node);
      moved.add(edit.nodeId);
      result.changed.push(edit.nodeId);
      return;
    }
    case "insertListItem": {
      const item = resolveAncestor(tr.doc, edit.anchorNodeId, "listItem", resolve);
      if (!item) return void rejectOrMiss(tr.doc, edit.anchorNodeId, result);
      const itemType = schema.nodes["listItem"];
      const paragraph = schema.nodes["paragraph"];
      if (!itemType || !paragraph) return void result.rejected.push(edit.anchorNodeId);
      const body = paragraph.createAndFill(
        pickAgentAttrs(edit.item.attrs ?? {}),
        spansToFragment(toCoreSpans(edit.item.spans), schema, { parentType: paragraph }),
      );
      const node = body && itemType.createAndFill({}, body);
      if (!node) return void result.rejected.push(edit.anchorNodeId);
      tr.insert(edit.position === "before" ? item.pos : item.pos + item.node.nodeSize, node);
      result.changed.push(edit.anchorNodeId);
      return;
    }
    case "deleteListItem": {
      const item = resolveAncestor(tr.doc, edit.nodeId, "listItem", resolve);
      if (!item) return void rejectOrMiss(tr.doc, edit.nodeId, result);
      deleteContainerChild(tr, item);
      result.changed.push(edit.nodeId);
      return;
    }
    case "insertTableRow": {
      const row = resolveAncestor(tr.doc, edit.anchorNodeId, "tableRow", resolve);
      if (!row) return void rejectOrMiss(tr.doc, edit.anchorNodeId, result);
      const rowType = schema.nodes["tableRow"];
      if (!rowType) return void result.rejected.push(edit.anchorNodeId);
      const table = tr.doc.resolve(row.pos).parent;
      if (table.type.name !== "table") return void result.rejected.push(edit.anchorNodeId);
      const width = tableColumnCount(table);
      // Padding is lossless; truncation is not. Validate before adding any steps.
      if ((edit.cells?.length ?? 0) > width) return void result.rejected.push(edit.anchorNodeId);
      const cells: PmNode[] = [];
      for (let i = 0; i < width; i++) {
        const built = buildCell(schema, edit.cells?.[i]);
        if (!built) return void result.rejected.push(edit.anchorNodeId);
        cells.push(built);
      }
      const node = rowType.createAndFill({}, cells);
      if (!node) return void result.rejected.push(edit.anchorNodeId);
      tr.insert(edit.position === "before" ? row.pos : row.pos + row.node.nodeSize, node);
      result.changed.push(edit.anchorNodeId);
      return;
    }
    case "deleteTableRow": {
      const row = resolveAncestor(tr.doc, edit.nodeId, "tableRow", resolve);
      if (!row) return void rejectOrMiss(tr.doc, edit.nodeId, result);
      deleteContainerChild(tr, row);
      result.changed.push(edit.nodeId);
      return;
    }
  }
}

/** An id the document holds but in the wrong shape is rejected, not "not found". */
function rejectOrMiss(doc: PmNode, nodeId: string, result: StructuralEditResult): void {
  if (findNodeById(doc, nodeId)) result.rejected.push(nodeId);
  else result.notFound.push(nodeId);
}

/**
 * Apply structural edits in one transaction, so a batch is one undo step.
 * Tracking pairs matching move steps; unrelated edits remain separate review
 * decisions. Later edits resolve against the document the earlier ones left,
 * which is why each op re-reads `tr.doc` rather than a position captured up front.
 */
export function applyStructuralEdits(
  tr: Transaction,
  edits: StructuralSemanticEdit[],
): StructuralEditResult {
  const result: StructuralEditResult = { changed: [], notFound: [], rejected: [] };
  const resolve = createLiveResolver(tr);
  const moved = new Set<string>();
  for (const edit of edits) {
    // A step past the engine's limit is not tracked: replay stops and the
    // document is left mangled rather than reviewable. A move writes two
    // steps, so the budget has to be checked before the op, not after.
    const steps = edit.op === "moveBlock" || edit.op === "moveListItem" ? 2 : 1;
    if (tr.steps.length + steps > MAX_TRACKED_STEPS_PER_TR) {
      result.rejected.push("nodeId" in edit ? edit.nodeId : edit.anchorNodeId);
      continue;
    }
    applyOne(tr, edit, result, resolve, moved);
  }
  return result;
}
