export { setupCanvas, clearCanvas } from "./canvas";
export type { CanvasSetupOptions, CanvasSetupResult } from "./canvas";
export { renderPage, drawBlock } from "./PageRenderer";
export type { RenderPageOptions } from "./PageRenderer";
export {
  clearOverlay,
  renderCursor,
  renderSelection,
  renderGhostText,
  renderAiCaret,
  renderTrackedInsert,
  renderTrackedDelete,
  renderTrackedConflict,
  renderTrackedAttrChange,
} from "./OverlayRenderer";
export { CursorManager } from "./CursorManager";
export { TileManager } from "./TileManager";
export type { TileManagerOptions } from "./TileManager";
