import { useEffect, useRef, useState } from "react";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { Placement } from "@floating-ui/dom";

export interface FloatingPositionOptions {
  placement?: Placement;
  fallbackPlacements?: Placement[];
  offset?: number;
  shiftPadding?: number;
}

export function useFloatingPosition<T extends HTMLElement>(
  rect: DOMRect | null,
  deps: ReadonlyArray<unknown> = [],
  options: FloatingPositionOptions = {},
) {
  const ref = useRef<T>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const placement = options.placement ?? "bottom-start";
  const offsetValue = options.offset ?? 8;
  const shiftPadding = options.shiftPadding ?? 8;
  const fallbackPlacements = options.fallbackPlacements;

  useEffect(() => {
    if (!rect || !ref.current) {
      setPosition(null);
      return;
    }

    const virtualEl = {
      getBoundingClientRect: () => rect,
      getClientRects: () => [rect] as unknown as DOMRectList,
    };
    let cancelled = false;

    computePosition(virtualEl, ref.current, {
      placement,
      middleware: [
        offset(offsetValue),
        flip(fallbackPlacements ? { fallbackPlacements } : undefined),
        shift({ padding: shiftPadding }),
      ],
    }).then(({ x, y }) => {
      if (!cancelled) setPosition({ x, y });
    });

    return () => {
      cancelled = true;
    };
    // deps lets callers recompute when rendered content changes size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, placement, offsetValue, shiftPadding, fallbackPlacements, ...deps]);

  return { ref, position };
}
