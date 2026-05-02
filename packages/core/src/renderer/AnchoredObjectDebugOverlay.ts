/**
 * AnchoredObjectDebugOverlay — visualises anchored-object placement state
 * for layout debugging.
 *
 * Gated on `editor.debug?.anchoredObjects`. Paints, on every visible page:
 *
 *   - Translucent blue fill at the *wrap-zone* rect (margin-inflated
 *     exclusion area). Square wrap inflates on all four sides;
 *     top-bottom inflates only top/bottom and spans the full content width.
 *     Behind/front contribute no exclusion and so render no fill.
 *   - Red 2px outline around the painted rect when the placement was
 *     `clamped` (yOffset pulled back onto the anchor's page).
 *   - Small label at the rect's bottom-right showing `<wrapMode> z=<zIndex>`
 *     so paint-order issues are visually obvious.
 *
 * Companion to `DragDebugOverlay`; the two overlays cover different
 * concerns. Drag debug = "what does my pointer see right now?" Anchored
 * debug = "what does my placement look like, and why?"
 */
import type { Editor } from "../Editor";
import { ANCHORED_OBJECT_MARGIN, normalizeImageAttrs } from "../layout/AnchoredObjects";

const WRAP_ZONE_FILL    = "rgba(59, 130, 246, 0.10)";  // blue-500 wash
const WRAP_ZONE_STROKE  = "rgba(59, 130, 246, 0.45)";  // blue-500
const CLAMP_OUTLINE     = "rgba(239, 68, 68, 0.95)";   // red-500
const LABEL_FILL        = "rgba(15, 23, 42, 0.80)";    // slate-900
const LABEL_TEXT        = "rgba(248, 250, 252, 1.00)"; // slate-50
const LABEL_FONT        = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
const LABEL_PADDING     = 4;

/**
 * Register the anchored-object debug overlay. Always installed; self-gates
 * on `editor.debug?.anchoredObjects` at paint time so toggling at runtime
 * requires no re-registration.
 */
export function installAnchoredObjectDebugOverlay(editor: Editor): () => void {
  return editor.addOverlayRenderHandler((ctx, pageNumber, _pageConfig, _charMap) => {
    if (!editor.debug?.anchoredObjects) return;

    const objects = editor.layout.anchoredObjects ?? [];
    if (objects.length === 0) return;

    ctx.save();

    for (const obj of objects) {
      if (obj.page !== pageNumber) continue;

      const margin = readMargin(obj.node);

      // Wrap-zone fill. Square inflates on all four sides; top-bottom is a
      // full-width band (we don't have contentX/contentWidth on the
      // placement, so paint only the inflated band height — the side margin
      // for top-bottom isn't load-bearing for visual debugging anyway).
      if (obj.wrapMode === "square") {
        const zoneX = obj.x - margin;
        const zoneY = obj.y - margin;
        const zoneW = obj.width + 2 * margin;
        const zoneH = obj.height + 2 * margin;
        ctx.fillStyle = WRAP_ZONE_FILL;
        ctx.fillRect(zoneX, zoneY, zoneW, zoneH);
        ctx.strokeStyle = WRAP_ZONE_STROKE;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(
          Math.round(zoneX) + 0.5,
          Math.round(zoneY) + 0.5,
          Math.round(zoneW) - 1,
          Math.round(zoneH) - 1,
        );
        ctx.setLineDash([]);
      } else if (obj.wrapMode === "top-bottom") {
        const zoneY = obj.y - margin;
        const zoneH = obj.height + 2 * margin;
        ctx.fillStyle = WRAP_ZONE_FILL;
        ctx.fillRect(0, zoneY, _pageConfig.pageWidth, zoneH);
        ctx.strokeStyle = WRAP_ZONE_STROKE;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(
          0.5,
          Math.round(zoneY) + 0.5,
          _pageConfig.pageWidth - 1,
          Math.round(zoneH) - 1,
        );
        ctx.setLineDash([]);
      }

      // Clamp indicator — red 2px outline at the painted rect.
      if (obj.clamped === true) {
        ctx.strokeStyle = CLAMP_OUTLINE;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          Math.round(obj.x) + 1,
          Math.round(obj.y) + 1,
          Math.round(obj.width) - 2,
          Math.round(obj.height) - 2,
        );
      }

      // Label: "<wrapMode> z=<zIndex>" pinned to the painted rect's
      // bottom-right corner. Always rendered (zero zIndex is still
      // diagnostic).
      const text = `${obj.wrapMode} z=${obj.zIndex}`;
      ctx.font = LABEL_FONT;
      const metrics = ctx.measureText(text);
      const labelW = metrics.width + LABEL_PADDING * 2;
      const labelH = 14;
      const labelX = obj.x + obj.width - labelW;
      const labelY = obj.y + obj.height - labelH;
      ctx.fillStyle = LABEL_FILL;
      ctx.fillRect(labelX, labelY, labelW, labelH);
      ctx.fillStyle = LABEL_TEXT;
      ctx.textBaseline = "middle";
      ctx.fillText(text, labelX + LABEL_PADDING, labelY + labelH / 2);
    }

    ctx.restore();
  });
}

/**
 * Read the configured margin from a placement's node, falling back to the
 * default. Mirrors how `resolveAnchoredObjects` reads it. We accept any
 * node-shaped value because some test fixtures construct minimal placeholder
 * nodes that don't go through PM's full attr resolution.
 */
function readMargin(node: unknown): number {
  if (node === null || typeof node !== "object" || !("attrs" in node)) {
    return ANCHORED_OBJECT_MARGIN;
  }
  // normalizeImageAttrs is the canonical reader; safe even with sparse attrs.
  const attrs = normalizeImageAttrs(node as Parameters<typeof normalizeImageAttrs>[0]);
  return attrs.margin;
}
