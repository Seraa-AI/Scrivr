/** A marker says "look here" about a block, not what should change there. */
export interface BlockMarker {
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
  source: string;
}
