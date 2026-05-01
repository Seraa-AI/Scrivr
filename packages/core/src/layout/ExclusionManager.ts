/**
 * ExclusionManager — tracks anchored-object exclusion zones for text wrapping.
 *
 * Anchored objects carve rectangular exclusion zones out of the page's text
 * area. When text lines are laid out, they query the remaining available
 * inline segments at their Y position.
 */

export interface ExclusionRect {
  /** Page number (1-based) this exclusion is on */
  page: number;
  /** Left edge of exclusion zone (image left - margin) in page coordinates */
  x: number;
  /** Right edge (image right + margin) in page coordinates */
  right: number;
  /** Top of image (absolute page Y) */
  y: number;
  /** Bottom of image */
  bottom: number;
  /** Which side text is excluded from */
  side: "left" | "right" | "full";
  /** ProseMirror doc position of the float anchor span */
  docPos: number;
}

export interface AvailableSegment {
  /** Absolute X coordinate of the usable inline segment. */
  x: number;
  /** Usable inline width in CSS pixels. */
  width: number;
}

export interface LineSpace {
  /**
   * Usable inline regions after subtracting all active exclusion rects from
   * the content area. Multiple entries represent a line with a hole in it.
   */
  segments: AvailableSegment[];
  /**
   * Set when every usable segment has been removed by a full-width exclusion.
   * A segmented line breaker can jump to this Y instead of emitting empty lines.
   */
  skipToY?: number;
}

export class ExclusionManager {
  private rects: ExclusionRect[] = [];

  addRect(rect: ExclusionRect): void {
    this.rects.push(rect);
  }

  /**
   * Add a full-width exclusion rect that always produces `skipToY` for any
   * overlapping line. The rect's `x` / `right` are forced to span the
   * caller-provided content area so `subtractRectFromSegments` can never
   * leave a side segment that suppresses `skipToY` in the return value.
   *
   * Use this for top-bottom anchored objects where the wrap intent is
   * "no text on this Y band" — `addRect` with hand-set `x`/`right` is
   * easy to get wrong (a 1px content-bounds mismatch silently turns
   * skipToY off).
   */
  addFullWidthRect(rect: {
    page: number;
    y: number;
    bottom: number;
    contentX: number;
    contentWidth: number;
    docPos: number;
  }): void {
    this.rects.push({
      page: rect.page,
      x: rect.contentX,
      right: rect.contentX + rect.contentWidth,
      y: rect.y,
      bottom: rect.bottom,
      side: "full",
      docPos: rect.docPos,
    });
  }

  /**
   * Returns all horizontal text opportunities at absoluteY after subtracting
   * active exclusion rectangles from the content area.
   *
   * This is the clean anchored-object model: placed objects contribute
   * rectangles; line layout asks which inline segments remain at its current Y.
   */
  getAvailableSegments(
    page: number,
    absoluteY: number,
    lineHeight: number,
    contentX: number,
    contentWidth: number,
  ): LineSpace {
    const lineBottom = absoluteY + lineHeight;
    let segments: AvailableSegment[] = [{ x: contentX, width: contentWidth }];
    let skipToY: number | undefined;

    for (const r of this.rects) {
      if (r.page !== page) continue;
      if (lineBottom <= r.y || absoluteY >= r.bottom) continue;

      if (r.side === "full") {
        skipToY = Math.max(skipToY ?? r.bottom, r.bottom);
      }

      segments = subtractRectFromSegments(segments, r.x, r.right);
    }

    segments = segments.filter((segment) => segment.width > 0);
    return skipToY !== undefined && segments.length === 0
      ? { segments, skipToY }
      : { segments };
  }

  /**
   * Returns the Y coordinate past all full-width exclusions overlapping absoluteY.
   * Used to skip 'top-bottom' float gaps in PageLayout.
   */
  getNextFreeY(page: number, absoluteY: number): number {
    let y = absoluteY;
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of this.rects) {
        if (r.page !== page) continue;
        if (r.side !== "full") continue;
        if (y >= r.y && y < r.bottom) {
          y = r.bottom;
          changed = true;
        }
      }
    }
    return y;
  }

  hasExclusionsOnPage(page: number): boolean {
    return this.rects.some((r) => r.page === page);
  }

  clear(): void {
    this.rects = [];
  }
}

function subtractRectFromSegments(
  segments: AvailableSegment[],
  rectLeft: number,
  rectRight: number,
): AvailableSegment[] {
  const next: AvailableSegment[] = [];

  for (const segment of segments) {
    const segLeft = segment.x;
    const segRight = segment.x + segment.width;
    const overlapLeft = Math.max(segLeft, rectLeft);
    const overlapRight = Math.min(segRight, rectRight);

    if (overlapRight <= overlapLeft) {
      next.push(segment);
      continue;
    }

    const leftWidth = overlapLeft - segLeft;
    const rightWidth = segRight - overlapRight;

    if (leftWidth > 0) {
      next.push({ x: segLeft, width: leftWidth });
    }
    if (rightWidth > 0) {
      next.push({ x: overlapRight, width: rightWidth });
    }
  }

  return next;
}
