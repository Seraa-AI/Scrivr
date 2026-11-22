// Imported through the package barrel on purpose: these are what a signing
// host and its collaboration server build on, and `tsc` fails here the moment
// one stops being exported.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  FieldCompletion,
  REVISION_MAP_NAME,
  ReadingProgress,
  docFromYDoc,
  isSealed,
  matchesSnapshot,
  readRevisionStamp,
  moveFieldFocus,
  requestField,
  resetToSnapshot,
  snapshotFromYDoc,
  stampEditable,
  stampSeal,
  watchRevision,
  type EditableStamp,
  type FieldCompletionOptions,
  type FieldValue,
  type ReadingEvent,
  type ReadingProgressOptions,
  type RevisionCallbacks,
  type RevisionStamp,
  type RevisionWatcher,
  type SealedStamp,
  type SigningFieldDrawing,
} from "../index";

describe("what a signing host builds on", () => {
  it("is reachable from the package: the room's revision, reading, and completion", () => {
    const room = new Y.Doc();
    const sealed: SealedStamp = { mode: "sealed", revisionId: "r1", contentHash: "sha256:00", sealedAt: "2026-11-11" };
    const editable: EditableStamp = { mode: "editable", revisionId: "r2", parentRevisionId: "r1" };
    stampSeal(room, sealed);
    const stamp: RevisionStamp | null = readRevisionStamp(room);
    const callbacks: RevisionCallbacks = { onSealed: () => {}, onRevision: () => {} };
    const reading: ReadingProgressOptions = { onReading: (event: ReadingEvent) => void event };
    const value: FieldValue = { kind: "checkbox", checked: true };
    const completion: Partial<FieldCompletionOptions> = { onFieldRequest: async () => value };
    const paint = (_ctx: CanvasRenderingContext2D, field: SigningFieldDrawing): boolean => field.own;
    const watcher: RevisionWatcher | null = null;
    stampEditable(room, editable);

    expect(stamp).toEqual(sealed);
    expect(isSealed(room)).toBe(false);
    expect(room.share.has(REVISION_MAP_NAME)).toBe(true);
    expect([docFromYDoc, matchesSnapshot, resetToSnapshot, snapshotFromYDoc, watchRevision, moveFieldFocus, requestField, paint].every((f) => typeof f === "function")).toBe(true);
    expect([ReadingProgress.configure(reading).name, FieldCompletion.configure(completion).name, callbacks.onSealed !== undefined, watcher]).toEqual([
      "readingProgress",
      "fieldCompletion",
      true,
      null,
    ]);
  });
});
