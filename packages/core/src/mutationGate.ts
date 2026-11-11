import type { Transaction } from "prosemirror-state";
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
  if (!applied.some((tr) => tr.docChanged)) return null;
  const origin: MutationOrigin = root.getMeta(COLLAB_SYNC_META) ? "remote" : "local";
  if (locks.sealed) return { reason: "sealed", origin };
  if (locks.readOnly && origin === "local") return { reason: "read-only", origin };
  return null;
}

/** Decides whether `applied` may land, reporting a refusal itself. */
export type MutationGate = (root: Transaction, applied: readonly Transaction[]) => boolean;
