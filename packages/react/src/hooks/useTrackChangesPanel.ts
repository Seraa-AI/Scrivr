import { useEffect, useState } from "react";
import type { IBaseEditor } from "@scrivr/core";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  trackChangesPluginKey,
} from "@scrivr/plugins";
import { useReviewAction } from "./useReviewAction";
import type { TextChange, TrackedChange } from "@scrivr/plugins";

export type TrackChangesDisplayItem =
  | {
      kind: "replacement";
      deleteChange: TextChange;
      insertChange: TextChange;
      ids: string[];
      authorID: string;
    }
  | {
      kind: "single";
      change: TrackedChange;
    };

export function useTrackChangesPanel(editor: IBaseEditor | null) {
  const [changes, setChanges] = useState<TrackedChange[]>([]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const pluginState = trackChangesPluginKey.getState(editor.getState());
      const all = pluginState?.changeSet?.changes ?? [];
      setChanges(
        all.filter((c) => c.dataTracked.status === CHANGE_STATUS.pending),
      );
    };
    update();
    return editor.subscribe(update);
  }, [editor]);

  const items = buildDisplayItems(changes);
  const allIds = changes.map((c) => c.id);
  const review = useReviewAction(editor);

  // These return the outcome: a caller driving the hook directly needs the same
  // answer the panel gets, not a boolean it has to guess at.
  const acceptAll = () => review.review("accepted", allIds);
  const rejectAll = () => review.review("rejected", allIds);
  const accept = (ids: string[]) => review.review("accepted", ids);
  const reject = (ids: string[]) => review.review("rejected", ids);

  return {
    changes,
    items,
    review,
    isEmpty: items.length === 0,
    acceptAll,
    rejectAll,
    accept,
    reject,
  };
}

function buildDisplayItems(changes: TrackedChange[]): TrackChangesDisplayItem[] {
  const byGroupId = new Map<string, TrackedChange[]>();
  const ungrouped: TrackedChange[] = [];

  for (const c of changes) {
    const gid = (c.dataTracked as Record<string, unknown>).groupId as
      | string
      | undefined;
    if (gid) {
      if (!byGroupId.has(gid)) byGroupId.set(gid, []);
      byGroupId.get(gid)!.push(c);
    } else {
      ungrouped.push(c);
    }
  }

  const items: TrackChangesDisplayItem[] = [];

  for (const group of byGroupId.values()) {
    const del = group.find(
      (c) =>
        c.type === "text-change" &&
        c.dataTracked.operation === CHANGE_OPERATION.delete,
    ) as TextChange | undefined;
    const ins = group.find(
      (c) =>
        c.type === "text-change" &&
        c.dataTracked.operation === CHANGE_OPERATION.insert,
    ) as TextChange | undefined;

    if (del && ins) {
      items.push({
        kind: "replacement",
        deleteChange: del,
        insertChange: ins,
        ids: group.map((c) => c.id),
        authorID: del.dataTracked.authorID,
      });
    } else {
      group.forEach((c) => items.push({ kind: "single", change: c }));
    }
  }

  ungrouped.forEach((c) => items.push({ kind: "single", change: c }));

  items.sort((a, b) => {
    const af =
      a.kind === "replacement"
        ? Math.min(a.deleteChange.from, a.insertChange.from)
        : a.change.from;
    const bf =
      b.kind === "replacement"
        ? Math.min(b.deleteChange.from, b.insertChange.from)
        : b.change.from;
    return af - bf;
  });

  return items;
}
