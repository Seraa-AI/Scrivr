import { useEffect, useRef, useCallback } from "react";
import {
  LayoutPage,
  PageConfig,
  CharacterMap,
  TextMeasurer,
  renderPage,
  setupCanvas,
  clearOverlay,
  renderCursor,
} from "@canvas-editor/core";

interface PageViewProps {
  page: LayoutPage;
  pageConfig: PageConfig;
  layoutVersion: number;
  currentVersion: () => number;
  measurer: TextMeasurer;
  map: CharacterMap;
  isVisible: boolean;
  observeRef: (el: HTMLDivElement | null) => void;
  gap: number;
  /** ProseMirror doc position of the cursor (selection.head) */
  cursorDocPos: number;
  /** Whether the editor textarea is focused */
  isFocused: boolean;
  /**
   * Current blink visibility — driven by CursorManager, not managed here.
   * PageView redraws the overlay whenever this prop changes.
   */
  cursorVisible: boolean;
  /**
   * Called when the user clicks on this page.
   * Receives coordinates relative to the page's top-left corner (CSS pixels).
   * Caller converts to a doc position via CharacterMap and calls moveCursorTo.
   */
  onPageClick: (x: number, y: number) => void;
}

/**
 * PageView — renders one page of the document.
 *
 * Two stacked canvases per visible page:
 *   1. Content canvas  — text, drawn by renderPage (alpha: false, opaque)
 *   2. Overlay canvas  — cursor + selection (alpha: true, transparent)
 *      pointer-events: none so clicks pass through to the page div below.
 *
 * Blink timing is NOT managed here — CursorManager on the Editor owns it.
 * PageView just reacts to cursorVisible prop changes and redraws.
 */
export function PageView({
  page,
  pageConfig,
  layoutVersion,
  currentVersion,
  measurer,
  map,
  isVisible,
  observeRef,
  gap,
  cursorDocPos,
  isFocused,
  cursorVisible,
  onPageClick,
}: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dprRef = useRef(1);

  // ── Overlay draw ─────────────────────────────────────────────────────────

  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const ctx = overlay.getContext("2d")!;
    clearOverlay(ctx, pageConfig.pageWidth, pageConfig.pageHeight, dprRef.current);

    if (isFocused && cursorVisible) {
      const coords = map.coordsAtPos(cursorDocPos);
      if (coords && coords.page === page.pageNumber) {
        renderCursor(ctx, coords);
      }
    }
  }, [pageConfig.pageWidth, pageConfig.pageHeight, map, page.pageNumber, isFocused, cursorVisible, cursorDocPos]);

  // ── Content canvas + overlay setup ────────────────────────────────────────

  useEffect(() => {
    if (!isVisible) return;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    // Content canvas — opaque, handles DPR scaling
    const { dpr } = setupCanvas(canvas, {
      width: pageConfig.pageWidth,
      height: pageConfig.pageHeight,
    });
    dprRef.current = dpr;

    // Overlay canvas — transparent, manually sized (alpha: true by default)
    overlay.width = Math.round(pageConfig.pageWidth * dpr);
    overlay.height = Math.round(pageConfig.pageHeight * dpr);
    overlay.style.width = `${pageConfig.pageWidth}px`;
    overlay.style.height = `${pageConfig.pageHeight}px`;

    renderPage({
      ctx: canvas.getContext("2d", { alpha: false })!,
      page,
      pageConfig,
      renderVersion: layoutVersion,
      currentVersion,
      dpr,
      measurer,
      map,
      showMarginGuides: true,
    });

    drawOverlay();
  }, [isVisible, page, pageConfig, layoutVersion, currentVersion, measurer, map, drawOverlay]);

  // ── Overlay redraw on blink tick or cursor move ───────────────────────────

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      ref={observeRef}
      style={{
        width: pageConfig.pageWidth,
        height: pageConfig.pageHeight,
        marginBottom: gap,
        boxShadow: "0 4px 32px rgba(0,0,0,0.12)",
        background: "#fff",
        position: "relative",
        flexShrink: 0,
        cursor: "text",
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onPageClick(e.clientX - rect.left, e.clientY - rect.top);
      }}
    >
      {isVisible ? (
        <>
          {/* Content canvas — text */}
          <canvas
            ref={canvasRef}
            style={{ display: "block", position: "absolute", top: 0, left: 0 }}
          />
          {/* Overlay canvas — cursor + selection; pointer-events: none so clicks pass through */}
          <canvas
            ref={overlayRef}
            style={{
              display: "block",
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
            }}
          />
        </>
      ) : (
        // Placeholder — correct height, no pixels
        <div style={{ width: "100%", height: "100%", background: "#fff" }} />
      )}
    </div>
  );
}
