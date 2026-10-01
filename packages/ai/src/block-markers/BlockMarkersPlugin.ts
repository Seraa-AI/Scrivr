/**
 * Plugin state for the block-marker layer: markers by the writer that set
 * them, in the order each writer gave them.
 *
 * Keyed by source rather than held as one list, because the review bridge and
 * the chat bridge both write here and neither owns the layer — a single list
 * would make every set the last writer's.
 */
import { Plugin, PluginKey } from "@scrivr/core/pm";
import type { Transaction } from "@scrivr/core/pm";
import type { PlacedBlockMarker } from "./types";

/** Markers by source, sources in first-write order. */
export type BlockMarkerState = ReadonlyMap<string, readonly PlacedBlockMarker[]>;

export const blockMarkersPluginKey = new PluginKey<BlockMarkerState>("blockMarkers");

/** Meta payload: a source's complete marker set, or null to clear it. */
export const BLOCK_MARKERS_SET = "blockMarkers:set";

export interface BlockMarkersSetMeta {
  source: string;
  markers: readonly PlacedBlockMarker[] | null;
}

function isSetMeta(value: unknown): value is BlockMarkersSetMeta {
  if (value === null || typeof value !== "object") return false;
  if (!("source" in value) || !("markers" in value)) return false;
  const { source, markers } = value;
  return typeof source === "string" && (markers === null || Array.isArray(markers));
}

export const blockMarkersPlugin = new Plugin<BlockMarkerState>({
  key: blockMarkersPluginKey,

  state: {
    init: () => new Map(),

    apply(tr: Transaction, prev: BlockMarkerState): BlockMarkerState {
      const meta: unknown = tr.getMeta(BLOCK_MARKERS_SET);
      if (!isSetMeta(meta)) return prev;

      const next = new Map(prev);
      if (meta.markers === null) next.delete(meta.source);
      else next.set(meta.source, meta.markers);
      return next;
    },
  },
});
