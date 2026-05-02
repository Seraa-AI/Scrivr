/**
 * DragDebugOverlay — drag/anchored-object debug instrumentation.
 *
 * Two responsibilities, both gated on `editor.debug?.drag`:
 *
 *   dragDebugLog(editor, label, data)
 *     console.debug a structured event with a "[drag]" prefix. Called by
 *     PointerController at mousedown / mousemove (during drag) / mouseup
 *     commit branches. Used to verify that handle precedence, clamp-no-move,
 *     gap detection, and cross-page resolve produce the right control flow.
 *
 *   installDragDebugOverlay(editor)
 *     Registers an overlay render handler that paints, on every visible page:
 *       - green dashed outline for each `layout.anchoredObjects[i]` rect
 *       - yellow dotted outline for `charMap.getObjectRect(docPos)` for the
 *         same docPos — when these disagree, it's a layout/charMap drift bug
 *       - red strip at the page's bottom edge marking where the inter-page
 *         gap begins (the zone Step 4 treats as an invalid drop target)
 *     Returns a dispose function. Self-gates at paint time so flipping
 *     `editor.debug.drag` at runtime takes effect on the next `editor.redraw()`.
 */
import type { Editor } from "../Editor";

export interface DragDebugConfig {
  drag?: boolean;
  /**
   * Anchored-object debug overlay. Paints wrap-zone fill (margin-inflated
   * exclusion rect), clamp indicator, and a wrapMode + zIndex label on every
   * placement. Useful when "the image looks wrong" — visualises the
   * exclusion area and paint-order metadata that normally lives only in
   * `LayoutPage.anchoredObjects[]`. See `AnchoredObjectDebugOverlay.ts`.
   * Self-gates at paint time; flip at runtime via
   * `editor.debug.anchoredObjects = true; editor.redraw()`.
   */
  anchoredObjects?: boolean;
}

interface DebugCarrier {
  debug?: DragDebugConfig;
}

/**
 * Console-debug a structured drag event when `editor.debug?.drag` is true.
 * No-op otherwise — cheap to call from hot paths.
 *
 * Label is the short event identifier (e.g. "down", "move", "commit",
 * "clampedNoMove"); data is a freeform payload. Combined into a single
 * console.debug line so log filters can target "[drag]".
 */
export function dragDebugLog(
  editor: DebugCarrier,
  label: string,
  data: Record<string, unknown>,
): void {
  if (!editor.debug?.drag) return;
  console.debug(`[drag] ${label}`, data);
}

const ANCHORED_RECT_COLOR = "rgba(34, 197, 94, 0.9)";    // green-500
const CHARMAP_RECT_COLOR  = "rgba(234, 179, 8, 0.9)";    // yellow-500
const GAP_STRIP_COLOR     = "rgba(239, 68, 68, 0.30)";   // red-500 wash
const GAP_STRIP_HEIGHT    = 4;

/**
 * Register the drag debug overlay render handler. Paints the diagnostic
 * rects on every page when `editor.debug?.drag` is true.
 */
export function installDragDebugOverlay(editor: Editor): () => void {
  return editor.addOverlayRenderHandler((ctx, pageNumber, pageConfig, charMap) => {
    if (!editor.debug?.drag) return;

    const objects = editor.layout.anchoredObjects ?? [];

    ctx.save();

    for (const obj of objects) {
      if (obj.page !== pageNumber) continue;

      // Green dashed outline — solver-authoritative rect from layout.anchoredObjects.
      ctx.strokeStyle = ANCHORED_RECT_COLOR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(
        Math.round(obj.x) + 0.5,
        Math.round(obj.y) + 0.5,
        Math.round(obj.width) - 1,
        Math.round(obj.height) - 1,
      );
      ctx.setLineDash([]);

      // Yellow dotted outline — charMap-derived rect for the same docPos.
      // Drawn 1px inset so coincident edges don't fully eclipse the green.
      const cm = charMap.getObjectRect(obj.docPos);
      if (cm && cm.page === pageNumber) {
        ctx.strokeStyle = CHARMAP_RECT_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.strokeRect(
          Math.round(cm.x) + 1.5,
          Math.round(cm.y) + 1.5,
          Math.round(cm.width) - 3,
          Math.round(cm.height) - 3,
        );
        ctx.setLineDash([]);
      }
    }

    // Page-gap strip at the very bottom of the page overlay. The actual
    // inter-page gap lives outside any canvas; this is a visual hint that
    // marks "drop targets below here are in gap territory" — Step 4's
    // gap-as-invalid logic flags these drops as no-op.
    ctx.fillStyle = GAP_STRIP_COLOR;
    ctx.fillRect(
      0,
      pageConfig.pageHeight - GAP_STRIP_HEIGHT,
      pageConfig.pageWidth,
      GAP_STRIP_HEIGHT,
    );

    ctx.restore();
  });
}
