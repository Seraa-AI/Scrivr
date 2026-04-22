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

## Target data model

```ts
interface Section {
  id: string;

  /** Doc position range this section covers. */
  from: number;
  to: number;

  settings: {
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
    /** When true, this section inherits the previous section's header. */
    header: boolean;
    /** When true, this section inherits the previous section's footer. */
    footer: boolean;
  };
}
```

Storage: `doc.attrs.sections: Section[]` replaces `doc.attrs.headerFooter`.

## Resolution algorithm

```
resolveHeader(sections, page, variant):
  section = findSectionForPage(sections, page)
  if section.links.header:
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
  linkToPrevious(sectionId: string, band: "header" | "footer", linked: boolean): void;
  addSection(atPos: number): void;
  removeSection(sectionId: string): void;
}
```

## Migration path from v1

1. **Schema**: Add `sections` doc attr alongside `headerFooter`. Migration reads old policy into a single-section array.
2. **ProseMirror**: Add `sectionBreak` node type. Splitting a paragraph at a section break creates two sections.
3. **resolveSlot**: Accept section instead of policy. `SlotContext.section` becomes required.
4. **resolveChrome**: Iterate sections, find which section covers each page, resolve per-section.
5. **Controller**: Add section-aware methods. Old `setHeaderMarginTop()` becomes `setSectionSettings(sectionId, { headerTop })`.
6. **Surfaces**: Encode section ID in surface IDs. Surface cache becomes per-section.
7. **Ribbon**: Show section name ("Header — Section 2"), link-to-previous toggle.

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
