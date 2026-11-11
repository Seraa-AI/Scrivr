import { Plugin, type EditorState, type Transaction } from "prosemirror-state";
import { COLLAB_SYNC_META } from "./extensions/built-in/UniqueId";

/** Where a transaction came from: this client, or a collaborator's synced edit. */
export type MutationOrigin = "local" | "remote";

/** Why the editor turned an edit away. */
export type MutationDenialReason =
  /** This viewer may not author. A collaborator's edits still land. */
  | "read-only"
  /** The document no longer changes, from anyone. */
  | "sealed";

/** Payload of the `"mutationDenied"` event. */
export interface MutationDenied {
  reason: MutationDenialReason;
  origin: MutationOrigin;
}

export interface MutationLocks {
  readOnly: boolean;
  sealed: boolean;
}

/**
 * Judges a transaction by what applying it produced, not by the request:
 * `appendTransaction` can answer a caret move with a document change.
 * Returns `null` when every transaction in `applied` may land.
 */
export function mutationDenial(
  root: Transaction,
  applied: readonly Transaction[],
  locks: MutationLocks,
): MutationDenied | null {
  return applied.some((tr) => tr.docChanged) ? lockOn(root, locks) : null;
}

/** The refusal any document change made with `tr` would meet, or `null`. */
export function lockOn(tr: Transaction, locks: MutationLocks): MutationDenied | null {
  const origin: MutationOrigin = tr.getMeta(COLLAB_SYNC_META) ? "remote" : "local";
  if (locks.sealed) return { reason: "sealed", origin };
  if (locks.readOnly && origin === "local") return { reason: "read-only", origin };
  return null;
}

/**
 * Applies `tr` to `state` as the editor's locks allow, reporting a refusal
 * itself. Returns the new state, or `null` when the transaction was refused.
 */
export type MutationGate = (state: EditorState, tr: Transaction) => EditorState | null;

/** The gate of a surface no editor owns: everything lands. */
export const applyUngated: MutationGate = (state, tr) => state.applyTransaction(tr).state;

/**
 * Turns away every document change while `holding()`. The editor holds still
 * while it applies a caret move to a locked document, so the move lands
 * without the edits other plugins append to it — a trailing paragraph, say.
 */
export function holdStill(holding: () => boolean): Plugin {
  return new Plugin({ filterTransaction: (tr) => !(tr.docChanged && holding()) });
}
