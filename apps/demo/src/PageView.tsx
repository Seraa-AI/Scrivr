import { useEffect, useRef, useCallback } from "react";
import {
  LayoutPage,
  PageConfig,
  CharacterMap,
  TextMeasurer,
  SelectionSnapshot,
  renderPage,
  setupCanvas,
  clearOverlay,
  renderCursor,
  renderSelection,
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
  /** Current selection (cursor + optional highlight range) */
  selection: SelectionSnapshot;
  /** Whether the editor textarea is focused */
  isFocused: boolean;
  /** Blink visibility — driven by CursorManager in Editor, not managed here */
  cursorVisible: boolean;
  /** Mousedown on the page canvas — start of a click or drag */
  onPageMouseDown: (x: number, y: number, shiftKey: boolean) => void;
  /** Mousemove on the page canvas while the mouse button is held */
  onPageMouseMove: (x: number, y: number) => void;
}

/**
 * PageView — renders one page of the document.
 *
 * Two stacked canvases per visible page:
 *   1. Content canvas  — text (alpha: false, opaque)
 *   2. Overlay canvas  — selection highlight + cursor (alpha: true, transparent)
 *      pointer-events: none so mouse events hit the page div below.
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
  selection,
  isFocused,
  cursorVisible,
  onPageMouseDown,
  onPageMouseMove,
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

    // Selection highlight — drawn before cursor so cursor sits on top
    if (!selection.empty) {
      const glyphs = map
        .glyphsInRange(selection.from, selection.to)
        .filter((g) => g.page === page.pageNumber);
      renderSelection(ctx, glyphs);
    }

    // Cursor — only when focused and in the "on" phase of the blink
    if (isFocused && cursorVisible) {
      const coords = map.coordsAtPos(selection.head);
      if (coords && coords.page === page.pageNumber) {
        renderCursor(ctx, coords);
      }
    }
  }, [
    pageConfig.pageWidth,
    pageConfig.pageHeight,
    map,
    page.pageNumber,
    selection,
    isFocused,
    cursorVisible,
  ]);

  // ── Content canvas + overlay setup ───────────────────────────────────────

  useEffect(() => {
    if (!isVisible) return;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const { dpr } = setupCanvas(canvas, {
      width: pageConfig.pageWidth,
      height: pageConfig.pageHeight,
    });
    dprRef.current = dpr;

    // Overlay — transparent (alpha: true is the default)
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

  // ── Overlay redraw on selection / blink change ────────────────────────────

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
        userSelect: "none",
      }}
      onMouseDown={(e) => {
        // Prevent the browser from moving focus away from the hidden textarea.
        // Without this, every click on the page div blurs the textarea, causing
        // a blur→focus cycle that kills the blink timer and re-triggers effects.
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onPageMouseDown(e.clientX - rect.left, e.clientY - rect.top, e.shiftKey);
      }}
      onMouseMove={(e) => {
        if (e.buttons !== 1) return; // only while primary button is held
        const rect = e.currentTarget.getBoundingClientRect();
        onPageMouseMove(e.clientX - rect.left, e.clientY - rect.top);
      }}
    >
      {isVisible ? (
        <>
          <canvas
            ref={canvasRef}
            style={{ display: "block", position: "absolute", top: 0, left: 0 }}
          />
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
        <div style={{ width: "100%", height: "100%", background: "#fff" }} />
      )}
    </div>
  );
}
