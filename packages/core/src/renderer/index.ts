export { setupCanvas, clearCanvas } from "./canvas";
export type { CanvasSetupOptions, CanvasSetupResult } from "./canvas";
export { renderPage, drawBlock } from "./PageRenderer";
export { paintBlock } from "./paintBlock";
export type { RenderPageOptions } from "./PageRenderer";
export {
  clearOverlay,
  renderCursor,
  renderSelection,
  renderGhostText,
  renderAiCaret,
  renderLabelledCaret,
  renderTrackedInsert,
  renderTrackedDelete,
  renderTrackedConflict,
  renderTrackedAttrChange,
  renderTrackedObject,
  renderTrackedFormatting,
  renderTrackedMove,
  renderTrackedRow,
} from "./OverlayRenderer";
export { CursorManager } from "./CursorManager";
export { TileManager } from "./TileManager";
export { MAX_ZOOM, MIN_ZOOM, resolveZoom, screenPixels, type ZoomRequest, type ZoomViewport } from "./zoom";
export type { TileManagerOptions } from "./TileManager";
