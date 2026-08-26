import { Fragment, Node as PMNode } from "@scrivr/core/pm";

import { ExposedFragment, ExposedSlice } from "../types";

function getMergedNode(
  node: PMNode,
  currentDepth: number,
  depth: number,
  first: boolean,
): {
  mergedNodeContent: ExposedFragment;
  unmergedContent: ExposedFragment | undefined;
} {
  if (currentDepth === depth) {
    return { mergedNodeContent: node.content as ExposedFragment, unmergedContent: undefined };
  }
  const result: PMNode[] = [];
  let merged = Fragment.empty as ExposedFragment;
  node.content.forEach((n, _, i) => {
    if ((first && i === 0) || (!first && i === node.childCount - 1)) {
      const { mergedNodeContent, unmergedContent } = getMergedNode(n, currentDepth + 1, depth, first);
      merged = mergedNodeContent;
      if (unmergedContent) result.push(...unmergedContent.content);
    } else {
      result.push(n);
    }
  });
  return {
    mergedNodeContent: merged,
    unmergedContent: result.length > 0 ? (Fragment.fromArray(result) as ExposedFragment) : undefined,
  };
}

/**
 * Filters merged nodes from an open insertSlice to manually merge them and prevent unwanted deletions.
 */
export function splitSliceIntoMergedParts(insertSlice: ExposedSlice, mergeEqualSides = false) {
  const {
    openStart,
    openEnd,
    content: { firstChild, lastChild, content: nodes },
  } = insertSlice;

  let updatedSliceNodes = nodes;
  const mergeSides = openStart !== openEnd || mergeEqualSides;

  const firstMergedNode =
    openStart > 0 && mergeSides && firstChild ? getMergedNode(firstChild, 1, openStart, true) : undefined;
  const lastMergedNode =
    openEnd > 0 && mergeSides && lastChild ? getMergedNode(lastChild, 1, openEnd, false) : undefined;

  if (firstMergedNode) {
    updatedSliceNodes = updatedSliceNodes.slice(1);
    if (firstMergedNode.unmergedContent) {
      updatedSliceNodes = [...firstMergedNode.unmergedContent.content, ...updatedSliceNodes];
    }
  }
  if (lastMergedNode) {
    updatedSliceNodes = updatedSliceNodes.slice(0, -1);
    if (lastMergedNode.unmergedContent) {
      updatedSliceNodes = [...updatedSliceNodes, ...lastMergedNode.unmergedContent.content];
    }
  }

  return { updatedSliceNodes, firstMergedNode, lastMergedNode };
}
