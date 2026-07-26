import { Fragment, type Mark, type Node } from "prosemirror-model";
import type { CloneHandler } from "@scrivr/core";

const TRACKED_ID_FIELDS = ["id", "referenceId", "moveNodeId", "groupId"] as const;

/** Re-key track-change identity while preserving all internal links. */
export const cloneTrackedChanges: CloneHandler = ({ doc, newId, recordId }) => {
  const trackedIdMap = new Map<string, string>();
  const remap = (oldId: string): string => {
    let replacement = trackedIdMap.get(oldId);
    if (!replacement) {
      replacement = newId("trackChange", oldId);
      trackedIdMap.set(oldId, replacement);
      recordId("trackChange", oldId, replacement);
    }
    return replacement;
  };
  const cloneEntry = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const entry = value as Record<string, unknown>;
    let next: Record<string, unknown> | undefined;
    for (const field of TRACKED_ID_FIELDS) {
      const oldId = entry[field];
      if (typeof oldId !== "string" || oldId.length === 0) continue;
      next ??= { ...entry };
      next[field] = remap(oldId);
    }
    return next ?? value;
  };
  const cloneDataTracked = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(cloneEntry) : cloneEntry(value);
  const cloneAttrs = (attrs: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
    if (!("dataTracked" in attrs)) return attrs;
    const dataTracked = cloneDataTracked(attrs["dataTracked"]);
    return dataTracked === attrs["dataTracked"] ? attrs : { ...attrs, dataTracked };
  };
  const cloneMark = (mark: Mark): Mark => {
    const attrs = cloneAttrs(mark.attrs);
    return attrs === mark.attrs ? mark : mark.type.create(attrs);
  };
  const walk = (node: Node): Node => {
    const marks = node.marks.map(cloneMark);
    if (node.isText) return node.mark(marks);
    const children: Node[] = [];
    node.forEach((child) => children.push(walk(child)));
    return node.type.create(cloneAttrs(node.attrs), Fragment.fromArray(children), marks);
  };
  return walk(doc);
};
