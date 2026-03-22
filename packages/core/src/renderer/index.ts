export { setupCanvas, clearCanvas } from "./canvas";
export type { CanvasSetupOptions, CanvasSetupResult } from "./canvas";
export { renderPage } from "./PageRenderer";
export type { RenderPageOptions } from "./PageRenderer";
export {
  clearOverlay,
  renderCursor,
  renderSelection,
  renderGhostText,
  renderAiCaret,
  renderTrackedInsert,
  renderTrackedDelete,
} from "./OverlayRenderer";
export { CursorManager } from "./CursorManager";
export { ViewManager } from "./ViewManager";
export type { ViewManagerOptions } from "./ViewManager";
