/**
 * ResizeController — generic resize handle geometry, hit-testing, and rendering.
 *
 * Stateless utility used by ViewManager for image resize. Can be reused by
 * any future element that needs 8-point resize handles (tables, float images,
 * widgets, etc.) without duplicating the geometry logic.
 */

export interface ResizeHandle {
  /** Position identifier: TL TC TR | ML MR | BL BC BR */
  id: string;
  /** Handle center x in canvas coordinates */
  hx: number;
  /** Handle center y in canvas coordinates */
  hy: number;
  /** CSS cursor to show when hovering / dragging this handle */
  cursor: string;
}

/** Side length of each drawn square handle, in logical CSS pixels. */
export const HANDLE_SIZE = 7;

const HANDLE_HALF = HANDLE_SIZE / 2;
const HANDLE_COLOR = "#1a73e8";
/** Hit radius — slightly larger than the drawn size for easier grabbing. */
const HIT_RADIUS = (HANDLE_SIZE + 5) / 2;

/**
 * Returns the 8 handle descriptors for a rect defined by (x, y, w, h).
 * All coordinates are in canvas (logical CSS pixel) space.
 */
export function getHandles(
  x: number,
  y: number,
  w: number,
  h: number,
): ResizeHandle[] {
  return [
    { id: "TL", hx: x, hy: y, cursor: "nw-resize" },
    { id: "TC", hx: x + w / 2, hy: y, cursor: "n-resize" },
    { id: "TR", hx: x + w, hy: y, cursor: "ne-resize" },
    { id: "MR", hx: x + w, hy: y + h / 2, cursor: "e-resize" },
    { id: "BR", hx: x + w, hy: y + h, cursor: "se-resize" },
    { id: "BC", hx: x + w / 2, hy: y + h, cursor: "s-resize" },
    { id: "BL", hx: x, hy: y + h, cursor: "sw-resize" },
    { id: "ML", hx: x, hy: y + h / 2, cursor: "w-resize" },
  ];
}

/**
 * Returns the handle under canvas-space (canvasX, canvasY), or null.
 * Checks each handle's center against HIT_RADIUS.
 */
export function hitHandle(
  canvasX: number,
  canvasY: number,
  handles: ResizeHandle[],
): ResizeHandle | null {
  for (const h of handles) {
    if (
      Math.abs(canvasX - h.hx) <= HIT_RADIUS &&
      Math.abs(canvasY - h.hy) <= HIT_RADIUS
    ) {
      return h;
    }
  }
  return null;
}

/**
 * Computes new (width, height) from a drag delta (dx, dy) and the handle being dragged.
 *
 * The handle id encodes which edges move:
 *   R → right edge  → width  increases with +dx
 *   L → left edge   → width  increases with -dx
 *   B → bottom edge → height increases with +dy
 *   T → top edge    → height increases with -dy
 *
 * A minimum of 20px is enforced on both dimensions.
 * An optional maxWidth caps the width so a float cannot be dragged wider than the page content area.
 */
export function computeNewSize(
  handleId: string,
  startW: number,
  startH: number,
  dx: number,
  dy: number,
  maxWidth = Infinity,
): { width: number; height: number } {
  let w = startW;
  let h = startH;
  if (handleId.includes("R")) w = Math.min(maxWidth, Math.max(20, startW + dx));
  if (handleId.includes("L")) w = Math.min(maxWidth, Math.max(20, startW - dx));
  if (handleId.includes("B")) h = Math.max(20, startH + dy);
  if (handleId.includes("T")) h = Math.max(20, startH - dy);
  return { width: Math.round(w), height: Math.round(h) };
}

/**
 * Draws a selection border + 8 resize handles for the rect (x, y, w, h).
 * The ctx must already be scaled by dpr — draw in logical CSS pixels.
 */
export function renderHandles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();

  // Blue selection border
  ctx.strokeStyle = HANDLE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  // 8 square handles
  ctx.fillStyle = HANDLE_COLOR;
  for (const { hx, hy } of getHandles(x, y, w, h)) {
    ctx.fillRect(hx - HANDLE_HALF, hy - HANDLE_HALF, HANDLE_SIZE, HANDLE_SIZE);
  }

  ctx.restore();
}
