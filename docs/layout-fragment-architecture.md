# Layout Fragment Architecture

## Overview

The layout engine is already close to a Google-Docs-class pagination engine. The engine is not missing fragmentation — it is missing **fragment identity and fragment indexing**. The right solution is to formalize what already works, not redesign the pipeline.

This document covers:

1. The current architecture (accurate snapshot)
2. The core mental model shift
3. Three incremental improvements that can ship now
4. How this enables tables and columns

---

## Current Architecture

```
ProseMirror Doc
    ↓
LayoutItem[]          — flat block/list-item expansion (pre-layout)
    ↓
layoutDocument()      — monolithic 4-pass loop (measure, float, paginate, reconcile)
    ↓
LayoutBlock[]         — positioned block with lines, placed on a page
    ↓
LayoutPage[]          — container of blocks (directly owned, not references)
    ↓
DocumentLayout        — top-level result + floats + versioning
    ↓
CharacterMap          — flat glyph/line arrays for hit-testing
    ↓
PageRenderer          — renders pages to canvas
```

Split paragraphs produce multiple independent `LayoutBlock` objects (one per page part), linked by shared `nodePos` and flags (`isContinuation`, `continuesOnNextPage`). This is an implicit fragment system — the improvements below make it explicit.

---

## Core Mental Model

The engine currently thinks:

```
Pages own blocks.
```

The correct model is:

```
Blocks own the text.
Pages own fragments (views into blocks).
```

This is not a rewrite — it is a naming and indexing shift. Concretely:

```
Block → Fragment 0  (page 1)
Block → Fragment 1  (page 2)
Block → Fragment 2  (page 3)
```

A `LayoutFragment` is a **view**, not a block. It does not hold text — it points to a slice of a block:

```ts
interface LayoutFragment {
  pageNumber:  number;
  block:       LayoutBlock;   // the semantic content (text, lines, marks)
  startLine:   number;        // index into block.lines
  endLine:     number;        // exclusive
  y:           number;        // page-local top coordinate
  height:      number;
  charStart:   number;        // first docPos in this fragment
  charEnd:     number;        // last docPos in this fragment (exclusive)
  fragmentIndex: number;      // 0-based part index within the source block
  fragmentCount: number;      // total number of parts this block was split into
}
```

This single type makes paragraph splits, table-cell splits, and column splits identical — all are just `Block → N fragments`. No special casing per block type.

Why `fragmentCount` matters:

```ts
// Before (flag soup)
const isFirst = !block.isContinuation;
const isLast  = !block.continuesOnNextPage;

// After (unambiguous)
const isFirst = fragment.fragmentIndex === 0;
const isLast  = fragment.fragmentIndex === fragment.fragmentCount - 1;
```

---

## What Is Already Correct

| Area | Status |
|------|--------|
| Layout scheduling (invalidate → RAF → ensureLayout) | Correct |
| Progressive layout (100 sync, rest via idle chunks) | Correct |
| Split paragraph cursor page resolution | Fixed — `_indexLayout()` uses char-level span ranges |
| Float split at page boundary (Pass 3 / 3b) | Fixed — `splitBlockAtBoundary()` |
| `_blockIndex` overlap for split paragraphs | Fixed — sorted by charStart, non-overlapping ranges |

---

## What Is Worth Improving

### Problem 1 — Block-granular fragment index

`_blockIndex` indexes at block level: one entry per split part. Works for simple text blocks, but becomes fragile when multiple blocks share a `nodePos` (tables: each cell is a sub-block of the table node).

| Case | Block-level index | Line-level index |
|------|-------------------|------------------|
| Paragraph split across pages | fragile | safe |
| Tables with multiple cells | fragile | safe |
| Columns | fragile | safe |
| Cursor at paragraph end | fragile | safe |

### Problem 2 — charMap full clear on every idle chunk

Every idle layout chunk clears the entire `CharacterMap` and rebuilds it for the cursor page. On a 500-block document with 50-block chunks, that is 10 ticks × full charMap rebuild. Causes scroll lag and cursor flicker on long documents.

| Document size | Before | After Phase 3 |
|---------------|--------|---------------|
| 10 pages | same | same |
| 30 pages | slight lag | smooth |
| 80 pages | scroll lag | smooth |
| 150 pages | very slow | still smooth |

This is not optional — it is what turns the engine into a large-document editor.

### Problem 3 — No formal fragment identity

Split parts are identified by matching `nodePos` across pages + checking boolean flags. Tables and columns need the same mechanism but have no clean way to reuse it. The `LayoutFragment` type above solves this for all cases uniformly.

---

## Phased Plan

### Phase 1 — Line-granular fragment index  *(LayoutCoordinator only)*

**Goal:** Make `_cursorPageFromLayout()` unambiguously correct for all block types, including future table cells and column blocks.

**Change:** Replace the block-level `_blockIndex` with a typed line-level `_fragmentIndex`.

```ts
interface FragmentIndexEntry {
  start: number;   // charStart (first docPos on this line)
  end:   number;   // charEnd   (last docPos on this line, exclusive)
  page:  number;
}

// Before
private _blockIndex: Array<[start: number, end: number, page: number]>

// After
private _fragmentIndex: FragmentIndexEntry[]
```

**Population logic in `_indexLayout()`:**

```ts
for (const page of layout.pages) {
  for (const block of page.blocks) {
    for (const line of block.lines) {
      const first = line.spans[0];
      const last  = line.spans[line.spans.length - 1];
      if (!first || !last) continue;
      this._fragmentIndex.push({
        start: first.docPos,
        end:   spanEndDocPos(last),
        page:  page.pageNumber,
      });
    }
    // Sentinel: extend coverage to paragraph-end cursor pos on the last visual part
    // (only when !block.continuesOnNextPage)
  }
}
// Sort by start ascending for binary search
this._fragmentIndex.sort((a, b) => a.start - b.start);
```

**Why line-level is better than block-level:**
- A 30-line paragraph split across 3 pages produces 30 entries instead of 3. Each entry maps a single line to an unambiguous page.
- Table cells have their own `nodePos`. Their line entries are naturally disjoint — no overlap, no special casing.
- Column blocks are also naturally disjoint since column A text ≠ column B text.

**Add linear fallback for binary search miss:**

```ts
private _findPageLinear(docPos: number): number {
  for (const page of this._layout.pages) {
    for (const block of page.blocks) {
      if (docPos >= block.nodePos && docPos < block.nodePos + block.node.nodeSize)
        return page.pageNumber;
    }
  }
  return this._layout.pages.at(-1)?.pageNumber ?? 1;
}
```

**Scope:** `LayoutCoordinator.ts` only. No type changes to `LayoutBlock`, no changes to `PageLayout.ts` or renderers.

---

### Phase 2 — Formal fragment identity on LayoutBlock

**Goal:** Replace the boolean flag system with explicit fragment identity so tables and columns reuse the same mechanism without new special cases.

**Change:** Add three optional fields to `LayoutBlock`:

```ts
export interface LayoutBlock {
  // ... existing fields ...

  /** 0-based index of this visual part. 0 = first (or unsplit block). */
  fragmentIndex?: number;

  /** Total number of visual parts this block was split into. 1 = unsplit. */
  fragmentCount?: number;

  /** nodePos of the original unsplit block. Same as nodePos for unsplit blocks. */
  sourceNodePos?: number;
}
```

**Update** the split loop in `PageLayout.ts` to populate these fields:

```ts
// First pass: count total parts per sourceNodePos
// Second pass: assign fragmentIndex 0, 1, 2, ... and set fragmentCount on each part
```

**Why `fragmentCount` matters:**

```ts
// Before — flag soup
const isFirst  = !block.isContinuation;
const isMiddle =  block.isContinuation && block.continuesOnNextPage;
const isLast   = !block.continuesOnNextPage;

// After — unambiguous
const isFirst  = block.fragmentIndex === 0;
const isLast   = block.fragmentIndex === block.fragmentCount - 1;
```

Table cells set `fragmentIndex`/`fragmentCount` per row-part. Columns set them per column-part. Same fields, same semantics — no new flags ever needed.

**Scope:** `LayoutBlock` interface (`BlockLayout.ts`), split loop (`PageLayout.ts`). All fields are optional — zero breaking changes.

---

### Phase 3 — Partial charMap invalidation  *(required for large documents)*

**Goal:** Stop clearing the entire `CharacterMap` on every idle layout chunk.

**Current behavior in `_completeIdleLayout()`:**

```ts
this.charMap.clear();           // throws away ALL glyphs every chunk
this._populatedPages.clear();   // forces full rebuild on next render
```

**Proposed behavior:** only invalidate pages whose layout changed.

```ts
const prevPageCount = this._layout.pages.length;
this._layout = layoutDocument(...);  // resume next chunk

// Pages that already existed are structurally unchanged — preserve their charMap
// Only new pages (beyond prevPageCount) need to be re-populated
for (let i = prevPageCount; i < this._layout.pages.length; i++) {
  this._populatedPages.delete(this._layout.pages[i].pageNumber);
}

// Always re-populate cursor page in case the cursor is in the new range
this.ensurePagePopulated(this._cursorPage);
```

**Why this is required (not optional):**

Streaming layout produces N idle chunks. Before Phase 3, each chunk does O(all pages) charMap work regardless of which pages changed. After Phase 3, each chunk does O(new pages only). On a 150-page document that is the difference between "scroll lag" and "smooth at all times".

**Scope:** `LayoutCoordinator.ts`, minor addition to `LayoutResumption` to expose `prevPageCount`.

---

## How This Enables Tables and Columns

Both reduce to **"more blocks with correct char ranges"** — no changes to `LayoutCoordinator` beyond Phase 1.

### Tables

Each cell is laid out as a `LayoutBlock` by `TableLayoutEngine` (calling `layoutBlock()` per cell). The `_fragmentIndex` binary search handles them automatically because cell line entries are disjoint from paragraph line entries.

Row overflow = the row's cell blocks get `fragmentIndex` parts, exactly like paragraph splits today. No new mechanism needed.

### Columns

A two-column layout produces two parallel block streams. Each stream's blocks have disjoint char ranges (column A ≠ column B). The binary search handles them correctly. The `LayoutPage` needs a `columnIndex` on each block but `LayoutCoordinator` stays unchanged.

### The key insight

Without explicit fragments, the engine cannot uniformly handle:

- Paragraph split across pages
- Table cell split across pages
- Table row split across pages

With `LayoutFragment` (or the Phase 2 fields as a stepping stone), all three become identical: `Block → N fragments`. Tables are free, not special-cased.

---

## Architecture Rating

| System | Current | After Phase 1–3 |
|--------|---------|-----------------|
| Layout scheduling | ★★★★★ | ★★★★★ |
| Progressive layout | ★★★★★ | ★★★★★ |
| Cursor page resolution | ★★★★☆ | ★★★★★ |
| Fragment identity | ★★★☆☆ | ★★★★★ |
| CharacterMap efficiency | ★★★☆☆ | ★★★★☆ |
| Table/column readiness | ★★☆☆☆ | ★★★★☆ |

---

## Execution Order

1. **Phase 1** — Implement now. Isolated to `LayoutCoordinator.ts`. Immediately makes cursor resolution more robust, unblocks table and column layout.
2. **Phase 3** — Implement next. Required for smooth performance on documents > 10 pages. Small scope, high impact.
3. **Phase 2** — Implement when starting table work. Replaces flag soup with explicit fragment identity. Same fields, same semantics for all future block types.

For the longer-term pipeline refactor (separating `buildBlockFlow` / `applyFloatLayout` / `paginateFlow` into distinct stages), see [`layout-pipeline-architecture.md`](./layout-pipeline-architecture.md). That work builds naturally on top of these three phases but is not required to implement tables or fix large-document performance.
