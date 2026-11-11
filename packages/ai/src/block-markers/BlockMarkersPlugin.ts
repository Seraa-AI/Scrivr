/**
 * Plugin state for the block-marker layer.
 *
 * Keyed by source rather than held as one list, because several bridges write
 * here and none of them owns the layer — a single list would make every set
 * the last writer's.
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
  if (typeof source !== "string") return false;
  return markers === null || (Array.isArray(markers) && markers.every(isPlacedMarker));
}

/**
 * Every element, not just the array — this key is public, so a host can
 * dispatch it inside its own transaction, and state typed as markers has to
 * hold markers. A `nodeId` that is not a string is the one that bites: a null
 * id matches any block the editor never stamped.
 */
function isPlacedMarker(value: unknown): value is PlacedBlockMarker {
  if (value === null || typeof value !== "object") return false;
  return (
    "source" in value &&
    typeof value.source === "string" &&
    "nodeId" in value &&
    typeof value.nodeId === "string" &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "summary" in value &&
    typeof value.summary === "string"
  );
}

export const blockMarkersPlugin = new Plugin<BlockMarkerState>({
  key: blockMarkersPluginKey,

  state: {
    init: () => new Map(),

    apply(tr: Transaction, prev: BlockMarkerState): BlockMarkerState {
      const meta: unknown = tr.getMeta(BLOCK_MARKERS_SET);
      if (!isSetMeta(meta)) return prev;

      // Clearing a source that never wrote must not produce a new Map:
      // identity is what every subscriber and the overlay repaint off.
      if (meta.markers === null && !prev.has(meta.source)) return prev;

      const next = new Map(prev);
      if (meta.markers === null) next.delete(meta.source);
      else next.set(meta.source, meta.markers);
      return next;
    },
  },
});
