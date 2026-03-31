import { useRef, useEffect } from "react";
import type { Editor } from "@inscribe/core";
import { ViewManager } from "@inscribe/core";

const DEFAULT_GAP = 24;

export interface CanvasProps {
  /** Editor instance from useCanvasEditor. Renders nothing when null. */
  editor: Editor | null;
  /** Gap in pixels between pages. Default: 24. */
  gap?: number;
  /** Virtual scroll overscan in pixels. Default: 500. */
  overscan?: number;
  /**
   * Override styles applied to each page wrapper div.
   * Merged on top of defaults — use `boxShadow: "none"` to remove the shadow,
   * or `background` to change the page background color.
   */
  pageStyle?: Partial<CSSStyleDeclaration>;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Canvas — mounts the Inscribe rendering engine onto a container div.
 *
 * All page DOM management, canvas painting, mouse handling, and virtual
 * scrolling are owned by the ViewManager in @inscribe/core. This component
 * is a thin React lifecycle wrapper: mount on effect, unmount on cleanup.
 *
 * @example
 * const editor = useCanvasEditor({ extensions: [StarterKit] })
 * return <Canvas editor={editor} style={{ padding: 40 }} />
 */
export function Canvas({
  editor,
  gap = DEFAULT_GAP,
  overscan = 500,
  pageStyle = {},
  className,
  style,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor || !containerRef.current) return;

    editor.mount(containerRef.current);
    const vm = new ViewManager(editor, containerRef.current, { gap, overscan, pageStyle });

    return () => {
      vm.destroy();
      editor.unmount();
    };
  }, [editor, gap, overscan]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", ...style }}
    />
  );
}
