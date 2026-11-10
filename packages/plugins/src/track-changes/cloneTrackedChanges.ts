import { Fragment, type Mark, type Node } from "@scrivr/core/pm";
import type { CloneHandler } from "@scrivr/core";

const TRACKED_ID_FIELDS: ReadonlyArray<string> =
  ["id", "referenceId", "moveNodeId", "moveId", "groupId", "creationId", "deletionId", "continuesId"];
const TRACKED_ID_LIST_FIELDS: ReadonlyArray<string> = ["dependsOn", "placementDependsOn"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Re-key track-change identity while preserving all internal links. */
export const cloneTrackedChanges: CloneHandler = ({ doc, idMap, newId, recordId }) => {
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
    if (!isRecord(value)) return value;
    const entry = value;
    let next: Record<string, unknown> | undefined;
    for (const field of TRACKED_ID_FIELDS) {
      const oldId = entry[field];
      if (typeof oldId !== "string" || oldId.length === 0) continue;
      next ??= { ...entry };
      next[field] = remap(oldId);
    }
    for (const field of TRACKED_ID_LIST_FIELDS) {
      const ids = entry[field];
      if (!Array.isArray(ids)) continue;
      next ??= { ...entry };
      next[field] = ids.map(id => typeof id === "string" ? remap(id) : id);
    }
    // A block id, re-keyed by core with the block it names.
    const originalNodeId = entry["originalNodeId"];
    const clonedNodeId = typeof originalNodeId === "string" ? idMap.get(originalNodeId) : undefined;
    if (clonedNodeId !== undefined) {
      next ??= { ...entry };
      next["originalNodeId"] = clonedNodeId;
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
