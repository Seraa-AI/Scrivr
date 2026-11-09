# Wrapper layout: lists owned by their extension

Status: Approved (2026-11-09), with the three decisions below.

## Problem

A list is an extension (`List`), but drawing one is engine code. To change how
a list looks — legal numbering (`1.1.1`), a custom bullet, a task list's
checkbox, a different indent — today means editing core, in seven places that
are not `List`:

| Where | What it knows about lists |
|---|---|
| `layout/layoutItems.ts` | A list branch in the walk: `listKind`, levels, counters, marker text, indent, the hanging width |
| `layout/BlockLayout.ts` | `LayoutBlock.listMarker`, `listMarkerX`, `listMarkerFace`; `firstLineOffset(At)` and `keepAnchorLine`, which exist only for markers |
| `layout/PageLayout.ts` | The marker carried through the measure cache, the flow, splits and float re-breaks (`markerFields`, `isCacheHitFor`) |
| `layout/listMarkers.ts` | Where a marker sits (`listMarkerOf`) and how it is painted (`drawListMarker`, bullet shapes) |
| `renderer/paintBlock.ts` | Calls `drawListMarker` for every block |
| `export-pdf/src/context.ts` | Its own marker painter, bullet shapes included |
| `model/theme.ts` | `listMarker` colour |

The user's rule, 2026-11-09: a node's look must be changeable from its
extension without touching the engine. "We have wrapper nodes already, so we
should extend on this idea."

## What already exists

`NodeLayout` (`layout/BlockRegistry.ts`) declares how a node takes part in
layout. A `transparent` node — a wrapper — has no box of its own; its blocks
are laid out in its place. `sourcedBlock`, `bulletList`, `orderedList` and
`listItem` are all transparent. What a wrapper cannot do today is change the
blocks it wraps: indent them, or hang something before them. Lists need both,
so core special-cases them.

## Design

Extend the wrapper contract with two things a wrapper may do to the blocks it
wraps, and give the one thing it hangs — a **block marker** — a painter its
extension provides. Core keeps the mechanics; the extension keeps the meaning.

### 1. A wrapper declares how it shapes what it wraps

```ts
type NodeLayout =
  | { kind: "block" }
  | { kind: "transparent"; wrap?: WrapperLayout };

interface WrapperLayout {
  /** What this wrapper hands down to what it wraps, from what it received. */
  enter(node: Node, outer: WrapScope): WrapScope;
  /**
   * For each child block: how much further in it sits, and, on a first block,
   * the marker hung before its first line.
   */
  place(child: Node, index: number, scope: WrapScope): { indent: number; marker?: BlockMarker };
}

/** Opaque to core: whatever the wrapper's extension needs to pass down (a list's level, its counters). */
type WrapScope = Readonly<Record<string, unknown>>;
```

The walk in `layoutItems.ts` loses its list branch. For a transparent node with
`wrap`, it calls `enter` once, then `place` for each block it collects, adds
the indent, and attaches the marker. Tables and plain wrappers are unchanged.

### 2. A block marker is generic

```ts
interface BlockMarker {
  /** Which extension paints it: the key its painters are registered under. */
  painter: string;
  /** The painter's own data, opaque to core: a list's "1." or bullet shape. */
  data: unknown;
  /** How far before the text it hangs. */
  hanging: number;
  /** Its width once the block's first font is known, for the first line's push. */
  width(face: MarkerFace, measurer: TextMeasurerLike): number;
}
```

Core does, for any marker, what it does for list numbers today, renamed from
list terms to generic ones:

- **The first line's push** (Word's tab rule for a wide number) and the line a
  float-only first block keeps (`firstLineOffsetAt`, `keepAnchorLine`) become
  marker options, computed from `hanging` and `width`.
- **Where it sits** (`listMarkerOf` → `markerAnchorOf`): the face of the first
  text, the baseline of the first line with text, the `x` past a float. This is
  the code that took the most fixing in L1 and stays one function, shared by
  canvas and PDF.
- **Carrying it** through the measure cache, flow, splits and float re-breaks:
  `LayoutBlock.marker` replaces `listMarker`, `listMarkerX`, `listMarkerFace`.

### 3. The extension paints its markers

```ts
// in List
addMarkerPainters() {
  return {
    list: {
      canvas: (ctx, marker: PlacedMarker, theme) => { /* bullet shapes or the number */ },
      pdf:    (page, marker: PlacedMarker, ctx)   => { /* the same, as PDF ops */ },
    },
  };
}
```

`paintBlock` and the PDF exporter call the painter registered under
`marker.painter`, with the placed marker (anchor, face, data). A block without
a marker calls nothing. The `listMarker` theme colour becomes a `List` option
with today's colours as its default.

### What moves where

| Today (core) | After |
|---|---|
| `layoutItems.ts` list branch | `List`'s `WrapperLayout` (levels, counters, marker text, indent) |
| `model/lists.ts` levels, markers, `levelCounter` | `List` (the level table and numbering are the list's look). `isListType` and `listKind` stay in core's model: track changes and the semantic exporter ask them, and they say what a node is, not how it looks |
| `listMarkers.ts` painting, `BULLET_PAINTERS` | `List`'s canvas painter |
| `export-pdf` marker painter | `List`'s PDF painter |
| `listMarkerOf` | Core's generic `markerAnchorOf` |
| `LayoutBlock.listMarker*` | `LayoutBlock.marker` |
| `theme.listMarker` | `List` option |

After this, a task list, legal numbering or a custom bullet is a new extension
or a `List` option, with no engine change.

## Public API

Breaking, during beta (patch changesets):

- **Removed:** `LayoutBlock.listMarker`, `listMarkerX`, `listMarkerFace`;
  `listMarkerOf`, `ListMarker`, `ListMarkerFont`, `bulletShape`, `bulletBox`
  from `@scrivr/core`; `ResolvedTheme.listMarker`; `BlockLayoutOptions.firstLineOffset`,
  `firstLineOffsetAt` and `keepAnchorLine` (replaced by marker options).
- **New:** `NodeLayout`'s `wrap`; `WrapperLayout`, `WrapScope`, `BlockMarker`,
  `PlacedMarker`, `markerAnchorOf`; `LayoutBlock.marker`; the
  `addMarkerPainters()` extension hook.

## How it is checked

- Every list test in core, PDF and DOCX passes unchanged in what it asserts
  (positions, markers, numbering, faces, floats, splits); only names change.
- A test extension, written only against the public API, declares a wrapper
  with its own marker (a checkbox) and draws it on canvas and in PDF. It is the
  proof that no engine change is needed.
- A grep check in the review: no file under `layout/`, `renderer/` or
  `export-pdf/` names a list.

## Decisions

1. **`wrap` on `transparent`** (user, 2026-11-09). A wrapper that shapes
   nothing is today's transparent node; no third kind.
2. **One hook, `addMarkerPainters()`, with canvas and PDF side by side**
   (user, 2026-11-09), so a marker cannot ship on one surface only.
3. **Table rows in a list item take the indent through `place`** (user,
   2026-11-09): one path; the walk's separate table-row indent goes.

## What shipped

All of it, in one PR on `feat/wrapper-layout`, as designed, with these
differences:

- **`place` is called for every block laid out inside a wrapper, at any
  depth**, not only its children, with `index` counting those blocks. Indents
  add up and the innermost marker wins. A list item is its own wrapper (it
  numbers its first block and hands its text indent to a list nested in it);
  a list's wrapper only counts and nests.
- **`place` may also return `styleKey`**, the block style a block is spaced by
  in place of its own: a list paragraph takes `list_item`, which the walk used
  to decide by name.
- **The marker line options are `BlockLayoutOptions.marker: MarkerLine`**
  (`{ offset?, offsetAt? }`); having one keeps an anchor-only block's line,
  which `keepAnchorLine` said separately.
- **`LayoutBlock.marker` is a `LaidMarker`** (`painter`, `data`, `x`,
  `face`): what the painter and `markerAnchorOf` need, without the measuring
  half of `BlockMarker`. A marker's `data` is compared by identity for cache
  reuse; a list's is its text.
- **The PDF painter is `(marker, ctx: PdfNodeContext)`** and draws through
  `ctx.draw`, so core never names pdf-lib. The surface gained `ellipse` for
  discs and rings.
- **Canvas painters are registered on `BlockRegistry`**, which every surface
  already passes to `paintBlock`; the PDF exporter reads
  `editor.getMarkerPainters()`.
- **The marker colour stays in the theme, as a generic `marker` token**
  (user, 2026-11-09), not a `List` option as decided above. An extension option
  is never resolved, so it could not take `var(--…)` or follow `setTheme`, and
  one value would have coloured both the canvas and the PDF, which keeps its
  own print theme. Renamed from `listMarker`, with the same defaults.
- **A list container is one that declares `listWrap`** (user, 2026-11-09),
  exported for other extensions. Layout used to treat any node holding only
  `listItem`s as a bullet list; an item's `enter` sees the item, not its
  container, so that structural fallback could not move into `List`.
- The level table and painters live in `extensions/built-in/listLevels.ts` and
  `listLayout.ts`. Two tests hold the RFC's grep check: no source file under
  `layout/`, `renderer/` or `export-pdf/src` uses list vocabulary.
