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
import type { OutlineSection, SemanticUnit } from "@scrivr/core";

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

  const closed: OutlineSection[] = [];
  const open: OpenSection[] = [];
  const close = (section: OpenSection, endUnit: number): void => {
    closed.push({ ...section, endUnit });
  };

  const firstHeading = units.findIndex((unit) => unit.type === "heading");
  if (firstHeading !== 0) {
    // Content before the first heading is a section the reader navigates to,
    // so it gets one — with a supplied name, because the document gives none.
    const first = units[0]!;
    close(
      {
        id: first.id,
        parentId: null,
        heading: options.untitledHeading ?? DEFAULT_UNTITLED,
        headingNodeId: null,
        level: 1,
        path: [options.untitledHeading ?? DEFAULT_UNTITLED],
        startUnit: 0,
      },
      firstHeading === -1 ? units.length : firstHeading,
    );
  }

  units.forEach((unit, index) => {
    if (unit.type !== "heading") return;

    // Depth comes from the breadcrumb the walker already threaded, not from a
    // second level-comparison here. "Which headings am I under" has one owner,
    // so a section's path and its units' breadcrumbs cannot drift apart.
    const depth = unit.breadcrumb.length;
    while (open.length > depth) close(open.pop()!, index);

    open.push({
      id: unit.id,
      parentId: open[depth - 1]?.id ?? null,
      heading: unit.text,
      headingNodeId: unit.nodeIds[0] ?? null,
      level: unit.headingLevel ?? 1,
      path: [...unit.breadcrumb, unit.text],
      startUnit: index,
    });
  });

  while (open.length > 0) close(open.pop()!, units.length);

  // Sections close innermost-first. Document order is what a reader navigates,
  // and a section that opens where its parent does follows it.
  return closed.sort((a, b) => a.startUnit - b.startUnit || a.level - b.level);
}
