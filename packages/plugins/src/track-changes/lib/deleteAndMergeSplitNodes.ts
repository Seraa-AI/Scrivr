import { Fragment, Node as PMNode, Schema, Slice } from "@scrivr/core/pm";

import { createNewInsertAttrs, NewEmptyAttrs } from "../helpers";
import { setFragmentAsInserted } from "./fragments";
import { splitSliceIntoMergedParts } from "./splitSliceIntoMergedParts";
import { isLiftStepForGap } from "../step-trackers/qualifiers";
import { ChangeStep, ExposedFragment, ExposedSlice } from "../types";

/**
 * Applies deletion to the doc without actually deleting nodes that have not been inserted.
 *
 * The hairiest part of this library: splits the inserted slice into merged pieces if it is open
 * on either end, then iterates the deleted range checking if each node was completely deleted or
 * only partially touched by the slice.
 */
export function deleteAndMergeSplitNodes(
  from: number,
  to: number,
  gap: { start: number; end: number; slice: Slice; insert: number } | undefined,
  startDoc: PMNode,
  schema: Schema,
  trackAttrs: NewEmptyAttrs,
  insertSlice: ExposedSlice,
) {
  const steps: ChangeStep[] = [];

  if (from === to) {
    return { newSliceContent: insertSlice.content, sliceWasSplit: false, steps };
  }

  const { openStart, openEnd } = insertSlice;
  const { updatedSliceNodes, firstMergedNode, lastMergedNode } =
    splitSliceIntoMergedParts(insertSlice, gap !== undefined);

  let mergingStartSide = true;

  startDoc.nodesBetween(from, to, (node, pos) => {
    const nodeEnd = pos + node.nodeSize;
    const wasWithinGap =
      gap &&
      ((!node.isText && pos >= gap.start) ||
        (node.isText && pos >= gap.start && nodeEnd <= gap.end));

    if (nodeEnd > from && !wasWithinGap) {
      const nodeCompletelyDeleted = pos >= from && nodeEnd <= to;
      const endTokenDeleted = nodeEnd <= to;
      const startTokenDeleted = pos >= from;

      if (
        node.isText ||
        (!endTokenDeleted && startTokenDeleted) ||
        (endTokenDeleted && !startTokenDeleted)
      ) {
        if (!endTokenDeleted && startTokenDeleted) {
          mergingStartSide = false;
        }

        const depth = startDoc.resolve(pos).depth;
        const mergeContent = mergingStartSide
          ? firstMergedNode?.mergedNodeContent
          : lastMergedNode?.mergedNodeContent;

        const mergeStartNode =
          endTokenDeleted && openStart > 0 && depth === openStart && mergeContent && mergeContent.size;
        const mergeEndNode = startTokenDeleted && openEnd > 0 && depth === openEnd && mergeContent;
        const mergeEndNodeNotEmpty = mergeEndNode && mergeContent.size;

        if (mergeEndNode && !mergeEndNodeNotEmpty && gap) {
          if (isLiftStepForGap(gap, node, to)) {
            gap.slice.content.forEach((node, offset) => {
              steps.push({
                type: "delete-node",
                pos: gap.start + offset,
                nodeEnd: gap.start + offset + node.nodeSize,
                node,
              });
            });
          }
        }

        if (mergeStartNode || mergeEndNodeNotEmpty) {
          steps.push({
            type: "merge-fragment",
            pos,
            mergePos: mergeStartNode ? nodeEnd - openStart : pos + openEnd,
            from,
            to,
            node,
            fragment: setFragmentAsInserted(
              mergeContent,
              createNewInsertAttrs(trackAttrs),
              schema,
            ) as ExposedFragment,
          });
        } else if (node.isText) {
          steps.push({
            type: "delete-text",
            pos,
            from: Math.max(pos, from),
            to: Math.min(nodeEnd, to),
            node,
          });
        }
        // startTokenDeleted without mergeEndNode — intentionally skipped (see comments in original)
      } else if (nodeCompletelyDeleted) {
        steps.push({ type: "delete-node", pos, nodeEnd, node });
      }
    }
  });

  return {
    sliceWasSplit: !!(firstMergedNode || lastMergedNode),
    newSliceContent: updatedSliceNodes
      ? Fragment.fromArray(updatedSliceNodes)
      : insertSlice.content,
    steps,
  };
}
