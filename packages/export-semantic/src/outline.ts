/**
 * The section hierarchy the document's headings imply.
 *
 * `toSemanticUnits` answers an ordered flat list, which states the structure
 * without describing it — so every consumer that wanted a navigable outline
 * rebuilt one: opening and closing sections on heading level, threading
 * ancestor titles, naming the content that precedes the first real heading.
 * Each of those is a judgement about what a section is, and the editor that
 * owns the structure should be the one making it.
 */
import type { OutlineSection, SemanticHeading, SemanticUnit } from "@scrivr/core";

export interface DocumentOutlineOptions {
  /**
   * The name for content that precedes the first heading. It is a section —
   * a reader navigates to it — but the document gives it no title, and the
   * one shown is text in a language only the host knows.
   */
  untitledHeading?: string;
}

const DEFAULT_UNTITLED = "Document body";

/** A section still accumulating units; `endUnit` is set when it closes. */
type OpenSection = Omit<OutlineSection, "endUnit">;

/**
 * Build the outline from an ordered unit stream.
 *
 * Deterministic from the same units: every id is a unit's own anchor, so two
 * reads of an unchanged document return the same sections and a cached anchor
 * keeps resolving.
 */
export function toDocumentOutline(
  units: readonly SemanticUnit[],
  options: DocumentOutlineOptions = {},
): OutlineSection[] {
  if (units.length === 0) return [];

  // Each section with the order its heading comes in, so sections opened by
  // headings in the same unit keep document order.
  const closed: { section: OutlineSection; order: number }[] = [];
  const open: { section: OpenSection; order: number }[] = [];
  const close = ({ section, order }: { section: OpenSection; order: number }, endUnit: number): void => {
    closed.push({ section: { ...section, endUnit }, order });
  };

  // A section opened by a heading nested inside a unit shares that unit with
  // the section before it, so a heading closes what it ends one unit later
  // than one that is its unit's anchor.
  const endBefore = (index: number, heading: SemanticHeading, unit: SemanticUnit): number =>
    heading.nodeId === unit.id && unit.headingLevel !== undefined ? index : index + 1;

  const firstIndex = units.findIndex((unit) => (unit.headings?.length ?? 0) > 0);
  const first = units[0]!;
  const firstHeading = firstIndex === -1 ? undefined : units[firstIndex]?.headings?.[0];
  const firstUnit = firstIndex === -1 ? undefined : units[firstIndex];
  if (!(firstIndex === 0 && firstUnit?.headingLevel !== undefined)) {
    // Content before the first heading is a section the reader navigates to,
    // so it gets one — with a supplied name, because the document gives none.
    close({ order: -1, section: {
        id: first.id,
        parentId: null,
        heading: options.untitledHeading ?? DEFAULT_UNTITLED,
        headingNodeId: null,
        level: 1,
        path: [options.untitledHeading ?? DEFAULT_UNTITLED],
        startUnit: 0,
      } },
      firstHeading && firstUnit ? endBefore(firstIndex, firstHeading, firstUnit) : units.length,
    );
  }

  let order = 0;
  units.forEach((unit, index) => {
    for (const heading of unit.headings ?? []) {
      // Depth comes from the breadcrumb the walker already threaded, not from
      // a second level-comparison here. "Which headings am I under" has one
      // owner, so a section's path and its units' breadcrumbs cannot drift.
      const depth = heading.breadcrumb.length;
      while (open.length > depth) close(open.pop()!, endBefore(index, heading, unit));

      open.push({ order: order++, section: {
        id: heading.nodeId,
        parentId: open[depth - 1]?.section.id ?? null,
        heading: heading.title,
        headingNodeId: heading.nodeId,
        level: heading.level,
        path: [...heading.breadcrumb, heading.title],
        startUnit: index,
      } });
    }
  });

  while (open.length > 0) close(open.pop()!, units.length);

  // Sections close innermost-first. Document order is what a reader navigates.
  return closed.sort((a, b) => a.order - b.order).map(({ section }) => section);
}
