/**
 * ExclusionManager — tracks float image exclusion zones for text wrapping.
 *
 * Float images carve rectangular exclusion zones out of the page's text area.
 * When a paragraph's lines are laid out, the ConstraintProvider queries this
 * manager to narrow the available line width around each float.
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

export interface LineConstraint {
  /** Left edge offset — delta from contentX (the block's content left edge) */
  x: number;
  /** Available width (0 means no space — top-bottom / full case) */
  width: number;
  /**
   * When set, the line breaker should flush the current partial line and jump
   * cumulativeLineY to this absolute Y before sampling the next constraint.
   * Used for 'full' (top-bottom) floats so text skips cleanly past the image.
   */
  skipToY?: number;
}

export class ExclusionManager {
  private rects: ExclusionRect[] = [];

  addRect(rect: ExclusionRect): void {
    this.rects.push(rect);
  }

  /**
   * Returns the tightest available line constraint at absoluteY for lineHeight pixels.
   * contentX and contentWidth define the full available area without floats.
   * Returns null if no exclusion affects this line.
   */
  getConstraint(
    page: number,
    absoluteY: number,
    lineHeight: number,
    contentX: number,
    contentWidth: number,
  ): LineConstraint | null {
    let leftEdge = contentX;
    let rightEdge = contentX + contentWidth;
    let affected = false;

    for (const r of this.rects) {
      if (r.page !== page) continue;
      // Does this line's Y range overlap the exclusion's Y range?
      if (absoluteY + lineHeight <= r.y || absoluteY >= r.bottom) continue;
      affected = true;
      if (r.side === "left") {
        leftEdge = Math.max(leftEdge, r.right);
      } else if (r.side === "right") {
        rightEdge = Math.min(rightEdge, r.x);
      } else {
        // 'full' — top-bottom: signal the line breaker to skip past this zone
        return { x: 0, width: 0, skipToY: r.bottom };
      }
    }

    if (!affected) return null;
    const width = Math.max(0, rightEdge - leftEdge);
    return { x: leftEdge - contentX, width };
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
