import { useRef, useEffect } from "react";
import type { Editor } from "@scrivr/core";
import { TileManager } from "@scrivr/core";

const DEFAULT_GAP = 24;

export interface InscribeProps {
  /** Editor instance from useCanvasEditor. Renders nothing when null. */
  editor: Editor | null;
  /** Gap in pixels between pages in paged mode. Default: 24. */
  gap?: number;
  /** Extra tiles to keep above/below the viewport. Default: 1. */
  overscan?: number;
  /** Draw margin guide lines (dev aid). Default: false. */
  showMarginGuides?: boolean;
  /**
   * Style overrides for each page wrapper in paged mode.
   * e.g. `pageStyle={{ boxShadow: "none", border: "1px solid #e8eaed" }}`
   */
  pageStyle?: Partial<CSSStyleDeclaration>;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Inscribe — mounts the Scrivr rendering engine onto a container div.
 *
 * Uses TileManager for both paged and pageless modes. The engine checks
 * `editor.isPageless` to determine the rendering strategy automatically.
 *
 * @example
 * const editor = useCanvasEditor({ extensions: [StarterKit] })
 * return <Inscribe editor={editor} style={{ padding: 40 }} />
 */
export function Inscribe({
  editor,
  gap = DEFAULT_GAP,
  overscan = 1,
  showMarginGuides = false,
  pageStyle = {},
  className,
  style,
}: InscribeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor || !containerRef.current) return;

    editor.mount(containerRef.current);
    const tm = new TileManager(editor, containerRef.current, { gap, overscan, showMarginGuides, pageStyle });

    return () => {
      tm.destroy();
      editor.unmount();
    };
  }, [editor, gap, overscan, showMarginGuides]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", ...style }}
    />
  );
}
