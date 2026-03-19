import { useEffect, useRef } from "react";
import {
  LayoutPage,
  PageConfig,
  CharacterMap,
  TextMeasurer,
  renderPage,
  setupCanvas,
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
}

/**
 * PageView — renders one page of the document.
 *
 * Visible  → mounts a <canvas>, calls renderPage
 * Invisible → renders a plain <div> placeholder of the correct height
 *
 * The placeholder keeps the scrollbar accurate even for unrendered pages.
 * The canvas is created and destroyed as visibility changes (Option C).
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
}: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dprRef = useRef(1);

  useEffect(() => {
    if (!isVisible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { dpr } = setupCanvas(canvas, {
      width: pageConfig.pageWidth,
      height: pageConfig.pageHeight,
    });
    dprRef.current = dpr;

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
  }, [isVisible, page, pageConfig, layoutVersion, currentVersion, measurer, map]);

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
      }}
    >
      {isVisible ? (
        <canvas
          ref={canvasRef}
          style={{ display: "block", position: "absolute", top: 0, left: 0 }}
        />
      ) : (
        // Placeholder — correct height, no pixels
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#fff",
          }}
        />
      )}
    </div>
  );
}
