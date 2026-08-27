/**
 * Sections — the boundary-derived document partition behind per-section
 * columns, page chrome, and page geometry.
 *
 * Sections are NOT stored as `{ from, to }` ranges: document positions move on
 * every local, remote, paste, and normalization transaction, so persisted
 * ranges would need mapping through all of them. The persisted form mirrors
 * OOXML instead — an intermediate `sectionBreak` terminates the section before
 * it and carries that section's settings, while `doc.attrs.finalSection`
 * carries the settings of the final section, which has no trailing break.
 *
 *   section 1 blocks
 *   sectionBreak(settings for section 1)
 *   section 2 blocks
 *   doc.attrs.finalSection(settings for section 2)
 *
 * `deriveSections(doc)` projects that into transient ranges for layout and UI.
 * It never mints ids and never mutates the doc, so calling it on the read path
 * is deterministic.
 *
 * Design: `docs/sections-roadmap.md`.
 */

import type { Node } from "prosemirror-model";

/** How the section following a break starts relative to the page. */
export type SectionBreakType = "continuous" | "nextPage" | "evenPage" | "oddPage";

export const SECTION_BREAK_TYPES: readonly SectionBreakType[] = [
  "continuous",
  "nextPage",
  "evenPage",
  "oddPage",
];

/** Snaking-column geometry for one section. Unequal widths are deferred. */
export interface SectionColumns {
  /** Number of columns; >= 1. `1` is the degenerate single-column case. */
  count: number;
  /** Gutter between columns, in px. */
  gap: number;
  equalWidth: true;
}

/**
 * Per-section settings.
 *
 * Header/footer variant flags (`differentFirstPage`, `differentOddEven`) and
 * band geometry still live in the document-level `HeaderFooterPolicy`; they
 * move here in the section-aware chrome phase, when their readers move with
 * them. Duplicating them now would create a second source of truth that
 * nothing reads.
 */
export interface SectionSettings {
  breakType: SectionBreakType;
  columns: SectionColumns;
}

/**
 * A section projected from the document's boundaries. `from`/`to` are valid
 * only for the doc they were derived from — re-derive after any change rather
 * than mapping them.
 */
export interface Section {
  /** The terminating break's `nodeId`, or `FINAL_SECTION_ID` for the last one. */
  id: string;
  /** Top-level position of the section's first node. */
  from: number;
  /** Exclusive end — past the terminating break, or the end of the doc. */
  to: number;
  /** Position of the terminating `sectionBreak`, or null for the final section. */
  breakPos: number | null;
  settings: SectionSettings;
}

/**
 * Identity of the final section. It is a stable slot rather than a minted id:
 * inserting a break above it hands the preceding content the break's `nodeId`
 * and leaves the tail as the final section, which is exactly the semantics
 * consumers key on.
 */
export const FINAL_SECTION_ID = "section:final";

export const DEFAULT_SECTION_COLUMNS: SectionColumns = {
  count: 1,
  gap: 24,
  equalWidth: true,
};

export const DEFAULT_SECTION_SETTINGS: SectionSettings = {
  breakType: "nextPage",
  columns: DEFAULT_SECTION_COLUMNS,
};

export function isSectionBreakType(value: unknown): value is SectionBreakType {
  return typeof value === "string" && SECTION_BREAK_TYPES.some((t) => t === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSectionColumns(value: unknown): value is SectionColumns {
  if (!isRecord(value)) return false;
  const { count, gap, equalWidth } = value;
  return (
    typeof count === "number" &&
    Number.isFinite(count) &&
    count >= 1 &&
    Number.isInteger(count) &&
    typeof gap === "number" &&
    Number.isFinite(gap) &&
    gap >= 0 &&
    equalWidth === true
  );
}

export function isSectionSettings(value: unknown): value is SectionSettings {
  if (!isRecord(value)) return false;
  return isSectionBreakType(value["breakType"]) && isSectionColumns(value["columns"]);
}

/**
 * Read persisted settings — from a break's attrs or `doc.attrs.finalSection` —
 * into a complete `SectionSettings`. Missing and invalid values fall back to
 * the default, so a document written by an older or buggier writer still lays
 * out as a plain single-column section instead of throwing.
 */
export function coerceSectionSettings(value: unknown): SectionSettings {
  if (!isRecord(value)) return DEFAULT_SECTION_SETTINGS;
  const breakType = value["breakType"];
  return {
    breakType: isSectionBreakType(breakType) ? breakType : DEFAULT_SECTION_SETTINGS.breakType,
    columns: coerceSectionColumns(value["columns"]),
  };
}

function coerceSectionColumns(value: unknown): SectionColumns {
  if (!isRecord(value)) return DEFAULT_SECTION_COLUMNS;
  const count = value["count"];
  const gap = value["gap"];
  const columns: SectionColumns = {
    count:
      typeof count === "number" && Number.isFinite(count) && count >= 1
        ? Math.floor(count)
        : DEFAULT_SECTION_COLUMNS.count,
    gap:
      typeof gap === "number" && Number.isFinite(gap) && gap >= 0
        ? gap
        : DEFAULT_SECTION_COLUMNS.gap,
    equalWidth: true,
  };
  return columns;
}

/** A partial settings update. `equalWidth` is not patchable in v1. */
export interface SectionSettingsPatch {
  breakType?: SectionBreakType;
  columns?: Partial<Omit<SectionColumns, "equalWidth">>;
}

/** Merge a patch onto existing settings, coercing the result. */
export function applySectionSettingsPatch(
  base: SectionSettings,
  patch: SectionSettingsPatch,
): SectionSettings {
  return coerceSectionSettings({
    breakType: patch.breakType ?? base.breakType,
    columns: { ...base.columns, ...patch.columns },
  });
}

/** Whether a node is a section boundary. Safe on schemas without the node. */
export function isSectionBreak(node: Node): boolean {
  return node.type.name === "sectionBreak";
}

/**
 * Project a document into its sections, in document order. Always returns at
 * least one section: a document with no breaks is one implicit section whose
 * settings come from `doc.attrs.finalSection`.
 */
export function deriveSections(doc: Node): Section[] {
  const sections: Section[] = [];
  let from = 0;

  doc.forEach((node, offset) => {
    if (!isSectionBreak(node)) return;
    const to = offset + node.nodeSize;
    sections.push({
      id: sectionBreakId(node, sections.length),
      from,
      to,
      breakPos: offset,
      settings: coerceSectionSettings(node.attrs["settings"]),
    });
    from = to;
  });

  sections.push({
    id: FINAL_SECTION_ID,
    from,
    to: doc.content.size,
    breakPos: null,
    settings: coerceSectionSettings(doc.attrs["finalSection"]),
  });

  return sections;
}

/**
 * Ordinal fallback for a break that has not been stamped with a `nodeId` yet
 * (mid-transaction, or an editor built with `uniqueId: false`). Deterministic
 * for a given doc so repeated derivations agree.
 */
function sectionBreakId(node: Node, index: number): string {
  const nodeId = node.attrs["nodeId"];
  return typeof nodeId === "string" && nodeId.length > 0 ? nodeId : `section:${index}`;
}

/** The section owning a document position. Out-of-range positions clamp. */
export function sectionAt(sections: readonly Section[], pos: number): Section | null {
  if (sections.length === 0) return null;
  for (const section of sections) {
    if (pos < section.to) return section;
  }
  return sections[sections.length - 1] ?? null;
}

/** Look up a derived section by id. */
export function findSectionById(
  sections: readonly Section[],
  id: string,
): Section | null {
  return sections.find((section) => section.id === id) ?? null;
}

/** The section preceding `id` in document order, or null for the first one. */
export function previousSection(
  sections: readonly Section[],
  id: string,
): Section | null {
  const index = sections.findIndex((section) => section.id === id);
  return index > 0 ? (sections[index - 1] ?? null) : null;
}
