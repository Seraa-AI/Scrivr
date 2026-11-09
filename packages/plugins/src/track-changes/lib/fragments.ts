import { Fragment, MarkType, Node as PMNode, NodeType, ResolvedPos, Schema } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { blockIdOf } from "@scrivr/core";

import {
  addTrackIdIfDoesntExist,
  createNewInsertAttrs,
  createNewReferenceAttrs,
  createNewSplitAttrs,
  createNewWrapAttrs,
  equalMarks,
  genId,
  getBlockInlineTrackedData,
  getTextNodeTrackedMarkData,
  NewEmptyAttrs,
  NewInsertAttrs,
  NewMoveAttrs,
  NewTrackedAttrs,
} from "../helpers";
import { CHANGE_OPERATION, CHANGE_STATUS } from "../types";
import { isShadowNode, type ShadowRange } from "../liveNode";

export function setFragmentAsInserted(inserted: Fragment, insertAttrs: NewInsertAttrs, schema: Schema) {
  const updatedInserted = loopContentAndMergeText(inserted, insertAttrs, schema);
  return updatedInserted.length === 0 ? Fragment.empty : Fragment.fromArray(updatedInserted);
}

export function setFragmentAsWrapChange(inserted: Fragment, attrs: NewEmptyAttrs, schema: Schema) {
  const content: PMNode[] = [];
  inserted.forEach(node => {
    const wrap = addTrackIdIfDoesntExist(createNewWrapAttrs(attrs));
    content.push(
      node.type.create(
        { ...node.attrs, dataTracked: [wrap] },
        // What the wrapper brought with it exists only as part of wrapping.
        setFragmentAsInserted(node.content, { ...createNewInsertAttrs(attrs), ...(wrap.id ? { creationId: wrap.id } : {}) }, schema),
        node.marks,
      ),
    );
  });
  return Fragment.from(content);
}

export function setFragmentAsMoveChange(fragment: Fragment, moveAttrs: NewMoveAttrs) {
  const content: PMNode[] = [];
  fragment.forEach(node => {
    const records = getBlockInlineTrackedData(node) ?? [];
    const pending = (operation: CHANGE_OPERATION) =>
      records.filter(record => record.operation === operation && record.status === CHANGE_STATUS.pending);
    const pendingCreations = pending(CHANGE_OPERATION.insert)
      .flatMap(record => record.creationId ? [record.creationId] : record.id ? [record.id] : []);
    const earlierPlacements = pending(CHANGE_OPERATION.move).flatMap(record => record.id ? [record.id] : []);
    content.push(
      node.type.create(
        { ...node.attrs, dataTracked: [
          ...records.filter(record => record.operation !== CHANGE_OPERATION.move),
          addTrackIdIfDoesntExist({ ...moveAttrs,
            dependsOn: [...new Set([...(moveAttrs.dependsOn ?? []), ...pendingCreations])],
            placementDependsOn: earlierPlacements,
          }),
        ] },
        node.content,
        node.marks,
      ),
    );
  });
  return Fragment.from(content);
}

/**
 * Add split change to the source node parent, and to the last child which is
 * the split content. `depth` is how many levels the break splits: one for a
 * paragraph, two for a list item and its paragraph; the records go on the
 * outermost. `originalNodeId` is the id that block had before the split.
 */
export function setFragmentAsNodeSplit(
  $pos: ResolvedPos,
  depth: number,
  newTr: Transaction,
  inserted: Fragment,
  attrs: NewEmptyAttrs,
  originalNodeId: string | null,
) {
  const lastChild = inserted.lastChild!;
  const referenceId = genId();

  const parentPos = $pos.before($pos.depth - depth + 1);
  const parent = $pos.node($pos.depth - depth + 1);
  const oldDataTracked = getBlockInlineTrackedData(parent) || [];
  newTr.setNodeMarkup(parentPos, undefined, {
    ...parent.attrs,
    dataTracked: [
      ...oldDataTracked.filter(c => c.operation !== "reference"),
      { ...addTrackIdIfDoesntExist(createNewReferenceAttrs({ ...attrs, status: CHANGE_STATUS.pending }, referenceId, originalNodeId)) },
    ],
  });

  const splitSource = oldDataTracked.find(c => c.operation === "reference");
  const dataTracked = { ...createNewSplitAttrs({ ...attrs }), id: referenceId };

  inserted = inserted.replaceChild(
    inserted.childCount - 1,
    lastChild.type.create(
      { ...lastChild.attrs, dataTracked: splitSource ? [dataTracked, splitSource] : [dataTracked] },
      lastChild.content,
    ),
  );
  return inserted;
}

/**
 * Written content with any block id `doc` already carries cleared. A split or
 * a list Enter copies its source's id onto the new block, and a paste copies
 * the original's; the id stays with the block that had it, and `UniqueId` gives
 * each new one its own. Which nodes carry an id is core's `blockIdOf`.
 */
export function withoutTakenIds(fragment: Fragment, doc: PMNode, movedFrom: readonly ShadowRange[] = []): Fragment {
  const taken = new Set<string>();
  doc.descendants((node, pos) => {
    const id = blockIdOf(node);
    if (id !== null && !isShadowNode(node, pos, movedFrom)) taken.add(id);
  });
  const clear = (node: PMNode): PMNode => {
    if (node.isText) return node;
    const id = blockIdOf(node);
    const attrs = id !== null && taken.has(id) ? { ...node.attrs, nodeId: null } : node.attrs;
    if (node.isLeaf) return attrs === node.attrs ? node : node.type.create(attrs, null, node.marks);
    const content: PMNode[] = [];
    node.forEach((child) => content.push(clear(child)));
    return node.type.create(attrs, Fragment.from(content), node.marks);
  };
  const out: PMNode[] = [];
  fragment.forEach((node) => out.push(clear(node)));
  return Fragment.from(out);
}

/** The mark standing in for this operation on text. */
function trackedMarkType(newTrackAttrs: NewTrackedAttrs, schema: Schema) {
  return newTrackAttrs.operation === CHANGE_OPERATION.insert
    ? schema.marks.trackedInsert
    : schema.marks.trackedDelete;
}

function markInlineNodeChange(node: PMNode, mark: MarkType, newTrackAttrs: NewTrackedAttrs, schema: Schema) {
  const filtered = node.marks.filter(
    m => m.type !== schema.marks.trackedInsert && m.type !== schema.marks.trackedDelete,
  );
  const createdMark = mark.create({ dataTracked: addTrackIdIfDoesntExist(newTrackAttrs) });
  return node.mark(filtered.concat(createdMark));
}

function loopContentAndMergeText(content: Fragment, newTrackAttrs: NewTrackedAttrs, schema: Schema, parent?: NodeType) {
  const updatedChildren: PMNode[] = [];
  for (let i = 0; i < content.childCount; i += 1) {
    const recursed = recurseNodeContent(content.child(i), newTrackAttrs, schema, parent);
    const prev = i > 0 ? updatedChildren[i - 1] : null;
    if (
      prev?.isText &&
      recursed.isText &&
      equalMarks(prev, recursed) &&
      getTextNodeTrackedMarkData(prev, schema)?.some(d => d.operation === CHANGE_OPERATION.insert)
    ) {
      updatedChildren.splice(i - 1, 1, schema.text("" + prev.text + recursed.text, prev.marks));
    } else {
      updatedChildren.push(recursed);
    }
  }
  return updatedChildren;
}

function recurseNodeContent(node: PMNode, newTrackAttrs: NewTrackedAttrs, schema: Schema, parent?: NodeType) {
  const mark = trackedMarkType(newTrackAttrs, schema);
  if (node.isText) {
    // Marks and node attrs are the two representations, and a parent admitting
    // no marks has only the second. Its own stamp already records the whole
    // subtree, so marking the text here would just build content its type
    // rejects — invisibly, since create() does not validate.
    if (!mark || (parent && !parent.allowsMarkType(mark))) return node;
    return markInlineNodeChange(node, mark, newTrackAttrs, schema);
  } else if (node.isBlock || node.isInline) {
    const entry = addTrackIdIfDoesntExist(newTrackAttrs);
    const creationId = newTrackAttrs.creationId ?? (newTrackAttrs.operation === CHANGE_OPERATION.insert ? entry.id : undefined);
    const composed = creationId ? { ...newTrackAttrs, creationId } : newTrackAttrs;
    const updatedChildren = loopContentAndMergeText(node.content, composed, schema, node.type);
    return node.type.create(
      { ...node.attrs, dataTracked: [{ ...entry, ...(creationId ? { creationId } : {}) }] },
      Fragment.fromArray(updatedChildren),
      node.marks,
    );
  }
  console.error(`unhandled node type: "${node.type.name}"`, node);
  return node;
}
