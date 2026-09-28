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
import { findNodeById, spansToFragment } from "@scrivr/core";
import type { Node as PmNode, Schema, Transaction } from "@scrivr/core/pm";

import type { SemanticBlockInput, SemanticCellInput, StructuralSemanticEdit } from "../schema/edit";
import { toCoreSpans } from "./spans";

export interface StructuralEditResult {
  /** nodeIds whose op produced a change. */
  changed: string[];
  /** nodeIds naming a node the document does not hold. */
  notFound: string[];
  /** nodeIds that resolved, but to a node the op cannot act on. */
  rejected: string[];
}

/** The node an id names, plus the ancestor of `type` that encloses it. */
function resolveAncestor(
  doc: PmNode,
  nodeId: string,
  typeName: string,
): { node: PmNode; pos: number } | null {
  const found = findNodeById(doc, nodeId);
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

/** The top-level block containing `nodeId` — what `insertBlock` sits beside. */
function resolveTopLevel(doc: PmNode, nodeId: string): { node: PmNode; pos: number } | null {
  const found = findNodeById(doc, nodeId);
  if (!found) return null;
  const $pos = doc.resolve(found.pos);
  return $pos.depth === 0
    ? found
    : { node: $pos.node(1), pos: $pos.before(1) };
}

function buildBlock(schema: Schema, block: SemanticBlockInput): PmNode | null {
  const type = schema.nodes[block.type];
  if (!type) return null;
  const attrs = { ...block.attrs, ...(block.level !== undefined ? { level: block.level } : {}) };
  return type.createAndFill(attrs, spansToFragment(toCoreSpans(block.spans ?? []), schema));
}

function buildCell(schema: Schema, cell: SemanticCellInput | undefined): PmNode | null {
  const cellType = schema.nodes["tableCell"];
  const paragraph = schema.nodes["paragraph"];
  if (!cellType || !paragraph) return null;
  const content = paragraph.createAndFill({}, spansToFragment(toCoreSpans(cell?.spans ?? []), schema));
  return content ? cellType.createAndFill(cell?.attrs ?? {}, content) : null;
}

/**
 * Apply one structural op to `tr`. Returns the id it acted on, or records why
 * it could not — a missing anchor and a wrong-shaped anchor are different
 * answers, and a caller routing agent output needs to tell them apart.
 */
function applyOne(tr: Transaction, edit: StructuralSemanticEdit, result: StructuralEditResult): void {
  const schema = tr.doc.type.schema;

  switch (edit.op) {
    case "insertBlock": {
      const anchor = resolveTopLevel(tr.doc, edit.anchorNodeId);
      if (!anchor) return void result.notFound.push(edit.anchorNodeId);
      const node = buildBlock(schema, edit.block);
      if (!node) return void result.rejected.push(edit.anchorNodeId);
      tr.insert(edit.position === "before" ? anchor.pos : anchor.pos + anchor.node.nodeSize, node);
      result.changed.push(edit.anchorNodeId);
      return;
    }
    case "deleteBlock": {
      const target = resolveTopLevel(tr.doc, edit.nodeId);
      if (!target) return void result.notFound.push(edit.nodeId);
      tr.delete(target.pos, target.pos + target.node.nodeSize);
      result.changed.push(edit.nodeId);
      return;
    }
    case "insertListItem": {
      const item = resolveAncestor(tr.doc, edit.anchorNodeId, "listItem");
      if (!item) return void rejectOrMiss(tr.doc, edit.anchorNodeId, result);
      const itemType = schema.nodes["listItem"];
      const paragraph = schema.nodes["paragraph"];
      if (!itemType || !paragraph) return void result.rejected.push(edit.anchorNodeId);
      const body = paragraph.createAndFill(edit.item.attrs ?? {}, spansToFragment(toCoreSpans(edit.item.spans), schema));
      const node = body && itemType.createAndFill({}, body);
      if (!node) return void result.rejected.push(edit.anchorNodeId);
      tr.insert(edit.position === "before" ? item.pos : item.pos + item.node.nodeSize, node);
      result.changed.push(edit.anchorNodeId);
      return;
    }
    case "deleteListItem": {
      const item = resolveAncestor(tr.doc, edit.nodeId, "listItem");
      if (!item) return void rejectOrMiss(tr.doc, edit.nodeId, result);
      tr.delete(item.pos, item.pos + item.node.nodeSize);
      result.changed.push(edit.nodeId);
      return;
    }
    case "insertTableRow": {
      const row = resolveAncestor(tr.doc, edit.anchorNodeId, "tableRow");
      if (!row) return void rejectOrMiss(tr.doc, edit.anchorNodeId, result);
      const rowType = schema.nodes["tableRow"];
      if (!rowType) return void result.rejected.push(edit.anchorNodeId);
      // The anchor row sets the width: a row with fewer cells than its
      // neighbours is a broken table, and the agent counting columns correctly
      // is not something to rely on.
      const cells: PmNode[] = [];
      for (let i = 0; i < row.node.childCount; i++) {
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
      const row = resolveAncestor(tr.doc, edit.nodeId, "tableRow");
      if (!row) return void rejectOrMiss(tr.doc, edit.nodeId, result);
      tr.delete(row.pos, row.pos + row.node.nodeSize);
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
 * Apply structural edits in one transaction, so a batch is one undo step and one
 * review unit. Later edits resolve against the document the earlier ones left,
 * which is why each op re-reads `tr.doc` rather than a position captured up front.
 */
export function applyStructuralEdits(
  tr: Transaction,
  edits: StructuralSemanticEdit[],
): StructuralEditResult {
  const result: StructuralEditResult = { changed: [], notFound: [], rejected: [] };
  for (const edit of edits) applyOne(tr, edit, result);
  return result;
}
