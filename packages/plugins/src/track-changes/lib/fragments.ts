import { Fragment, MarkType, Node as PMNode, NodeType, ResolvedPos, Schema } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";

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
import { CHANGE_OPERATION, CHANGE_STATUS, ExposedFragment } from "../types";

export function setFragmentAsInserted(inserted: Fragment, insertAttrs: NewInsertAttrs, schema: Schema) {
  const updatedInserted = loopContentAndMergeText(inserted, insertAttrs, schema);
  return updatedInserted.length === 0 ? Fragment.empty : Fragment.fromArray(updatedInserted);
}

export function setFragmentAsWrapChange(inserted: Fragment, attrs: NewEmptyAttrs, schema: Schema) {
  const content: PMNode[] = [];
  inserted.forEach(node => {
    content.push(
      node.type.create(
        { ...node.attrs, dataTracked: [addTrackIdIfDoesntExist(createNewWrapAttrs(attrs))] },
        setFragmentAsInserted(node.content, createNewInsertAttrs(attrs), schema),
        node.marks,
      ),
    );
  });
  return Fragment.from(content);
}

export function setFragmentAsMoveChange(fragment: Fragment, moveAttrs: NewMoveAttrs) {
  const content: PMNode[] = [];
  fragment.forEach(node => {
    content.push(
      node.type.create(
        { ...node.attrs, dataTracked: [
          ...(getBlockInlineTrackedData(node) ?? []).filter(record => record.operation !== CHANGE_OPERATION.move),
          addTrackIdIfDoesntExist({ ...moveAttrs,
            dependsOn: [...new Set([
              ...(moveAttrs.dependsOn ?? []),
              ...(getBlockInlineTrackedData(node) ?? [])
                .filter(record => record.operation === CHANGE_OPERATION.insert && record.status === CHANGE_STATUS.pending)
                .flatMap(record => record.creationId ? [record.creationId] : record.id ? [record.id] : []),
            ])],
            placementDependsOn: (getBlockInlineTrackedData(node) ?? [])
              .filter(record => record.operation === CHANGE_OPERATION.move && record.status === CHANGE_STATUS.pending)
              .flatMap(record => record.id ? [record.id] : []),
          }),
        ] },
        node.content,
        node.marks,
      ),
    );
  });
  return Fragment.from(content);
}

/** Add split change to the source node parent, and to the last child which is the split content. */
export function setFragmentAsNodeSplit(
  $pos: ResolvedPos,
  newTr: Transaction,
  inserted: Fragment,
  attrs: NewEmptyAttrs,
) {
  const lastChild = inserted.lastChild!;
  const referenceId = genId();

  const parentPos = $pos.before($pos.depth);
  const parent = $pos.node($pos.depth);
  const oldDataTracked = getBlockInlineTrackedData(parent) || [];
  newTr.setNodeMarkup(parentPos, undefined, {
    ...parent.attrs,
    dataTracked: [
      ...oldDataTracked.filter(c => c.operation !== "reference"),
      { ...addTrackIdIfDoesntExist(createNewReferenceAttrs({ ...attrs, status: CHANGE_STATUS.pending }, referenceId)) },
    ],
  });

  const splitSource = oldDataTracked.find(c => c.operation === "reference");
  const dataTracked = { ...createNewSplitAttrs({ ...attrs }), id: referenceId };

  if (lastChild.type.name === "list_item") {
    let firstChild = lastChild.content.firstChild!;
    firstChild = firstChild.type.create(
      { ...lastChild.attrs, dataTracked: splitSource ? [dataTracked, splitSource] : [dataTracked] },
      firstChild.content,
    );
    inserted = inserted.replaceChild(
      inserted.childCount - 1,
      lastChild.type.create(
        lastChild.attrs,
        lastChild.content.cut(firstChild.nodeSize).addToStart(firstChild),
      ),
    );
  } else {
    inserted = inserted.replaceChild(
      inserted.childCount - 1,
      lastChild.type.create(
        { ...lastChild.attrs, dataTracked: splitSource ? [dataTracked, splitSource] : [dataTracked] },
        lastChild.content,
      ),
    );
  }
  return inserted;
}

/** Cuts a fragment similar to Fragment.cut but also removes the parent node. */
export function cutFragment(matched: number, deleted: number, content: Fragment) {
  const newContent: PMNode[] = [];
  for (let i = 0; matched <= deleted && i < content.childCount; i += 1) {
    const child = content.child(i);
    if (!child.isText && child.content.size > 0) {
      const cut = cutFragment(matched + 1, deleted, child.content);
      matched = cut[0];
      newContent.push(...cut[1].content);
    } else if (child.isText && matched + child.nodeSize > deleted) {
      if (deleted - matched > 0) {
        newContent.push(child.cut(deleted - matched));
      } else {
        newContent.push(child);
      }
      matched = deleted + 1;
    } else {
      matched += child.nodeSize;
    }
  }
  return [matched, Fragment.fromArray(newContent)] as [number, ExposedFragment];
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
