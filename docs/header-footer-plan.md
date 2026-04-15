# Header & Footer Implementation Plan

Status: **design** — supersedes the POC on `feat/header-footer` (commit `736ba7d`).

This document captures the concrete plan for adding headers and footers to Scrivr. It synthesises the POC's storage/collab architecture with a cleaner config shape, a measured-height model, and a set of prerequisite refactors that must land first.

**Companion doc**: `docs/multi-surface-architecture.md` is the broader frame this plan fits into — it describes the multi-surface document engine Scrivr is evolving into, explains why the primitives here (`PageMetrics`, `DocAttrStep`, `SurfaceRegistry`, `PageChromeContribution`) exist, and walks through the next surface feature (footnotes) which is iteratively composable with headers. Read the architecture doc first if you want the "why" behind the refactors; read this doc for the concrete v1 implementation of headers and footers specifically.

**Amendments from the multi-surface discussion** (2026-04-11):

- The Surface taxonomy is just `flow` + `chrome` surfaces plus a separate marker facility for comments / mentions / tracked-change refs. No `island` kind, no `overlay` kind — overlay painters (cursors, selections, AI ghost text) stay in the existing `addOverlayRenderHandler` lane and are not part of this architecture. See `docs/multi-surface-architecture.md` §2.
- `PageChromeContribution` will grow a `stable: boolean` return field and a `LayoutIterationContext` input when iterative chrome lands (Step 8 in the architecture doc). Headers are non-iterative and always return `stable: true`, so the change is additive — header implementation in Phases 2–7 below does NOT need to wait for iteration. But the API shape should be designed with the iterative extension in mind (specifically, don't hardcode "single-pass" assumptions into `aggregateChrome`). See architecture doc §3.4.
- `metricsVersion` in §3.4 below is superseded by `runId` once iteration lands. For header-only v1, either works; the forward-compatible version is `runId`. See architecture doc §8.6.

---

## 1. Locked-in decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Content representation** | Mini ProseMirror doc stored as JSON | Full marks/inline/formatting support, serializable, roundtrips with `doc.toJSON()`. |
| **Storage location** | `doc.attrs["headerFooter"]` | Keeps main doc a pure flow document. No position ambiguity, no `CharacterMap` 1:N breakage, no schema migration of the main doc tree. |
| **Mutation mechanism** | Custom `DocAttrStep` | Proper ProseMirror Step with `invert()` / `StepMap.empty` / `jsonID("docAttr")`. Undo, redo, and collab serialization work unchanged. |
| **Editing surface** | Isolated `EditorSurface` primitive with own `EditorState` + `CharacterMap` | Multi-surface pattern; first of many (footnotes, comments, captions). Routed via `Editor.activeSurface`. Lives in core as a reusable primitive. |
| **Collab transport** | Sibling `Y.Map("prose_doc_attrs")`, observed separately from the main `Y.XmlFragment` | Avoids forking `y-prosemirror`; content and attrs flow through independent channels with version-counter dedup guards. |
| **Schema declaration** | New `Extension.addDocAttrs()` lane, merged additively in `ExtensionManager` | Avoids the POC's bug of `Document.addNodes()` clobbering the existing `doc` node spec. |
| **Page-chrome plug-in lane** | New `Extension.addPageChrome()` lane — contributes `(measure, render)` hooks to the layout pipeline and `PageRenderer` | Lets plugins participate in pagination + paint from outside core, without core needing to know about specific plugins. |
| **Package ownership** | `HeaderFooter` extension + tokens + renderer live in `@scrivr/plugins/header-footer`. `DocAttrStep`, `EditorSurface`, `addDocAttrs()` / `addPageChrome()` lanes live in `@scrivr/core`. | Core stays lean and generic; the feature ships as an opt-in plugin. |
| **Feature flag** | Extension presence **is** the flag — no runtime toggle. | When `HeaderFooter` is not in the extensions array, `addDocAttrs` contributes nothing, `addPageChrome` contributes nothing, the attr is never declared in the schema, `resolveChrome` returns zero heights, `PageRenderer` has no header hooks to iterate. Zero overhead when off. |
| **Height model** | Measured natural height, with an optional declared `minHeight` / `maxHeight` | Matches Word/Google Docs user expectations ("my header grew a line, body shifted down"). |
| **Page-number tokens** | Inline PM leaf nodes (`pageNumber`, `totalPages`, `date`) contributed by the plugin's `addNodes()` | Participate in the normal inline pipeline, pick up marks, measured with a stable-width placeholder. Do not exist in the core schema. |
| **Variants in v1** | `defaultHeader`/`defaultFooter` + `differentFirstPage` flag with optional first-page slots | Ships the most-requested variant; `differentOddEven` flag is reserved but stubbed. |
| **PDF export** | Plugin exposes `resolveChrome` + a `drawPageChrome` helper; `@scrivr/export` imports them directly | Per `feedback_pdf_parity.md` — exporter must never silently drop new canvas features. Export is already coupled to plugin packages for track-changes, so another plugin dep is acceptable. |

---

## 2. Architecture overview

Package layout:

```
@scrivr/core                              @scrivr/plugins/header-footer
┌───────────────────────────────┐         ┌─────────────────────────────┐
│ Extension base                │◀────────│ HeaderFooter extension      │
│   addDocAttrs()   ← lane      │         │   addDocAttrs → { headerFooter }
│   addPageChrome() ← lane      │         │   addNodes    → pageNumber, totalPages, date
│   addNodes(), …               │         │   addPageChrome → {
│                               │         │     measure: resolveChrome,
│ ExtensionManager              │         │     render:  drawPageChrome,
│   merges all contributions    │         │   }
│                               │         │   addCommands → set/update/remove
│ DocAttrStep (state primitive) │────────▶│ (imports for commands)
│ EditorSurface (isolated state)│────────▶│ (instantiated per header/footer)
│                               │         └─────────────────────────────┘
│ PageMetrics / runPipeline     │                     │
│ PageRenderer                  │                     │
│                               │              @scrivr/export/pdf
│ YBinding (in @scrivr/plugins  │         ┌─────────────────────────────┐
│  /collaboration — imports     │         │ Imports drawPageChrome      │
│  DocAttrStep from core)       │         │ + resolveChrome from plugin │
└───────────────────────────────┘         └─────────────────────────────┘
```

Data flow per layout run:

```
doc.attrs["headerFooter"] : HeaderFooterPolicy
                │
                ▼
      ┌─────────────────────┐       (iterates extensions with addPageChrome,
      │ aggregateChrome()   │◀───── collects { top, bottom } contributions and
      │  in core            │       sums them into one ResolvedChrome)
      └──────────┬──────────┘
                 │
                 ▼
      ┌─────────────────────┐
      │   PageMetrics       │
      └──────────┬──────────┘
                 │
                 ▼
      ┌─────────────────────┐
      │   runPipeline       │  pure arithmetic; takes metrics bundle
      └──────────┬──────────┘
                 │
                 ▼
      ┌─────────────────────┐
      │   PageRenderer      │──── iterates extensions with addPageChrome.render,
      └─────────────────────┘     invoking each per page with the paint context
```

The critical seams:

1. **`runPipeline`, `paginateFlow`, `applyFloatLayout` only see `PageMetrics`** — never `headerHeight` or `footerHeight` or a `HeaderFooterPolicy` directly. Resolution happens once, upstream, via the generic `addPageChrome` aggregation.
2. **Core contains zero references to `HeaderFooter`, `pageNumber`, `resolveChrome`, or `drawPageChrome`.** The plugin is entirely opt-in via the extensions array.

---

## 3. Prerequisite refactor — `PageMetrics`

**Must land before any header/footer code.** Without this, header height drift will silently desync the three call sites.

### 3.1 New types

```ts
// packages/core/src/layout/PageMetrics.ts

export interface PageMetrics {
  /** 1-based page number this metrics bundle applies to. */
  pageNumber: number;
  /** Y of top of flow content (margins.top + headerHeight for this page) */
  contentTop: number;
  /** Y of bottom of flow content (pageHeight - margins.bottom - footerHeight for this page) */
  contentBottom: number;
  /** contentBottom - contentTop */
  contentHeight: number;
  /** pageWidth - margins.left - margins.right */
  contentWidth: number;
  /** Y of top of header band (== margins.top) */
  headerTop: number;
  /** Y of top of footer band for this page */
  footerTop: number;
  /** Resolved header height for this page (0 when disabled/pageless) */
  headerHeight: number;
  /** Resolved footer height for this page */
  footerHeight: number;
}

/**
 * Per-contributor resolved chrome: both the height contribution (which can
 * vary by page) and the opaque payload routed back to paint time.
 */
export interface ChromeContribution {
  /**
   * Height reserved at the top of each page, *as a function of pageNumber*.
   * Called during pagination every time a new page is opened. Must be pure —
   * same pageNumber must always produce the same result within a layout run.
   */
  topForPage(pageNumber: number): number;
  /** Height reserved at the bottom of each page. Same contract as topForPage. */
  bottomForPage(pageNumber: number): number;
  /**
   * Opaque payload handed back to this contributor at paint time via
   * PageChromePaintContext.payload. Core never inspects it.
   */
  payload?: unknown;
}

export interface ResolvedChrome {
  /** Per-contributor contributions, keyed by name. */
  contributions: Record<string, ChromeContribution>;
  /**
   * Hash of the resolved state — any change to policy / variants / content
   * width / fonts bumps this. Phase 1b early termination is only valid when
   * previousLayout.metricsVersion === current.metricsVersion.
   */
  metricsVersion: number;
}

/**
 * Produce metrics for a specific page. Sums `topForPage(n)` and
 * `bottomForPage(n)` across all contributors to get the per-page reserved
 * space, then derives contentTop / contentBottom from pageConfig.
 *
 * Pure function — no caching, no state. Callers cache at a higher level if
 * they need to.
 */
export function computePageMetrics(
  config: PageConfig,
  resolved: ResolvedChrome,
  pageNumber: number,
): PageMetrics;
```

`DocumentLayout` carries one `PageMetrics` per page (built up as pages are created, so resumption chunks append to the array):

```ts
interface DocumentLayout {
  // ...existing
  metrics: PageMetrics[];                    // metrics[i] applies to pages[i]
  metricsVersion: number;                    // from ResolvedChrome, carried through
  _chromePayloads?: Record<string, unknown>; // routed back to render hooks
}
```

**Why per-page from day one**: `differentFirstPage` and `differentOddEven` are page-indexed variants — the height a page reserves is a pure function of `pageNumber`, known before any content lands. Collapsing to `max(variants)` was a shortcut I initially took to avoid changing `DocumentLayout.metrics` from a scalar to an array; the actual refactor cost is small and the alternative ships a visible bug. Doing it right in Phase 0 means `PageMetrics` never needs to be "upgraded," and `paginateFlow` never carries a hand-wave comment about a v2 follow-up.

### 3.2 Call-site changes

All sites look up metrics for their current page via a small helper:

```ts
// Inside runPipeline / paginateFlow:
const metricsFor = (pageNum: number): PageMetrics => {
  // Cache one slot for the current page — paginateFlow advances sequentially,
  // so a trivial 1-entry cache hits on 99% of lookups.
  if (cachedPage === pageNum) return cachedMetrics!;
  cachedMetrics = computePageMetrics(config, resolved, pageNum);
  cachedPage = pageNum;
  return cachedMetrics;
};
```

| Site | Before | After |
|---|---|---|
| `runPipeline` (`PageLayout.ts:372`) | `contentHeight = pageHeight - margins.top - margins.bottom` | `resolved = aggregateChrome(...); m1 = metricsFor(1)` |
| `runPipeline` Y cursor init (line 387) | `y = margins.top` | `y = metricsFor(1).contentTop` |
| `paginateFlow` signature | `(flows, margins, contentHeight, …, pageless)` | `(flows, pageConfig, resolved, metricsFor, …, pageless)` — takes the per-page lookup, not a single bundle |
| `paginateFlow` hard page break (line 506) | `y = margins.top` | `y = metricsFor(pages.length + 1).contentTop` |
| `paginateFlow` overflow check (line 551) | `pageBottom = margins.top + contentHeight` | `pageBottom = metricsFor(currentPage.pageNumber).contentBottom` |
| `paginateFlow` leaf reflow to next page (line 592) | `y = margins.top` | `y = metricsFor(pages.length + 1).contentTop` |
| `paginateFlow` split loop advance (line 665) | `currentPartStartY = margins.top` | `currentPartStartY = metricsFor(pages.length + 1).contentTop` |
| `paginateFlow` split loop continue (line 716) | `currentPartStartY = margins.top` | `currentPartStartY = metricsFor(pages.length + 1).contentTop` |
| `paginateFlow` top-of-page guard (line 661) | `partStartY === margins.top` | `partStartY === metricsFor(currentPage.pageNumber).contentTop` |
| `applyFloatLayout` page loop (line 992) | `pageBottom = pageHeight - margins.bottom` | `pageBottom = metricsFor(page.pageNumber).contentBottom` |

After each page transition, `runPipeline` also pushes the page's `PageMetrics` into `DocumentLayout.metrics[pageIndex]` so downstream consumers (`PageRenderer`, PDF export, debug logging) can read the same values without recomputing.

### 3.3 Zero-behavior-change property

With zero `addPageChrome` contributors, every contributor's `topForPage` / `bottomForPage` returns 0 for every page number, so `computePageMetrics` produces the same values as the current hand-computed formula for every page. `metricsVersion = 0`. **Phase 0 ships as a standalone PR with no test changes** — the 459+ core tests pass unchanged. The `addPageChrome` lane itself is introduced in Phase 1b, but Phase 0 can pre-install `aggregateChrome` returning a hard-coded empty `ResolvedChrome` to prove the refactor is sound.

### 3.4 Phase 1b cache invariant

`MeasureCacheEntry.placedTargetY` is position-dependent on the contentTop at its page. Two guards are needed, both cheap:

```ts
interface MeasureCacheEntry {
  // ...existing
  placedContentTop?: number;  // contentTop at time of placement
  placedMetricsVersion?: number;  // metricsVersion of the layout run that placed this block
}
```

Phase 1b only accepts the shortcut when **both**:

1. `cachedEntry.placedContentTop === metricsFor(currentPage.pageNumber).contentTop` — the specific page's contentTop hasn't shifted
2. `cachedEntry.placedMetricsVersion === resolved.metricsVersion` — the chrome resolution itself hasn't changed shape

(2) is the coarse guard: any change to policy, variants, content width, or fonts bumps `metricsVersion` and disables all Phase 1b shortcuts for that run. The next run re-establishes placement values and re-enables the shortcut. (1) is the fine guard: even if `metricsVersion` is unchanged, a block that moved between pages may have landed on a page with different chrome (e.g., moved off page 1 where `differentFirstPage` applies).

**Why both**: without (2), a policy change that happens to leave some pages' `contentTop` unchanged would accept stale cache entries from before the policy change. Without (1), a block that moved from page 1 to page 2 under an unchanged policy would incorrectly accept page-1 placement values. Both together are tight.

---

## 4. Core infrastructure — new extension lanes and primitives

All of these land in `@scrivr/core` and ship before the `HeaderFooter` plugin. Each is independently useful; together they're the minimum surface the plugin needs to plug into the layout/paint pipeline from outside core.

### 4.1 `Extension.addDocAttrs()` lane

**Purpose**: let extensions additively declare attrs on the `doc` node without clobbering the existing node spec.

```ts
// packages/core/src/extensions/Extension.ts

export interface ExtensionConfig {
  name: string;
  addNodes?(): Record<string, NodeSpec>;
  addMarks?(): Record<string, MarkSpec>;
  addCommands?(): ...;
  addKeymaps?(): ...;
  // NEW:
  addDocAttrs?(): Record<string, AttributeSpec>;
  addPageChrome?(): PageChromeContribution;
}
```

During schema construction (Phase 1 → Phase 2), `ExtensionManager` merges all contributions into the `doc` node spec. **Collisions fail fast** — silent override is a nightmare to debug:

```ts
const docAttrs: Record<string, AttributeSpec> = {};
const owners: Record<string, string> = {};

for (const ext of extensions) {
  const contrib = ext.addDocAttrs?.() ?? {};
  for (const [key, spec] of Object.entries(contrib)) {
    if (key in docAttrs) {
      throw new Error(
        `[ExtensionManager] Doc attr "${key}" is contributed by both ` +
        `"${owners[key]}" and "${ext.name}". Doc attrs must be unique. ` +
        `Rename one (e.g. "${ext.name}_${key}") or remove the duplicate extension.`,
      );
    }
    docAttrs[key] = spec;
    owners[key] = ext.name;
  }
}

const nodes = { ...collectedNodes };
nodes["doc"] = { ...nodes["doc"], attrs: { ...nodes["doc"]?.attrs, ...docAttrs } };
```

Extensions are expected to namespace their attr names to avoid collisions in practice (`headerFooter`, `trackChanges`, `sections`), but the check catches mistakes at editor construction time rather than letting two extensions silently fight over a shared attr.

**POC bug this fixes**: the POC declared `doc: { content: "block+", attrs: { headerFooter: { default: null } } }` inside `Document.addNodes()`, which overwrote the existing doc node. With `addDocAttrs()`, the doc spec stays intact and any number of extensions can additively contribute attrs (track-changes metadata, section config, etc.).

**Module augmentation**: `packages/core/src/types/augmentation.ts` gets a `DocAttributes` interface extension lane mirroring the existing `Commands` lane, so extensions can type their attrs.

### 4.2 `Extension.addPageChrome()` lane — NEW

**Purpose**: let extensions reserve vertical space on each page and draw into it, from outside core. This is the hook that makes `HeaderFooter` a plugin instead of a built-in.

```ts
// packages/core/src/extensions/types.ts

export interface PageChromeMeasureInput {
  doc: Node;
  pageConfig: PageConfig;
  measurer: TextMeasurer;
  fontConfig: FontConfig;
}

export interface PageChromeMeasurement {
  /** Vertical space to reserve at the top of every page (px). */
  top: number;
  /** Vertical space to reserve at the bottom of every page (px). */
  bottom: number;
  /**
   * Opaque per-contributor payload carried through to render time.
   * The plugin typically stashes its measured mini-layouts here.
   */
  payload?: unknown;
}

export interface PageChromePaintContext {
  ctx: CanvasRenderingContext2D;
  pageNumber: number;
  totalPages: number;
  metrics: PageMetrics;
  pageConfig: PageConfig;
  /** The `payload` returned from measure, for this contributor only. */
  payload: unknown;
  /** Active surface hooks for live editing. */
  activeSurface?: {
    name: string;
    surface: EditorSurface;
  };
}

export interface PageChromeContribution {
  /** Unique name — used to route the payload back to the right render call. */
  name: string;
  /** Run once per layout run, aggregated across all contributors. */
  measure(input: PageChromeMeasureInput): PageChromeMeasurement;
  /** Run once per page during content-canvas paint. */
  render(ctx: PageChromePaintContext): void;
}
```

**Aggregation in core**:

```ts
// packages/core/src/layout/aggregateChrome.ts

export function aggregateChrome(
  extensions: Extension[],
  input: PageChromeMeasureInput,
): ResolvedChrome {
  let top = 0;
  let bottom = 0;
  const payloads: Record<string, unknown> = {};

  for (const ext of extensions) {
    const contrib = ext.addPageChrome?.();
    if (!contrib) continue;
    const m = contrib.measure(input);
    top += m.top;
    bottom += m.bottom;
    if (m.payload !== undefined) payloads[contrib.name] = m.payload;
  }

  return { headerHeight: top, footerHeight: bottom, payloads };
}
```

`runPipeline` calls `aggregateChrome` once, passes the result into `computePageMetrics`, and stores `payloads` on `DocumentLayout._chromePayloads` so `PageRenderer` can route each payload back to the matching contributor at paint time.

**Paint-time dispatch**:

```ts
// PageRenderer.paintPage
for (const ext of this.extensions) {
  const contrib = ext.addPageChrome?.();
  if (!contrib) continue;
  contrib.render({
    ctx,
    pageNumber,
    totalPages: this.layout.pages.length,
    metrics: this.layout.metrics,
    pageConfig: this.layout.pageConfig,
    payload: this.layout._chromePayloads?.[contrib.name],
    activeSurface: this.editor.getActiveSurfaceFor(contrib.name),
  });
}
```

**Zero-overhead when off**: if no extension contributes `addPageChrome`, `aggregateChrome` returns `{ headerHeight: 0, footerHeight: 0, payloads: {} }`, `PageMetrics` degenerates to the pre-header defaults, and `PageRenderer` iterates an empty list.

**Why this specific shape**: the `name` field routes payloads back to the right contributor, so core never has to understand what a "header" is — it just shuffles opaque blobs. Multiple plugins can stack (future margin-notes plugin could contribute its own `top`/`bottom` reservations without conflict).

### 4.3 `DocAttrStep` — state primitive

**Location**: `packages/core/src/state/DocAttrStep.ts`, exported from `@scrivr/core`.

**Not** under `extensions/built-in/` — it's a ProseMirror state primitive, not tied to any one extension. The `HeaderFooter` plugin, the `YBinding` collab plugin, and any future doc-attr-contributing extension all import it from core:

```ts
import { DocAttrStep } from "@scrivr/core";
```

Implementation verbatim from the POC (`invert` / `getMap: StepMap.empty` / `jsonID("docAttr", …)`), with one addition: a guard against unknown attr names. `DocAttrStep.apply()` consults the doc node's declared attrs (populated by `addDocAttrs()`) and throws if the attr was never contributed. Prevents plugins from accidentally stomping on each other.

### 4.4 `EditorSurface` + `SurfaceRegistry` — multi-surface foundation

**Location**: `packages/core/src/surfaces/` (new directory), exported from `@scrivr/core`.

This is deliberately scoped wider than "headers need an isolated editor." Scrivr is accidentally becoming a **multi-surface document engine** — headers and footers are the first non-body surface, but footnotes, comments, and side annotations will all want the same machinery. Building the registry properly now is cheaper than retrofitting it three features from now.

#### 4.4.1 `EditorSurface` — one isolated editing state

```ts
// packages/core/src/surfaces/EditorSurface.ts

export interface EditorSurfaceInit {
  /** Unique identifier, owner-namespaced (e.g. "headerFooter:default-header:3"). */
  id: SurfaceId;
  /** Which plugin owns this surface — used to route input/commit back. */
  owner: string;
  /** Schema for this surface (may be a restricted derivation of the body schema). */
  schema: Schema;
  /** Initial document content, as PM JSON. */
  initialDocJSON: Record<string, unknown>;
}

export class EditorSurface {
  readonly id: SurfaceId;
  readonly owner: string;
  readonly charMap: CharacterMap;
  readonly schema: Schema;

  private _state: EditorState;
  private _initialJSON: string;
  private _dirty = false;
  private _onUpdate: (() => void) | null = null;

  constructor(init: EditorSurfaceInit) { /* … */ }

  get state(): EditorState { return this._state; }
  get isDirty(): boolean { return this._dirty; }

  dispatch(tr: Transaction): void {
    const docChanged = tr.docChanged;
    this._state = this._state.apply(tr);
    if (docChanged) {
      this._dirty = true;
      this.charMap.clear();
    }
    this._onUpdate?.();
  }

  toDocJSON(): Record<string, unknown> { return this._state.doc.toJSON(); }
}

export type SurfaceId = string;
```

The class has **no header-specific logic**. Future footnote / comment / annotation plugins instantiate `EditorSurface` directly.

#### 4.4.2 `SurfaceRegistry` — per-editor surface lifecycle

```ts
// packages/core/src/surfaces/SurfaceRegistry.ts

export class SurfaceRegistry {
  private surfaces = new Map<SurfaceId, EditorSurface>();
  private _activeId: SurfaceId | null = null;

  register(surface: EditorSurface): void { /* throws on duplicate id */ }
  unregister(id: SurfaceId): void { /* */ }
  get(id: SurfaceId): EditorSurface | null { /* */ }
  getByOwner(owner: string): EditorSurface[] { /* */ }

  /** null ⇒ body is active. */
  get activeId(): SurfaceId | null { return this._activeId; }
  get activeSurface(): EditorSurface | null { /* */ }

  activate(id: SurfaceId | null): void { /* fires onSurfaceChange */ }

  onSurfaceChange(handler: (prev: SurfaceId | null, next: SurfaceId | null) => void): Unsubscribe { /* */ }
}
```

`Editor` owns one `SurfaceRegistry`. There is no `Editor._activeSurface: "body" | "header" | "footer"` enum — that was a POC-ism that hardcodes header/footer assumptions. The only privileged value is `null`, meaning "body is active."

#### 4.4.3 `InputBridge` integration

`InputBridge` takes a `SurfaceRegistry` instead of individual getters:

```ts
// InputBridge constructor
{
  registry: editor.surfaces,
  getBodyState: () => editor.state,
  dispatchBody: (tr) => editor._viewDispatch(tr),
  getBodyCharMap: () => editor.lc.charMap,
}
```

At dispatch time:

```ts
const active = registry.activeSurface;
if (active) {
  active.dispatch(tr);
} else {
  dispatchBody(tr);
}
```

All the other `getState` / `getCharMap` methods follow the same pattern. Future surfaces require zero `InputBridge` changes.

#### 4.4.4 Plugin surface hooks

Plugins that want to own surfaces contribute a new extension lane `addSurfaceOwner()` returning:

```ts
{
  owner: string;  // plugin's namespace
  onActivate?(surface: EditorSurface): void;
  onCommit?(surface: EditorSurface): void;   // fired when commit-worthy
  onDeactivate?(surface: EditorSurface): void;
}
```

`HeaderFooter` registers an owner for `"headerFooter"`. `onCommit` is where it dispatches its `DocAttrStep` against the body document — the plugin decides commit semantics, not core.

**Why this is worth the upfront cost**: the user's feedback (point 4) is right — hardcoding `activeSurface: "body" | "header"` now means every future surface ships with a migration. The registry costs ~150 lines on top of what we needed anyway, and it makes §4.2's `PageChromePaintContext.activeSurface` lookup trivial (`editor.surfaces.getByOwner(contrib.name).find(s => s.id === editor.surfaces.activeId) ?? null`).

---

## 5. `HeaderFooter` plugin — `@scrivr/plugins/header-footer`

Lives entirely in `packages/plugins/src/header-footer/`. The plugin depends on `@scrivr/core` for `Extension`, `DocAttrStep`, `EditorSurface`, `PageChromeContribution`, and the core layout/measurement utilities. Core has no symmetric dependency.

### 5.1 Config shape

```ts
// packages/plugins/src/header-footer/types.ts

export interface HeaderFooterContent {
  type: "doc";
  content: HeaderBlockNode[];
}

export interface HeaderFooterDefinition {
  content: HeaderFooterContent;
  /** Optional lower bound on reserved height (px). Default 0. */
  minHeight?: number;
  /** Optional upper bound on reserved height (px). Content beyond this clips. */
  maxHeight?: number;
}

export interface HeaderFooterPolicy {
  enabled: boolean;

  // Variant flags
  differentFirstPage: boolean;
  differentOddEven: boolean;     // reserved; slots are stubs in v1

  // Default slots (used on every page unless a variant applies)
  defaultHeader?: HeaderFooterDefinition;
  defaultFooter?: HeaderFooterDefinition;

  // First-page slots (used on page 1 when differentFirstPage: true)
  firstPageHeader?: HeaderFooterDefinition;
  firstPageFooter?: HeaderFooterDefinition;

  // Even-page slots (v1 stub — reserved for later)
  evenPageHeader?: HeaderFooterDefinition;
  evenPageFooter?: HeaderFooterDefinition;
}
```

### 5.2 Slot resolution

The resolver takes a `SlotContext` object, not a bare `pageNumber`. This is a cheap forward-compat change: when sections land, `SlotContext` grows a `section` field without any call-site rewrites.

```ts
export interface SlotContext {
  pageNumber: number;
  /** v2: the section this page belongs to. Currently always undefined. */
  section?: SectionId;
}

export function resolveSlot(
  policy: HeaderFooterPolicy | null,
  ctx: SlotContext,
  kind: "header" | "footer",
): HeaderFooterDefinition | null {
  if (!policy?.enabled) return null;

  const isFirst = ctx.pageNumber === 1;
  const isEven = ctx.pageNumber % 2 === 0;

  if (isFirst && policy.differentFirstPage) {
    return policy[kind === "header" ? "firstPageHeader" : "firstPageFooter"] ?? null;
  }
  if (isEven && policy.differentOddEven) {
    return policy[kind === "header" ? "evenPageHeader" : "evenPageFooter"] ?? null;
  }
  return policy[kind === "header" ? "defaultHeader" : "defaultFooter"] ?? null;
}
```

Notes:

- v1 always returns the default slot for even pages (the odd/even branch is dead code under `differentOddEven: false`). Kept for forward compatibility.
- The `section` field is unused in v1 but present in the type, so call sites don't change when sections land. Breaking this signature later is the kind of diff that touches every caller in the plugin + renderer + export.

### 5.3 Extension definition

```ts
// packages/plugins/src/header-footer/HeaderFooter.ts
import { Extension, DocAttrStep } from "@scrivr/core";
import { resolveChrome } from "./resolveChrome";
import { drawPageChrome } from "./drawPageChrome";
import { pageNumberNode, totalPagesNode, dateNode } from "./tokens";

export const HeaderFooter = Extension.create({
  name: "headerFooter",

  addDocAttrs() {
    return { headerFooter: { default: null } };
  },

  addNodes() {
    return {
      pageNumber: pageNumberNode,
      totalPages: totalPagesNode,
      date: dateNode,
    };
  },

  addPageChrome() {
    return {
      name: "headerFooter",
      measure: (input) => {
        const policy = input.doc.attrs["headerFooter"] as HeaderFooterPolicy | null;
        if (!policy?.enabled || input.pageConfig.pageless) {
          return { top: 0, bottom: 0 };
        }
        const resolved = resolveChrome(policy, input);  // measures mini-docs
        return {
          top: resolved.headerHeight,
          bottom: resolved.footerHeight,
          payload: resolved,   // stashed on DocumentLayout._chromePayloads
        };
      },
      render: (ctx) => {
        const resolved = ctx.payload as ResolvedHeaderFooter | undefined;
        if (!resolved) return;
        drawPageChrome(ctx, resolved);
      },
    };
  },

  addCommands() {
    return {
      setHeaderFooter: (policy: HeaderFooterPolicy) => (state, dispatch) => {
        if (dispatch) dispatch(state.tr.step(new DocAttrStep("headerFooter", policy)));
        return true;
      },
      updateHeaderFooter: (partial: Partial<HeaderFooterPolicy>) => /* ... */ ,
      removeHeaderFooter: () => /* ... */ ,
    };
  },
});
```

### 5.4 Restricted schema for header content

Header/footer mini-docs must not contain tables, page breaks, floats, or further nested headers. Implementation:

- Body-only core node specs get `group: "flow-only"` (tables, `pageBreak`, float anchors); header-safe nodes get `group: "block header-safe"`. This tagging happens in core's built-in extensions.
- The plugin builds a derived schema where `doc.content = "header-safe+"` using `Schema.spec.nodes` from the main schema, filtered to the `header-safe` group.
- On `EditorSurface.toDocJSON()` commit, the plugin validates against the restricted schema. Paste from Word that contains a table in the header gets flattened to paragraphs during the paste transformer, not at commit.

---

## 6. Plugin-side measurement — `resolveChrome`

The plugin owns its own measurement pass. It's called from inside the plugin's `addPageChrome().measure` hook (§5.3), not directly by core.

### 6.1 `runMiniPipeline` — a separate, non-recursive entry point

**Running layout inside layout is a landmine** — the measurement pass must not itself trigger another round of chrome aggregation, or a header-footer policy referencing another header-footer policy (or an accidental plugin misuse) would recurse infinitely and silently waste CPU until the call stack blows.

Instead of a `skipPageChrome: true` option on `runPipeline`, core exports a **separate function** that is physically incapable of aggregating chrome:

```ts
// packages/core/src/layout/runMiniPipeline.ts

/**
 * Measurement-only layout pass for mini-documents (headers, footers, footnote
 * content, comment bodies). Physically cannot invoke the addPageChrome lane —
 * aggregateChrome is never called on this code path.
 *
 * The returned DocumentLayout has `metrics = NO_CHROME_METRICS(pageConfig)`,
 * always zero header/footer, always pageless (no real pagination).
 *
 * Use this when you need a block list + natural height for a PM doc without
 * any of the page-chrome machinery.
 */
export function runMiniPipeline(
  doc: Node,
  options: MiniPipelineOptions,
): MiniLayoutResult;
```

`runMiniPipeline` shares all its internals with `runPipeline` — `buildBlockFlow`, `paginateFlow`, `applyFloatLayout`, `buildFragments` — but it bypasses `aggregateChrome` entirely and forces `pageless: true`. Making it a separate export means:

1. **No flag to forget.** You cannot call `runPipeline` and accidentally get a recursive chrome pass.
2. **Clear intent at call sites.** A reviewer sees `runMiniPipeline` and immediately knows it's a contained measurement, not a full document layout.
3. **Test isolation.** `runMiniPipeline` has its own unit tests that assert chrome is never touched.

The public `runPipeline` lives in core and **throws** if `aggregateChrome` is re-entered during its own execution (tracked via a module-level `_chromeDepth` counter incremented on entry / decremented on exit). The throw is the belt-and-suspenders guard behind the `runMiniPipeline` separation — plugin misuse becomes a loud crash, not a silent infinite loop.

### 6.2 `resolveChrome` implementation — per-page contributions

`resolveChrome` measures each variant once, then returns a `ChromeContribution` whose `topForPage(n)` / `bottomForPage(n)` functions look up the right variant for page `n` via `resolveSlot`. No `max()`, no waste — each page gets exactly what its variant reserves.

```ts
// packages/plugins/src/header-footer/resolveChrome.ts

import { runMiniPipeline, naturalHeight } from "@scrivr/core";
import type { PageChromeMeasureInput, ChromeContribution } from "@scrivr/core";
import type { HeaderFooterPolicy, HeaderFooterDefinition } from "./types";
import { resolveSlot } from "./resolveSlot";

interface SlotLayout {
  /** The runMiniPipeline result — used by the renderer at paint time. */
  layout: MiniLayoutResult;
  /** naturalHeight(layout) + minHeight clamp. */
  reservedHeight: number;
}

interface ResolvedHeaderFooter {
  /** Measured layouts keyed by slot variant, used by drawPageChrome at paint. */
  slots: {
    defaultHeader?: SlotLayout;
    defaultFooter?: SlotLayout;
    firstPageHeader?: SlotLayout;
    firstPageFooter?: SlotLayout;
  };
  policy: HeaderFooterPolicy;  // so the renderer can call resolveSlot too
}

function measureSlot(
  def: HeaderFooterDefinition | undefined,
  input: PageChromeMeasureInput,
): SlotLayout | undefined {
  if (!def) return undefined;
  const miniDoc = input.doc.type.schema.nodeFromJSON(def.content);
  const layout = runMiniPipeline(miniDoc, {
    pageConfig: input.pageConfig,
    measurer: input.measurer,
    fontConfig: input.fontConfig,
    // NOTE: runMiniPipeline is physically unable to call addPageChrome.
  });
  const natural = naturalHeight(layout);
  const reservedHeight = Math.max(natural, def.minHeight ?? 0);
  return { layout, reservedHeight };
}

export function resolveChrome(
  policy: HeaderFooterPolicy,
  input: PageChromeMeasureInput,
): ChromeContribution {
  const resolved: ResolvedHeaderFooter = {
    policy,
    slots: {
      defaultHeader: measureSlot(policy.defaultHeader, input),
      defaultFooter: measureSlot(policy.defaultFooter, input),
      firstPageHeader: policy.differentFirstPage
        ? measureSlot(policy.firstPageHeader, input)
        : undefined,
      firstPageFooter: policy.differentFirstPage
        ? measureSlot(policy.firstPageFooter, input)
        : undefined,
    },
  };

  // The lookup tables are pure functions of pageNumber — same input, same
  // output, always. This is what lets computePageMetrics(config, resolved, n)
  // cache one-entry by pageNumber in paginateFlow's hot path.
  const pickHeader = (pageNumber: number): SlotLayout | undefined => {
    const def = resolveSlot(policy, { pageNumber }, "header");
    if (!def) return undefined;
    // Map the definition back to its measured layout.
    if (def === policy.firstPageHeader) return resolved.slots.firstPageHeader;
    return resolved.slots.defaultHeader;
  };
  const pickFooter = (pageNumber: number): SlotLayout | undefined => {
    const def = resolveSlot(policy, { pageNumber }, "footer");
    if (!def) return undefined;
    if (def === policy.firstPageFooter) return resolved.slots.firstPageFooter;
    return resolved.slots.defaultFooter;
  };

  return {
    topForPage: (pageNumber) => pickHeader(pageNumber)?.reservedHeight ?? 0,
    bottomForPage: (pageNumber) => pickFooter(pageNumber)?.reservedHeight ?? 0,
    payload: resolved,
  };
}
```

At paint time, `drawPageChrome` receives `ctx.payload` (typed as `ResolvedHeaderFooter`) and calls `resolveSlot(resolved.policy, { pageNumber: ctx.pageNumber }, …)` to pick the slot layout to draw on each page. Same lookup as `pickHeader`/`pickFooter` — shared via a tiny `pickSlot(resolved, pageNumber, kind)` helper.

### 6.3 `metricsVersion` — the layout-run invalidation key

`aggregateChrome` computes `metricsVersion` by hashing the ResolvedChrome shape:

```ts
function computeMetricsVersion(resolved: ResolvedChrome): number {
  // Any change to any contributor's contribution bumps the version.
  // Since contributions include closures (topForPage / bottomForPage), we
  // can't hash the functions directly — contributors must attach a stable
  // identity hash to their payload.
  let h = 5381;
  for (const [name, contrib] of Object.entries(resolved.contributions)) {
    h = djb2Mix(h, name);
    h = djb2Mix(h, (contrib.payload as { identityHash?: number })?.identityHash ?? 0);
  }
  return h;
}
```

Each contributor is responsible for attaching a stable `identityHash` to its payload, computed from the inputs that affect its output. For `HeaderFooter`:

```ts
payload.identityHash = djb2({
  policy: JSON.stringify(policy),
  contentWidth: input.pageConfig.pageWidth - input.pageConfig.margins.left - input.pageConfig.margins.right,
  fontConfig: canonicalFontConfig(input.fontConfig),
  fontModifiers: canonicalModifiers(input.fontConfig.modifiers),
  dpr: globalThis.devicePixelRatio ?? 1,
});
```

Any change to any of those inputs bumps the contributor's `identityHash`, which bumps the run's `metricsVersion`, which invalidates Phase 1b for that run. This is the single "chrome has changed, redo pagination from scratch" signal.

### 6.4 Caching — correct key

`resolveChrome` is called once per `addPageChrome().measure` invocation, which happens once per layout run. Inside the plugin, memoize on the same inputs that go into `identityHash`:

```ts
interface ChromeCacheKey {
  policyHash: number;        // djb2 over JSON.stringify(policy)
  contentWidth: number;
  fontConfigHash: number;
  fontModifierHash: number;
  devicePixelRatio: number;
}
```

Rules:

- **Do not be clever.** If you add a new measurement input later, add it to both the cache key *and* the `identityHash`. Silent staleness is worse than a cache miss.
- **Hash, don't compare.** JSON.stringify the policy once per invalidation, not per cache hit.
- **Cache one entry.** The working set is almost always 1 — multiple concurrent variants are rare. An LRU is premature.
- **Cache key and `identityHash` must stay in sync.** If one can change without the other, you have a correctness bug. Co-locate the input canonicalization in one helper used by both.

---

## 7. Page-number inline leaf nodes

Contributed by the plugin's `addNodes()` — so these nodes only exist in the schema when the plugin is loaded. Core's schema stays unaware of them.

### 7.1 Node specs (in `packages/plugins/src/header-footer/tokens.ts`)

```ts
export const pageNumberNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  parseDOM: [{ tag: "span[data-page-number]" }],
  toDOM: () => ["span", { "data-page-number": "" }, "#"],
};

export const totalPagesNode: NodeSpec = { /* same shape */ };

export const dateNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {
    format: { default: "locale" },
    /** Frozen ISO string — when set, this date is used instead of "now". */
    frozen: { default: null },
  },
};
```

### 7.2 Measurement placeholder — use the widest digit

The plugin hooks into the core `TextMeasurer` via a general-purpose inline-node measurement contract. Proposed core addition: an `addInlineMeasurer` lane (orthogonal to `addPageChrome`), letting extensions declare custom width for atom inline nodes.

**Non-monospaced fonts**: `"111"` is narrower than `"888"`. If you reserve `width("999")` and paint `"888"`, the painted text overflows — visible clipping on right-aligned headers. The correct approach is to find the widest digit in the current font and reserve `N × widestDigit`:

```ts
function pageNumberPlaceholderWidth(measurer: TextMeasurer, font: string, digits: number): number {
  let widest = 0;
  for (let d = 0; d <= 9; d++) {
    const w = measurer.measure(String(d), font);
    if (w > widest) widest = w;
  }
  return widest * digits;
}
```

Rules:

- `pageNumber` / `totalPages` → `widestDigit × digitCount`, where `digitCount = max(3, Math.ceil(Math.log10(totalPages + 1)))`. Three digits is the floor for the common case.
- `date` → width of the widest formatted date in the configured format (e.g. `"December 30, 2026"` for `"locale-long"`, `"88/88/8888"` for `"locale-short"`).
- Re-layout fires when the reserved-digit-count changes (page 100, page 1000), **not** on every page number increment. The stable-width reservation means digits 1–99 never trigger re-layout at all.

This is a correctness fix, not a polish pass — getting it wrong means text overflow on right-aligned headers, which is visible in the first screenshot.

### 7.3 Paint-time substitution

`drawPageChrome` (the plugin's render hook) walks `resolved.slots.defaultHeader.pages[0]` and substitutes the actual value per-page. Alignment is recomputed on the rendered text — so right-aligned `"Page {n} of {N}"` will visibly shift by a few pixels as digit counts change across pages. **Accept this.** Word and Google Docs have the same behavior; fixing it would require per-page layout which defeats the v1 uniform-height simplification.

### 7.4 `date` freezing

When the user inserts a date token, the UI offers "frozen" (stores today's ISO date in the `frozen` attr) vs "live" (re-evaluated at paint time). **Frozen is the default.** Live dates re-evaluate on every paint and cause collab peers to see different values, and snapshot tests to flake.

---

## 8. Collaboration — `prose_doc_attrs` Y.Map

The collab plugin (`packages/plugins/src/collaboration/YBinding.ts`) adds a sibling `Y.Map("prose_doc_attrs")` alongside the content `Y.XmlFragment`. `YBinding` imports `DocAttrStep` from `@scrivr/core` directly — this is the agreed neutral contract.

### 8.1 Conflict model — Yjs is authoritative

**Critical to get right**: the actual conflict resolution for concurrent header edits is whatever Y.Map does by CRDT rules. Last-writer-wins (Y.Map) or CRDT merge (if we later replace the whole policy with a `Y.Map` of fields). **Version counters are not a source of truth and must not be used as one.** Two peers both bumping a version counter for concurrent edits is a split-brain.

The version counter exists purely as a **local optimization hint** — it lets `YBinding.targetObserver` skip the O(n) `JSON.stringify` comparison on steady-state dispatches where nothing changed locally. When the counters disagree, Yjs has already resolved the conflict; the counter tells us *that* a change happened, not *which* value won.

```ts
interface DocAttrEnvelope<T> {
  /**
   * Local-only sequence number. Incremented by DocAttrStep.apply() on the
   * local peer. Used by YBinding to dedup redundant writes from its own
   * dispatch loop. NOT used for conflict resolution — Yjs handles that.
   */
  localSeq: number;
  value: T;
}
```

Dedup rules:
- `targetObserver` (PM→Y): compare `state.doc.attrs[key].localSeq` against `lastWrittenSeq[key]`. If equal, no local change happened — skip the Y.Map write entirely. If different, write the full envelope.
- `attrsObserver` (Y→PM): always apply — Yjs has already decided the winner. Never compare counters in this direction.
- On initial sync, payload comparison still runs once.

### 8.2 Atomicity of a policy update

A `setHeaderFooter(policy)` command produces **one** `DocAttrStep` which writes **one** envelope to the Y.Map. Updates are atomic at the policy level — a peer doesn't see a partially-updated policy mid-sync. For v1 this is sufficient. If we later want field-level merge (peer A edits header content while peer B edits footer content without clobbering each other), we'd split the envelope into a `Y.Map` of subfields and let Yjs merge per field. Out of scope for v1 — flagged as a v2 upgrade path.

### 8.3 Attr whitelisting

`YBinding` only syncs attrs declared via `addDocAttrs()`. Prevents an extension from accidentally broadcasting private attrs, and prevents schema drift between peers loading different extension sets. The whitelist is read from the `ExtensionManager`'s resolved doc-attr owners map (§4.1).

### 8.4 YBinding does not import from header-footer

Nothing in `YBinding` references `HeaderFooter`, `HeaderFooterPolicy`, `resolveChrome`, or `drawPageChrome`. It only knows about the generic `doc.attrs` shape and `DocAttrStep`. The collab and header-footer plugins are fully decoupled — either can ship without the other.

---

## 9. Rendering flow

Core does not know what a "header" is. The `PageRenderer` iterates `addPageChrome` contributions, calls each plugin's `render` function with a `PageChromePaintContext`, and the plugin is responsible for everything inside its reserved band.

Plugin's `drawPageChrome` (in `packages/plugins/src/header-footer/drawPageChrome.ts`):

1. Receives `ctx.payload` = the `ResolvedHeaderFooter` stashed during `measure`.
2. Picks the active slot for this page via `resolveSlot(policy, pageNumber)`.
3. If `ctx.activeSurface?.name === "headerFooter"`, uses the live `EditorSurface.state.doc` instead of the stored slot content, and populates `EditorSurface.charMap` as it draws.
4. Walks the slot's `DocumentLayout.pages[0].blocks` via the same `drawBlock` code path as the body.
5. Substitutes page-number/date tokens at paint time using `ctx.pageNumber` and `ctx.totalPages`.
6. Renders into the band at `y = 0` (top band) or `y = pageHeight - footerHeight` (bottom band).

Overlay cursor rendering routes through core's existing `addOverlayRenderHandler` chain. When `Editor.activeSurface` is a header/footer surface, the overlay handler for the cursor uses that surface's `charMap` instead of the body's.

---

## 10. PDF export

**Mechanism**: the HeaderFooter plugin contributes PDF handlers via the `addExports()` lane specified in `docs/export-extensibility.md`. `@scrivr/export-pdf` does **not** import anything from `@scrivr/plugins/header-footer` — it iterates all loaded extensions, collects their PDF contributions, and dispatches during page rendering.

Plugin contribution shape:

```ts
addExports() {
  return [
    {
      format: "pdf",
      handlers: {
        chrome: {
          headerFooter: (layoutPage, ctx) => drawHeaderFooterOnPdfPage(layoutPage, ctx),
        },
        nodes: {
          pageNumber: (block, ctx) => ctx.draw.text(String(ctx.layoutPage.pageNumber), { x: ctx.x, y: ctx.y }),
          totalPages: (block, ctx) => ctx.draw.text(String(ctx.editor.ensureLayout().pages.length), { x: ctx.x, y: ctx.y }),
          date: (block, ctx) => { /* frozen or live date */ },
        },
      },
    },
  ];
}
```

In the same PR as canvas rendering:

1. Plugin ships the `addExports()` contribution alongside `addPageChrome()` (the canvas counterpart).
2. PDF export iterates extensions, picks up the handler, draws header/footer bands on every page.
3. Token substitution happens via the `nodes` dispatch table (page-number inline atoms get their own per-type handlers).
4. Three fixtures: default-only, default+firstPage, with page-number tokens.

Without this, `feedback_pdf_parity.md` is violated — but now "parity" means "plugin has an `addExports` contribution," not "edit the monolithic export package." See `docs/export-extensibility.md` for the full design.

---

## 11. Phased delivery

| Phase | Scope | Package | Output | Tests |
|---|---|---|---|---|
| **0** | `PageMetrics` refactor — **per-page from day one**. `computePageMetrics(config, resolved, pageNumber)`, `DocumentLayout.metrics: PageMetrics[]`, `metricsVersion` on `ResolvedChrome`, Phase 1b two-guard cache invariant. Also: `runMiniPipeline` export alongside `runPipeline`. | `@scrivr/core` | No behavior change — with zero contributors the per-page functions all return 0 and metrics reduce to the current hand-computed formula on every page. | Existing tests pass unchanged; new tests for `runMiniPipeline` asserting chrome is never touched; new tests verifying `DocumentLayout.metrics.length === pages.length`; Phase 1b guard tests for `placedContentTop` + `placedMetricsVersion` mismatch |
| **1a** | `DocAttrStep` state primitive + `addDocAttrs()` extension lane with collision-detection merge | `@scrivr/core` | Extensions can additively declare doc attrs; whitelist guard rejects unknown attrs | Unit tests for `DocAttrStep` roundtrip, collision error, whitelist guard |
| **1b** | `addPageChrome()` lane + `aggregateChrome` + `DocumentLayout.metrics` + `DocumentLayout._chromePayloads` + paint-time dispatch in `PageRenderer` | `@scrivr/core` | Generic chrome infrastructure; still zero contributors | Aggregation tests with 0 contributors and with N mock contributors (stacking sanity) |
| **1c** | `SurfaceRegistry` + `EditorSurface` + `InputBridge` surface routing + `addSurfaceOwner()` extension lane | `@scrivr/core` | Multi-surface foundation; body is still the only live surface | Registry lifecycle tests, activation/deactivation hooks, dispatch routing |
| **2** | `HeaderFooter` plugin — config + `resolveChrome` + `addPageChrome().measure` only (no rendering) | `@scrivr/plugins` | Policies installable via commands; `PageMetrics` reflects reserved space; body content shifts down; bands are empty | `resolveSlot`, `resolveChrome`, cache-key correctness, `runMiniPipeline` re-entry crash test |
| **3** | Canvas rendering — `drawPageChrome` + token substitution + page-number node specs + `addInlineMeasurer` lane | `@scrivr/core` (lane) + `@scrivr/plugins` (content) | Headers visible; tokens render with widest-digit stable width | Snapshot tests via happy-dom + `mockCanvas`; non-monospaced font overflow test |
| **4** | Live editing — `HeaderFooter` registers a surface owner, lazy commit, Escape exits | `@scrivr/plugins` | Click into a header, type, Escape to exit; dirty-only commit; no doc mutation on no-op enter/exit | Integration tests for enter/exit/dirty, keyboard routing, no-op exit does not dispatch |
| **5** | Collab — `Y.Map("prose_doc_attrs")` + `DocAttrEnvelope.localSeq` hint + whitelisting | `@scrivr/plugins/collaboration` | Two peers see each other's header edits; concurrent edits resolve via Yjs, not via counter | Two-peer tests: concurrent-same-field, concurrent-different-field, offline reconnect |
| **6** | PDF export parity | `@scrivr/export` | Headers/footers in generated PDFs | Export package tests: default-only, default+firstPage, token substitution |
| **7** | `differentFirstPage` slots end-to-end | All | First-page variant works on canvas, in the editor, in collab, and in PDF | Full-stack fixture tests |

Phases 0 and 1a/1b/1c are pure refactors with no user-visible change — they ship independently and unblock everything else. Phase 2 is config-only and can ship standalone (headers reserve space but render empty) if Phase 3 lags. Phase 1c is larger than originally scoped because the `SurfaceRegistry` is deliberately being built for *all* future surfaces, not just headers; the extra upfront cost is ~150 lines and saves a migration every time a new surface plugin lands.

**The feature flag is extension presence.** Phases 2–7 are all gated by whether `HeaderFooter` is in the user's extensions array. No runtime toggle is added.

---

## 12. Out of scope for v1

- **`differentOddEven`.** Flag is present in the config type; `resolveSlot` never consults it in v1 (dead branch kept for forward compatibility). Per-page metrics already support it, so turning it on later is a one-line change in `resolveSlot`.
- **Section-level header/footer configs.** Requires a sections feature, which Scrivr doesn't have yet. When sections land, `HeaderFooterPolicy` moves from `doc.attrs` to section metadata.
- **Editable via drag / resize handles.** Heights are programmatic in v1. A settings panel or the commands API is the only way to change them.
- **Header/footer in pageless mode.** The plugin's `measure` hook short-circuits on `pageConfig.pageless`, so the whole subsystem is off.
- **Nested tables / floats / page breaks inside headers.** Restricted schema forbids them.
- **Multi-plugin chrome stacking validation.** The `addPageChrome` aggregator sums contributions, but the v1 plan ships with exactly one contributor (`HeaderFooter`). Stacking with future plugins (margin notes, line numbers) is designed-for but not tested.

---

## 13. Resolved questions

### 13.1 Round-one decisions (package structure)

1. **Package for `HeaderFooter`:** `@scrivr/plugins/header-footer`. Core stays lean; the feature is opt-in.
2. **Page-number / date node definitions:** same plugin package. Core schema does not declare them.
3. **`YBinding` ↔ `DocAttrStep` boundary:** `DocAttrStep` lives in core at `packages/core/src/state/DocAttrStep.ts`, exported from `@scrivr/core`. `YBinding` and `HeaderFooter` both import it directly. `DocAttrStep` **is** the neutral contract — it's a general state primitive, not a feature-specific API.
4. **Feature flag:** extension presence. No runtime toggle. When `HeaderFooter` is absent from the extensions array:
   - `addDocAttrs()` contributes nothing → schema has no `headerFooter` attr → `DocAttrStep("headerFooter", …)` throws on apply (by the §4.3 whitelist guard).
   - `addPageChrome()` contributes nothing → `aggregateChrome` returns zero reservations → `PageMetrics` is identical to pre-header behavior → zero cost in the layout hot loop.
   - `PageRenderer` iterates zero chrome renderers.
   - `addNodes()` contributes nothing → `pageNumber` / `totalPages` / `date` don't exist in the schema → can't be inserted anywhere → no runtime check needed.

### 13.2 Round-two decisions (review pushback)

Eight pressure-tests from the design review, each resolved in the plan:

1. **Mini-layout recursion** (§6.1) → separate `runMiniPipeline` export that is *physically* unable to call `aggregateChrome`. No shared flag. Belt-and-suspenders: `runPipeline` tracks a module-level recursion depth and throws if re-entered.
2. **Cache key correctness** (§6.3) → key includes `policyHash`, `contentWidth`, `fontConfigHash`, `fontModifierHash`, `devicePixelRatio`. Font changes invalidate the cache. "Don't be clever" is a documented rule.
3. **Uniform-height UX waste** (§3, §6) → **rejected the shortcut.** Uniform height was a false economy — the visible "why is there empty space on page 2?" bug is not acceptable tech debt, and the refactor cost was overstated. `PageMetrics` is now per-page from day one (`DocumentLayout.metrics: PageMetrics[]`, one entry per page), `computePageMetrics` takes a page number, and `ChromeContribution` exposes `topForPage(n)` / `bottomForPage(n)` functions. `metricsVersion` on `ResolvedChrome` is the single invalidation signal for Phase 1b. No `TODO(v2)`, no future migration — right the first time.
4. **`activeSurface` as a global switch** (§4.4) → replaced with a full `SurfaceRegistry` and `EditorSurface` primitive, both in core. No `"body" | "header"` enum anywhere. Plugins register owners via a new `addSurfaceOwner()` lane. This is the "lean into the multi-surface architecture" strategic suggestion baked into the plan.
5. **`addDocAttrs` collision** (§4.1) → fail fast at `ExtensionManager` schema-build time with an error naming both owners. Extensions are expected to namespace (`headerFooter`, `trackChanges`).
6. **Token placeholder width** (§7.2) → use widest digit in the current font (`max(width(0..9)) × digitCount`), not `width("999")`. Non-monospaced fonts would otherwise clip right-aligned headers.
7. **Collab version counter as source of truth** (§8.1) → renamed to `localSeq` and documented as a local dedup hint only. Yjs is authoritative for conflict resolution. `attrsObserver` (Y→PM) never compares counters.
8. **`resolveSlot` signature** (§5.2) → takes a `SlotContext` object with `pageNumber` (v1) and an unused `section?` field (v2 forward-compat). Changing the signature later would touch every caller.

### 13.3 Strategic framing

Scrivr is accidentally becoming a **multi-surface document engine**. This plan deliberately builds that framework once, up front, in Phase 1c:

- `EditorSurface` — isolated state + charmap
- `SurfaceRegistry` — lifecycle + activation routing
- `addSurfaceOwner()` — plugin registration
- `PageChromeContribution` — reserve + render hooks keyed by owner

Future surface plugins (footnotes, comments, margin annotations, side notes) compose these primitives without touching core. The header-footer plugin is the first consumer, but the APIs are not header-shaped.

---

## 14. References

- POC commit: `736ba7d` on branch `feat/header-footer`
- Prerequisite: `docs/pagination-model.md` (the `PageMetrics` refactor)
- PDF parity rule: memory `feedback_pdf_parity.md`
- Tables plan (different surface, same author): `docs/tables.md`
- Fragment architecture (affected by Phase 1b cache guard): `docs/layout-fragment-architecture.md`
