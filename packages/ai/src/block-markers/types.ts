/**
 * A marker says "look here" about a block, and nothing about what should
 * change there.
 */

/** What a writer hangs on a block. */
export interface BlockMarker {
  /** The block it is about. */
  nodeId: string;
  /**
   * What sort of marker this is, in the writer's own vocabulary — "pass",
   * "human-review", "question". The layer does not interpret it; a renderer
   * styles by it.
   */
  kind: string;
  /** One line saying why the marker is here. */
  summary: string;
}

/** A marker as the layer holds it, with the writer that put it there. */
export interface PlacedBlockMarker extends BlockMarker {
  /**
   * Who set it. Several writers share this layer and none of them owns it, so
   * a writer replaces and clears its own markers by naming itself.
   */
  source: string;
}
