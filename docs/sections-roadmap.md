# Sections Roadmap

> Status: **design** — not started. Documents the migration path from the current single-section header/footer model to a full section-based document layout system matching Microsoft Word.

## Why sections

Headers and footers are not document-level — they are section-level. The current `doc.attrs.headerFooter: HeaderFooterPolicy` model works for single-section documents (letters, contracts, reports) but cannot express:

- Different headers per chapter/annex
- "Link to previous" inheritance
- Per-section page numbering (restart at 1, roman numerals)
- Per-section margins and orientation
- Odd/even page variants that differ by section

These are all standard in Word, Google Docs (limited), and Pages. Legal documents and structured workflows (Lexa/Seraa) will need them.

## Current state (v1)

The v1 header/footer system was designed with sections in mind:

| Component | Current | Section-ready |
|-----------|---------|---------------|
| `SlotContext` | `{ pageNumber }` | Already has `section?: string` reserved |
| `resolveSlot` | Takes `SlotContext` | Adding section lookup is additive |
| `HeaderFooterDefinition` | Per-slot margins | Becomes per-section |
| `ChromeContribution.topForPage(n)` | Per-page variation | Sections add another dimension |
| Surface IDs | `headerFooter:defaultHeader` | Gains section encoding |

The migration is a lift, not a rewrite.

## Core design decision: boundaries, not stored ranges

Sections are derived from structural boundaries in the ProseMirror document.
They are **not** stored as `{ from, to }` ranges in a doc attribute: document
positions move on every edit, so persisted ranges would need mapping through
every local, remote, normalization, and paste transaction.

The canonical representation mirrors OOXML:

- an intermediate `sectionBreak` terminates the section before it and carries
  that section's settings;
- `doc.attrs.finalSection` carries the final section's identity and settings because
  the final section has no trailing break;
- `deriveSections(doc)` scans top-level children and returns transient ranges
  for layout and UI consumers.

```text
section 1 blocks
sectionBreak(settings for section 1)
section 2 blocks
sectionBreak(settings for section 2)
final section blocks
doc.attrs.finalSection
```

This is the same ownership model as DOCX: paragraph-level `<w:sectPr>` closes
an intermediate section, while body-level `<w:sectPr>` describes the final one.

## Target data model

```ts
interface Section {
  id: string;

  /** Derived positions; never persisted in doc attrs. */
  from: number;
  to: number;

  settings: {
    breakType: "continuous" | "nextPage" | "evenPage" | "oddPage";
    columns: {
      count: number;
      gap: number;
      equalWidth: true;
    };
    differentFirstPage: boolean;
    differentOddEven: boolean;
    headerTop: number;
    footerBottom: number;
    headerGap: number;
    footerGap: number;
  };

  headerFooter: {
    default?: HeaderFooterDefinition;
    firstPage?: HeaderFooterDefinition;
    evenPage?: HeaderFooterDefinition;
  };

  links: {
    /** Word links each header/footer variant independently. */
    header: Record<"default" | "firstPage" | "evenPage", boolean>;
    footer: Record<"default" | "firstPage" | "evenPage", boolean>;
  };
}
```

Storage:

```ts
sectionBreak.attrs = {
  nodeId: string | null;
  settings: SectionSettings;
}

doc.attrs.finalSection = {
  id: string;
  settings: SectionSettings;
};
```

`Section` objects are projections returned by `deriveSections(doc)`. Section
identity comes from the terminating break's `nodeId`; the final section uses the
stable ID in `finalSection`. Header/footer content and link
metadata can move into `SectionSettings` incrementally when that feature needs
multi-section behavior.

### Invariants

1. Every document has at least one derived section.
2. Every non-final section ends at exactly one `sectionBreak`.
3. A `sectionBreak` belongs to the section it terminates, not the one after it.
4. Removing a break merges two sections using an explicit command policy; raw
   deletion must be normalized to the same policy.
5. Inserting a break copies the current section settings to both resulting
   sections before the caller changes either side. Insertion alone is visually
   neutral.
6. `columns.count >= 1`, `columns.gap >= 0`, and v1 always has
   `columns.equalWidth === true`.

## Resolution algorithm

### Physical-page ownership

Columns divide only the **body content region**. Headers and footers remain one
page-wide chrome pair; they are never repeated per column.

A continuous section break can place more than one section on the same physical
page, so page chrome cannot use "the section containing the last block." For
Word parity, the first section present on a physical page owns that page's
header and footer. A later continuous section begins using its own chrome on the
first subsequent page where it is the first section present. A `nextPage`,
`evenPage`, or `oddPage` break naturally makes the new section the owner of the
page it starts.

```ts
interface PageSectionOwnership {
  pageNumber: number;
  /** Section whose body content occurs first on this physical page. */
  ownerSectionId: string;
  /** All sections with body fragments on this page, in document order. */
  sectionIds: string[];
}
```

Pagination produces this ownership alongside `LayoutPage`. Chrome resolution
consumes `ownerSectionId`; it does not rescan positions or infer ownership from
the fragment painted last.

`differentFirstPage` is evaluated against the first physical page owned by the
section, not merely the page containing its boundary. This avoids switching a
page-wide header halfway down a page when a continuous section begins.

### Header/footer inheritance

Link-to-previous is resolved independently for the default, first-page, and
even-page variants of each band. Resolving a linked slot walks backward by
section and variant until it finds an unlinked definition. Columns do not
participate in this lookup.

Microsoft exposes two phrases for one relationship, and the UI must keep their
roles distinct:

- **Link to Previous** is the editable toggle for the active band and variant.
- **Same as Previous** is a derived status label shown when that toggle is on;
  it is not a second stored setting.

New sections start linked for all six slots (three header variants and three
footer variants). The first section cannot link backward, so its toggles are
disabled and resolve as unlinked.

Turning a link **off** materializes the currently resolved previous-section
content into a new local definition before clearing the flag. The page therefore
looks unchanged immediately after unlinking, but later edits are independent.
Turning a link **on** makes the matching previous-section slot authoritative;
any local definition becomes dormant while linked and must not be exported as
the active relationship. Transaction history preserves it for undo.

Editing a linked header/footer edits the resolved source section, matching the
existing reference-based decision. The surface UI must show both the source
section and “Same as Previous” so the mutation target is not surprising.

```
resolveHeader(sections, page, variant):
  section = findSectionById(page.ownerSectionId)
  if section.links.header[variant]:
    prev = findPreviousSection(sections, section.id)
    return resolveHeaderFromSection(prev, page, variant)
  return resolveHeaderFromSection(section, page, variant)

resolveHeaderFromSection(section, page, variant):
  if variant == "firstPage" && section.settings.differentFirstPage:
    return section.headerFooter.firstPage ?? section.headerFooter.default
  if variant == "evenPage" && section.settings.differentOddEven:
    return section.headerFooter.evenPage ?? section.headerFooter.default
  return section.headerFooter.default
```

Linking is reference-based, not duplication-based. Editing a linked section edits the source.

## Surface ID encoding

Current: `headerFooter:defaultHeader`

Section-aware: `headerFooter:section:<id>:header:default`

Parsing:
```ts
const match = id.match(/section:(.+):(header|footer):(default|firstPage|evenPage)/);
```

## Controller evolution

The controller shifts from "the header" to "header of section X, variant Y":

```ts
interface HeaderFooterController {
  getState(): {
    activeSectionId: string | null;
    activeVariant: "default" | "firstPage" | "evenPage";
    activeBand: "header" | "footer" | null;
  };

  setSectionSettings(sectionId: string, partial: Partial<Section["settings"]>): void;
  updateHeader(sectionId: string, variant: Variant, partial: Partial<HeaderFooterDefinition>): void;
  updateFooter(sectionId: string, variant: Variant, partial: Partial<HeaderFooterDefinition>): void;
  linkToPrevious(
    sectionId: string,
    band: "header" | "footer",
    variant: Variant,
    linked: boolean,
  ): void;
  addSection(atPos: number): void;
  removeSection(sectionId: string): void;
}
```

## Implementation order

1. **Section substrate**: `SectionSettings`, `sectionBreak`,
   `finalSection`, `deriveSections`, normalization, and structural
   commands. No layout behavior changes.
2. **Region-ready pagination**: refactor page/Y advancement into a single-region
   `ContentRegion` cursor with byte-for-byte-equivalent one-column output.
3. **Section-scoped columns**: generate equal-width regions from the derived
   section settings and support continuous/next-page transitions.
4. **Column breaks**: forced region advancement plus DOCX round trip.
5. **Section-aware chrome**: move header/footer policy into section settings,
   make `SlotContext.section` required, then update controllers and surfaces.
6. **Remaining section geometry**: orientation, margins, page numbering, and
   odd/even section starts.

The section substrate precedes columns, but the complete header/footer section
migration does not block columns. This keeps the first implementation small
without introducing a temporary document-level column model.

## UI requirements (Word parity)

### Ribbon controls
- Different First Page (per section)
- Different Odd & Even (per section)
- Link to Previous (per band per section)

### Section navigator
- Section labels in the ruler or sidebar
- Jump between sections

### Inline labels
- "Header — Section 2" in the ribbon
- "Same as Previous" indicator when linked

## Pitfalls

1. **Don't store resolved headers** — always compute from sections + linking. Otherwise link edits break.
2. **Don't duplicate content on link** — use reference resolution, not copy.
3. **Don't tie headers to pages** — pages are derived from sections. Sections are the source of truth.
4. **Don't persist section position ranges** — derive and map them from boundary
   nodes instead.
5. **Don't model a section as a container node** — the body remains a flat
   `block+` stream so editing, tables, lists, and existing exporters retain
   their current tree contracts.

## What this unlocks

- **Per-section page numbering**: restart at 1, roman numerals for intros
- **Legal document structure**: different headers for annexes, clause-specific metadata
- **Template intelligence**: section = contract clause block, auto-inject headers
- **Orientation per section**: portrait for body, landscape for tables

## When to build

Build when there is a concrete consumer that needs multi-section documents. The current single-section model covers letters, contracts, reports, and memos — the most common legal document types. Sections become necessary when:

- A user needs different headers for different parts of a document
- Template system needs section-aware header injection
- Page numbering restart is requested
