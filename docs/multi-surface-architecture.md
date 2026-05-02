# Multi-Surface Architecture

Status: **design** — synthesises the header/footer plan, the footnote pressure-test, and the comments-as-markers decision into one architectural reference.

> **Partially superseded.** The frame and primitives (surfaces, regions,
> chrome contributions) remain valid and align with the systems-design
> rules surfaced in [`docs/anchored-objects/07-extensibility.md`](./anchored-objects/07-extensibility.md).
> Sections referencing the CSS-float-era layout pipeline
> (`applyFloatLayout`, single-side wrap constraints) are stale — the
> current model is exclusion rectangles + `LineSpace.segments[]` shared
> by every wrap mode.

**Companion doc**: `docs/header-footer-plan.md` is the first concrete surface feature and specifies the prerequisite refactors (`PageMetrics`, extension lanes, `DocAttrStep`, `SurfaceRegistry`). This doc is the broader frame it fits into — read this to understand *why* those primitives exist and what else will be built on top.

---

## 1. Why multi-surface

Scrivr started as "one document, one editor, one layout pipeline." Headers/footers revealed that this framing can't grow. What we're actually building is:

> **A document system composed of multiple surfaces, each with its own role in layout, paint, and input.**

Headers/footers are the first instance, but the same abstraction needs to accommodate footnotes, comments, margin notes, sidenotes, and eventually side-by-side editors. If we design the primitive once, correctly, all of those features land as extensions without a core rewrite. If we hardcode `if (activeSurface === "header")` branches now, we pay for every future feature twice.

The goal of this doc is to pin down the primitives, the taxonomy, and the invariants before we write code — so the header-footer implementation sets up the right seams for everything that follows.

---

## 2. Taxonomy — two surface kinds + a marker facility

Not everything that lives on a page is a surface. The clean split:

| Kind | Has own `EditorState` | Part of `SurfaceRegistry` | Example |
|---|---|---|---|
| **flow** | ✓ | ✓ | body document |
| **chrome** | ✓ | ✓ | header, footer, footnote band |
| **marker facility** | — (lightweight data only) | ✗ — separate headless lane | comments, @mentions, tracked-change refs |

**Why the collapse from an earlier `flow | chrome | island | overlay` sketch**:

1. **"Island" was conflating two things**: anchored + editable + layout-impacting (footnotes) vs anchored + lightweight + non-layout-impacting (comments). Footnotes are chrome surfaces with body anchoring; comments are markers. The kind `island` doesn't earn its keep once you make that split.
2. **Comments are markers, not surfaces.** v1 comments are anchored positions/ranges in the flow doc with a headless API; the app brings its own comment editor if it wants rich text. Core ships a simple text input only. This keeps `SurfaceRegistry` lean and matches the existing pattern used by track-changes and ai-suggestion. See memory `project_comments_headless.md`.

**Out of scope, still works**:

- **Overlay painters** (cursors, selections, AI ghost text, suggestion highlights, tracked-change cursor colour) are handled by the existing `addOverlayRenderHandler` lane in `OverlayRenderer`. They are decorators that read the active surface's state and paint on top — no `EditorState`, no commit lifecycle, no entry in `SurfaceRegistry`. This architecture does not change how overlay painters work; it just makes them aware of *which* surface is active so the cursor follows keyboard focus into a header or footnote body. See §3.6 for the one small plumbing change.
- **Nested flow surfaces** (side-by-side editors, embedded docs). Exactly one flow surface per `Editor`. Relaxing this would require pagination to understand multiple independent flow documents, which is a separate, harder feature.

---

## 3. Core primitives

All of these live in `@scrivr/core`. Plugins compose them to build concrete surface features.

### 3.1 `Surface` + `SurfaceRegistry`

Defined in `docs/header-footer-plan.md` §4.4. Key points:

- `EditorSurface` is the generic isolated-editing primitive: own `EditorState`, own `CharacterMap`, dirty tracking, JSON roundtrip. No header-specific logic.
- `SurfaceRegistry` is keyed by opaque `SurfaceId` strings. `null` is the only privileged value and means "body is active." There is no `"body" | "header" | "footer"` enum.
- `InputBridge` takes a `SurfaceRegistry` and routes keystrokes to whichever surface is active.
- Plugins register ownership via an `addSurfaceOwner()` extension lane and manage their own internal per-instance state.

**This doc's amendment**: the taxonomy collapse (§2) means `SurfaceRegistry` only handles `flow` and `chrome` kinds. Markers and overlay painters are separate lanes. This makes the registry simpler than the header-footer plan's Phase 1c initially scoped — there's no `island` kind to special-case.

### 3.2 `DocAttrStep`

Defined in `docs/header-footer-plan.md` §4.3. State primitive for mutating `doc.attrs` as a proper ProseMirror `Step` that participates in undo/redo and collab. Lives in `packages/core/src/state/DocAttrStep.ts`, exported from `@scrivr/core`.

Used by:
- `HeaderFooter` plugin to store policy in `doc.attrs["headerFooter"]`
- `Footnotes` plugin to store bodies in `doc.attrs["footnotes"]` (see §8.1)
- `YBinding` collab plugin to sync doc-level attrs via a sibling `Y.Map`
- Any future extension contributing doc-level state

### 3.3 `PageChromeContribution` + `aggregateChrome`

Defined in `docs/header-footer-plan.md` §4.2. The extension lane that lets plugins reserve vertical space on pages and paint into it from outside core.

**This doc's amendment**: the `PageChromeContribution` shape needs to grow to support **iterative** contributors (footnotes) alongside single-pass ones (headers/footers). See §3.4.

### 3.4 `LayoutIterationContext` — NEW primitive

This is the abstraction the header-footer plan couldn't anticipate because it only dealt with single-pass chrome. Footnotes force the layout pipeline to iterate to a fixed point, which means contributors need an iteration context and a stability signal.

```ts
// packages/core/src/layout/LayoutIterationContext.ts

export interface LayoutIterationContext {
  /** Monotonic run id — increments on every full layout run. */
  runId: number;
  /** 1-indexed iteration within the current run. */
  iteration: number;
  /** Hard cap on iterations; aggregator gives up past this. */
  maxIterations: number;
  /**
   * Opaque per-contributor state from the previous iteration of THIS run.
   * Null on iteration 1. Contributors use this to detect stability by
   * comparing their current output to their previous output.
   */
  previousIterationPayload: unknown | null;
  /**
   * Opaque per-contributor state from the PREVIOUS run's final iteration.
   * Null on first run. Enables cross-run seeding so steady-state edits
   * converge in iteration 1.
   */
  previousRunPayload: unknown | null;
  /**
   * The flow layout produced using the previous iteration's chrome.
   * Null on iteration 1. Contributors that depend on flow layout
   * (footnotes) read this to compute their contribution.
   */
  currentFlowLayout: DocumentLayout | null;
  /**
   * The previous run's final flow layout. Used for iteration-1 seeding
   * checks — contributors can compare their cached anchor→page mapping
   * against this to decide whether their previousRunPayload is still
   * valid without having to wait for iteration 2.
   */
  previousRunFlowLayout: DocumentLayout | null;
}
```

The `ChromeContribution` return type grows a `stable: boolean` field:

```ts
export interface ChromeContribution {
  topForPage(pageNumber: number): number;
  bottomForPage(pageNumber: number): number;
  payload?: unknown;
  /**
   * True when this contributor has reached a fixed point for its own
   * inputs. Headers always return true (no flow dependency). Footnotes
   * return true when the anchor→page assignment equals the previous
   * iteration's. The aggregator converges when ALL contributors report
   * stable in the same iteration.
   */
  stable: boolean;
}
```

And the measure hook takes the iteration context:

```ts
export interface PageChromeContribution {
  name: string;
  measure(
    input: PageChromeMeasureInput,
    ctx: LayoutIterationContext,
  ): ChromeContribution;
  render(ctx: PageChromePaintContext): void;
}
```

**The aggregator loop** (replaces the single-shot `aggregateChrome` in the header-footer plan):

```ts
function runChromeLoop(
  flow: Node,
  config: PageConfig,
  extensions: Extension[],
  runId: number,
  prevRunPayloads: Record<string, unknown>,
  prevRunFlowLayout: DocumentLayout | null,
): LayoutResult {
  const MAX_ITERATIONS = 5;
  let currentFlowLayout: DocumentLayout | null = null;
  let prevIterationPayloads: Record<string, unknown> = {};
  let converged = false;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const contributions: Record<string, ChromeContribution> = {};
    let allStable = true;

    for (const ext of extensions) {
      const contrib = ext.addPageChrome?.();
      if (!contrib) continue;

      const ctx: LayoutIterationContext = {
        runId, iteration, maxIterations: MAX_ITERATIONS,
        previousIterationPayload: prevIterationPayloads[contrib.name] ?? null,
        previousRunPayload: prevRunPayloads[contrib.name] ?? null,
        currentFlowLayout,
        previousRunFlowLayout: prevRunFlowLayout,
      };

      const measured = contrib.measure(input, ctx);
      contributions[contrib.name] = measured;
      if (!measured.stable) allStable = false;
    }

    const resolved: ResolvedChrome = {
      contributions,
      metricsVersion: 0, // finalized after convergence
    };
    currentFlowLayout = runFlowPipeline(flow, config, resolved);

    if (allStable) {
      converged = true;
      break;
    }

    prevIterationPayloads = {};
    for (const [name, c] of Object.entries(contributions)) {
      prevIterationPayloads[name] = c.payload;
    }
  }

  const finalResolved = finalizeResolvedChrome(
    /* contributions from last iteration */,
    runId,
  );

  return {
    layout: currentFlowLayout!,
    resolved: finalResolved,
    converged,
  };
}
```

**Key properties**:
- Headers always report `stable: true` on iteration 1 → loop exits after 1 iteration if they're the only contributor. No change in behavior vs the single-pass plan.
- Footnotes report `stable: false` until the anchor→page assignment stabilizes → loop runs 2–3 iterations typically.
- Steady-state editing with `previousRunPayload` seeding: footnotes can report `stable: true` on iteration 1 by comparing the seed against `previousRunFlowLayout`. One-iteration convergence is the common case for edits.
- Non-convergence after `MAX_ITERATIONS` = 5: silent graceful degradation (accept last iteration's layout), `__LAYOUT_DEBUG__` warning, `DocumentLayout.convergence: "stable" | "exhausted"` for tests.

See §8.2 and §8.6 for footnote-specific details on how contributors use this.

### 3.5 Marker facility — NEW primitive

Comments, @mentions, and tracked-change refs all need the same thing: **an anchor in flow content + headless events + optionally a lightweight text payload**. This is not a surface; it's a separate lane.

```ts
// packages/core/src/markers/Marker.ts (tentative)

export interface MarkerSpec<TData = unknown> {
  /** Unique id — plugin-owned namespace. */
  type: string;
  /** Optional PM mark or inline node that carries the anchor. */
  anchorNode?: NodeSpec;
  anchorMark?: MarkSpec;
}

export interface MarkerInstance<TData = unknown> {
  id: string;
  type: string;
  /** Resolved PM positions, re-derived every layout run. */
  anchor: { from: number; to?: number };
  data: TData;
}

export interface MarkerFacility {
  register<T>(spec: MarkerSpec<T>): MarkerHandle<T>;
}

export interface MarkerHandle<T> {
  add(anchor: { from: number; to?: number }, data: T): string;
  remove(id: string): void;
  get(id: string): MarkerInstance<T> | null;
  list(): MarkerInstance<T>[];
  onAnchorMoved(handler: (id: string, newAnchor: Anchor) => void): Unsubscribe;
  onAdded(handler: (id: string) => void): Unsubscribe;
  onRemoved(handler: (id: string) => void): Unsubscribe;
}
```

**How each marker plugin uses this**:

- **Comments**: `commentsHandle = markers.register({ type: "comment", anchorMark: commentRangeMark })`. Comment bodies are stored in `doc.attrs["comments"]: Record<CommentId, { text: string, author, createdAt, resolved }>`. Core ships a minimal click-to-edit text input overlay; apps can disable it and render their own comment panel using the headless API.
- **@mentions**: `mentionsHandle = markers.register({ type: "mention", anchorNode: mentionInlineNode })`. Data is `{ userId, displayName }`.
- **Tracked change refs** (existing feature, mapped onto this facility): `tcHandle = markers.register({ type: "trackedChange", anchorMark: tcMark })`. Not a v1 migration, but the shape should match so we can consolidate later.

**Why markers don't need the Surface system**:
- No independent `EditorState` — the anchor lives in the flow doc.
- No separate commit lifecycle — marker data changes go through `DocAttrStep` against the flow doc.
- No independent input routing — clicks on markers are handled by the flow surface's existing event path plus a hit-test lookup.

### 3.6 Hit-testing — surface resolution

When a click arrives, the hit test resolves to `{ surfaceId, pos }`, not just `pos`. The resolution order:

1. **Chrome bands first**: is the click inside any registered chrome contributor's reserved band? If yes, the contributor's `hitTest(x, y, pageNumber)` hook decides which specific instance (e.g. which footnote) and returns a surface id.
2. **Flow**: otherwise it's in the body; the flow surface resolves the position via `CharacterMap`.
3. **Markers on flow**: after the flow position is resolved, iterate registered marker handles to see if any anchor contains that position. If yes, emit a marker click event (e.g. "comment X clicked") *in addition to* activating the flow surface at that position. Markers don't steal focus from the flow by default.

The specific modifier-key behavior (click anchor vs jump to footnote body, etc.) is plugin-specific — see §8.5 for the footnote hit-test rules.

---

## 4. Invariants

These are the load-bearing rules the architecture enforces. Violating any of them breaks something downstream.

1. **Flow is the only source of spatial truth.** Every rendered position on the page is derived from the flow layout, either directly (body content) or via anchor projection (footnotes, markers). No surface stores its own screen coordinates.
2. **Island-like surfaces derive position from flow, never store it.** A footnote's page/y is computed every layout run from its anchor's resolved position. Storing cached coordinates leads to drift bugs.
3. **Chrome may depend on flow, but only via bounded iteration.** Iterative chrome contributors use `LayoutIterationContext` and must converge within `MAX_ITERATIONS`. Non-convergence degrades gracefully, never loops forever.
4. **Iteration must converge or degrade gracefully.** Hard cap + sticky fallback rules + silent last-iteration acceptance.
5. **`editor.state` always refers to the flow surface.** Input routing changes based on `activeSurface`, but document identity (state, commands, subscribers) always means the flow doc. Otherwise save hooks and commands silently target the wrong state.
6. **Surfaces are stateful; markers are not.** Surfaces own `EditorState` and participate in the commit/undo lifecycle. Markers are anchored data with a headless API — they live in the flow doc as marks or inline nodes plus a side table in `doc.attrs`, and mutate through `DocAttrStep` on the flow doc's history. Overlay painters (the existing `addOverlayRenderHandler` lane) are not part of this split — they're stateless decorators and neither own state nor count as markers.
7. **Chrome contributors must be deterministic and independent.** Same input → same output. Contributors must not depend on each other's outputs — the aggregator sums in an unspecified order. Chrome-on-chrome dependencies are not supported.
8. **Anchor identity is stable across transactions.** PM structural sharing guarantees this in practice, but footnote bodies, collab sync, and cache keys all implicitly depend on it. Contributors must not re-create anchor nodes when the surrounding content changes.
9. **Iteration payloads are run-scoped by default.** Cross-run seeding requires explicit `previousRunPayload` plumbing; contributors opt into persistence.

---

## 5. Surface kinds in detail

### 5.1 `flow` surface

- Exactly one per `Editor`.
- Owns the `EditorState` that `editor.state` points to.
- Drives pagination via `runPipeline`.
- Hit-tests via `CharacterMap`.
- Storage: the main doc, synced to `Y.XmlFragment` in collab.

### 5.2 `chrome` surface

- Zero or more per `Editor`.
- Reserves vertical space on each page via `ChromeContribution.topForPage` / `bottomForPage`.
- Measured independently from flow (runs `runMiniPipeline`, never `runPipeline`).
- Paints into its reserved band via `render(PageChromePaintContext)`.
- May own one or more `EditorSurface` instances for live editing (headers, footers, footnote bodies).
- Storage: varies by plugin. Headers/footers live in `doc.attrs["headerFooter"]`; footnotes live in `doc.attrs["footnotes"]`.

**Non-iterative chrome** (headers, footers):
- `measure()` ignores `LayoutIterationContext.currentFlowLayout`.
- Always returns `stable: true`.
- Loop exits after iteration 1.

**Iterative chrome** (footnotes):
- `measure()` reads `LayoutIterationContext.currentFlowLayout` to compute anchor→page assignment.
- Returns `stable: true` only when the new assignment matches the previous iteration's.
- Typically converges in 2–3 iterations; steady-state edits converge in 1 via `previousRunPayload` seeding.
- See §8 for the full walk-through.

### 5.3 Iterative chrome pattern

Any future feature that reserves page space and depends on flow layout follows this pattern:

- Keep-with-next constraints (widow/orphan control that reserves space for a few lines of the next block)
- Balanced columns (reserve space to equalize column heights)
- Side margin notes (reserve side band whose width depends on note content that depends on flow pagination)

All of these would plug into the same `LayoutIterationContext` mechanism. The footnote implementation is the reference case.

---

## 6. Worked example: headers and footers

**This is the first concrete surface feature.** The full implementation plan is `docs/header-footer-plan.md` — this section is just the placement in the architecture.

**Classification**: non-iterative chrome + one `EditorSurface` per header/footer band.

**Why it's the first**: it exercises everything except iteration. Getting headers right proves out:

- `DocAttrStep` + `addDocAttrs()` lane
- `PageChromeContribution` + `aggregateChrome` (single-pass mode)
- `SurfaceRegistry` + `EditorSurface` + `addSurfaceOwner`
- `PageMetrics` per-page refactor (Phase 0)
- `runMiniPipeline` for measurement without recursion
- Y.Map sibling collab pattern
- PDF export parity

**Once headers ship**, adding iterative chrome for footnotes is additive: the one new piece is `LayoutIterationContext` + the `stable` bit on `ChromeContribution`, which can be introduced with default values that preserve existing header behavior (`stable: true` on iteration 1, no context dependency).

---

## 7. Worked example: comments as markers

**Classification**: marker facility, not a surface.

### 7.1 Storage

- **Anchors**: a PM mark (`comment_range`) on the flow doc. Range marks give us both point comments (zero-width) and range comments (selection-based) uniformly.
- **Bodies**: `doc.attrs["comments"]: Record<CommentId, CommentBody>` where `CommentBody = { text: string, author, createdAt, resolved }`. `text` is a plain string in v1.
- **Mutation**: `DocAttrStep` against the flow doc. One undo stack, unified collab.

### 7.2 Headless API

```ts
editor.comments.add(range, text)
editor.comments.remove(id)
editor.comments.resolve(id)
editor.comments.list()
editor.comments.onAdded(handler)
editor.comments.onAnchorMoved(handler)
editor.comments.onResolved(handler)
```

A minimal built-in overlay handler renders a pill at comment anchor positions and opens a simple `<textarea>` popover on click. Apps that want a proper comment panel **disable the built-in overlay** and drive the UI themselves using the events.

### 7.3 Why not a surface

See memory `project_comments_headless.md`. Short version: a full `EditorSurface` per comment would be ~500 lines of infrastructure for a feature most consumers will want to customize anyway. Shipping rich-text comments in core is a slippery slope (mentions, reactions, threads, images) that's better owned by the app layer.

### 7.4 What Word / Docs do

Both Word and Google Docs ship rich-text comments with a dedicated sidebar and threading. **We deliberately don't.** Scrivr's comment feature is a primitive that consumer apps can build on, not a finished product. This is the one place we deviate from the "match Word/Docs conventions" rule in memory `feedback_convention_alignment.md`, and the deviation is intentional because we can't ship a comment product that satisfies both document-editing and knowledge-management use cases without over-committing core.

---

## 8. Worked example: footnotes (the big one)

**Classification**: iterative chrome + lazily-created per-footnote `EditorSurface` instances, all managed by a single plugin owner `"footnotes"`.

This is the feature that forced `LayoutIterationContext` into existence. Every subsection below corresponds to a subtle point the design needs to get right.

### 8.1 Data model

```ts
// packages/plugins/src/footnotes/types.ts

/**
 * Inline anchor node in the flow doc. This is the ONLY representation
 * of the footnote in flow content. The body lives out of flow.
 */
export const footnoteRef: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  attrs: {
    /** Stable identifier, generated by the UniqueId extension. */
    id: { default: null },
  },
  parseDOM: [{ tag: "sup[data-footnote-ref]", getAttrs: (el) => ({ id: el.getAttribute("data-id") }) }],
  toDOM: (node) => ["sup", { "data-footnote-ref": "", "data-id": node.attrs.id }],
};

/**
 * Footnote bodies, stored in doc.attrs keyed by id.
 * NEVER garbage collected — orphaned bodies survive across undo history.
 */
export interface FootnoteBody {
  /** ProseMirror JSON for the body content. */
  content: Record<string, unknown>;
}

// doc.attrs["footnotes"]: Record<FootnoteId, FootnoteBody>
```

**Invariants**:

- The ref is the source of truth for **existence and ordering**. Footnote numbering (1, 2, 3…) is derived at render time from the document-order traversal of ref nodes.
- The body is just content storage. It has no number, no page assignment, no position — all of those are derived every layout run.
- **Never GC orphaned bodies.** Deleting a ref and hitting undo must restore the footnote intact. Since undo history is unbounded in principle, v1 never GCs. Cleanup happens on explicit save-and-reload / export, where history is discarded.
- **ID generation delegates to `UniqueId`** (existing extension per `project_ai_toolkit_plan.md`). On paste, the paste transformer re-keys colliding ids. Re-keying is a shared concern with track-changes and ai-suggestion — extract it into a core utility.
- **Anchor identity is stable across edits.** PM structural sharing gives this automatically, but the invariant is load-bearing for the `WeakMap<Node, FootnoteState>` caches we'll want.

### 8.2 Layout loop

Footnotes are an iterative chrome contributor. Their `measure()` reads `ctx.currentFlowLayout`, computes which ref anchor lands on which page, measures the footnote bodies for each page, and returns per-page `bottomForPage(n)`.

**Formal algorithm**:

```
Iteration 1 (no currentFlowLayout, or seeded from previousRunPayload):
  - If previousRunPayload exists AND previousRunFlowLayout anchors match:
    - Return seeded bottomForPage + payload, stable: true
    - (Common case: steady-state edit, 1-iteration convergence)
  - Otherwise:
    - Return bottomForPage: 0 for all pages, stable: false
    - (Forces iteration 2 with a real flow layout)

Iteration 2+:
  - Compute assignment: map every footnote_ref node → its page number (via currentFlowLayout)
  - Group refs by page: footnotesByPage[pageNumber] = [refId1, refId2, ...]
  - For each page, measure the bodies of its footnotes via runMiniPipeline
  - Apply sticky spill: if a footnote was spilled forward in a previous iteration of THIS run, keep it forward
  - If sum of footnote heights on page P exceeds the band capacity:
    - Spill the last footnote forward to page P+1 (mark it sticky)
    - Emit a "continuation" marker for the spilled footnote on page P's band
    - Re-measure page P and P+1
  - Return bottomForPage(n) = sum of heights assigned to page n (including any continuation markers)
  - Compare new assignment to ctx.previousIterationPayload.assignment
  - stable: true iff assignment is identical (same set of ids per page, same order)
  - payload: { assignment, spilledIds: Set<FootnoteId>, heightsByPage }
```

**Convergence criterion**: assignment equality, not pixel equality. Two iterations are "the same" when every anchor lands on the same page in both. Heights can drift by a pixel or two due to measurement noise without that counting as instability.

### Sticky spill — why it's required

Naïve spill oscillates. Concrete scenario:

1. Iteration 2: page N has footnotes A, B, C. Sum exceeds band capacity. Spill C to page N+1.
2. Page N's band shrinks. Content reflows — a paragraph moves from N+1 to N.
3. Iteration 3: the moved paragraph pulls C's anchor back to page N. Re-running the "assign to anchor's page" rule puts C back on N. Overflow. Spill again. Goto 2.

**Sticky spill fix**: once a footnote is marked `spilledIds.add(C)` in iteration K, subsequent iterations within the same run keep C on N+1 regardless of where its anchor lands. On a new layout run, `spilledIds` resets — the new run gets a fresh chance to place C without the sticky constraint, and usually the edit that triggered the re-layout has resolved the overflow.

This matches Word and InDesign's behavior: an "orphaned footnote body" (body on a different page from its ref) is a known typesetting state with a visible continuation marker, not a bug.

### What Word / Docs do

| Case | Word | Google Docs | Scrivr v1 |
|---|---|---|---|
| Footnote numbering | Auto-number, doc order | Auto-number, doc order | Auto-number, derived from anchor doc order at render time |
| Number restart | Per-section option | No | Not supported (sections not yet modelled) |
| Body too tall for band | Split at line boundary, continuation notice | Best-effort, may overflow oddly | Split at line boundary (§8.7), "(cont. from p. N)" marker |
| Anchor moves to new page | Body follows | Body follows | Body follows (derived from anchor every run) |
| Delete ref | Body removed, renumber | Body removed, renumber | Body orphaned (kept for undo), numbering re-derived (orphan invisible) |
| Paste ref from another doc | Re-key | Re-key | Re-key via paste transformer |

**Max iterations**: `MAX_ITERATIONS = 5`. On exhaustion: silent graceful degradation (accept last iteration's output), `__LAYOUT_DEBUG__` warning, `DocumentLayout.convergence: "exhausted"` flag for tests. No user-visible error.

**Streaming layout compatibility**: iteration is incompatible with chunked layout (`maxBlocks` / `LayoutResumption`). v1 disables streaming when footnotes are present. Footnote-heavy documents tend to be short (papers, articles), so streaming is less valuable for them anyway. Flagged in §11 for revisit.

### 8.3 Surface registration

**One plugin owner, lazy per-footnote surfaces.**

```
SurfaceRegistry:
  addSurfaceOwner("footnotes", FootnoteSurfaceOwner)

FootnoteSurfaceOwner (plugin-internal):
  cache: Map<FootnoteId, EditorSurface>

  activateNote(id):
    surface = cache.get(id) ?? createSurface(id)
    surface.mount(SurfaceRegistry, `footnotes:${id}`)
    SurfaceRegistry.activate(`footnotes:${id}`)

  deactivateNote(id):
    SurfaceRegistry.unregister(`footnotes:${id}`)
    // Keep in internal cache for quick re-activation
```

Rules:
- **Lazy creation**: an `EditorSurface` for note X is created only when the user first clicks on X's body. Cold notes re-hydrate from `doc.attrs["footnotes"][id].content` on next activation.
- **Registry-level visibility**: only the currently-active note is registered in `SurfaceRegistry`. Hot-but-inactive notes stay in the plugin's internal `Map`. Cold notes exist only as JSON.
- **Commit on deactivate**: when the user leaves a footnote body (Escape, click elsewhere, focus loss), if the surface `isDirty`, dispatch a `DocAttrStep` writing the new content back into `doc.attrs["footnotes"][id].content`. Not-dirty → no-op, no undo pollution.
- **IDs are opaque to core**: `"footnotes:note-3"` is a plugin convention; `SurfaceRegistry` doesn't parse it.

Why not eager: a 50-footnote paper shouldn't allocate 50 `EditorState` instances at load. Lazy keeps activation O(interaction), not O(document).

### 8.4 Anchor position tracking

- Each `footnote_ref` node has a PM position in the flow doc (its `nodePos`).
- During every layout run, after flow pagination completes, the footnote contributor walks the flow layout's fragments to find which page each ref's `nodePos` landed on.
- **Footnote bodies do not store coordinates.** The `(pageNumber, y)` location of a footnote body is always computed from the current layout run, never cached.
- When the user types in the body and anchors move via normal PM position mapping, the next layout run places footnote bodies at their new anchors' pages automatically.

**Active-editing subtlety**: when the user is editing a footnote body, keystrokes only affect that footnote's mini-doc — the flow doc is unchanged in the general case. But the footnote's height may change per keystroke (line wrap), which changes that page's chrome band, which may reflow body content, which may migrate the anchor to a different page.

Optimizations:
- **`scopeToPage`** (existing core machinery per `project_layout_perf_plan.md`): re-run only the affected page's chrome measurement and re-paginate from that page forward. In the common case (body grows one line, no anchor migration), this is O(single page).
- **Migration follows the cursor**: if the anchor moves to a different page mid-edit, the active surface stays active on the new page without the user noticing. The surface `id` is unchanged; only its rendered position moves.

### 8.5 Hit testing

**Click in the footnote band of page N** (`y ∈ [footerTop, footerTop + footerHeight]`):

1. Compute `y - footerTop` relative offset within the band.
2. Walk `footnotesByPage[N]` (cached in the contributor's payload); each footnote has a `yStart` / `yEnd` within the band.
3. Find the footnote whose range contains the click.
4. **Gap between footnotes**: activate the nearest footnote (matches Word). Don't no-op.
5. Activate surface `"footnotes:<id>"` at the clicked position within the body.

**Click on a footnote ref in the body**:

| Modifier | Behavior |
|---|---|
| Plain click | Select the ref node (treat as atom selection) |
| Cmd/Ctrl+click | Jump to the footnote body on its current page |
| Double-click | Jump to the footnote body |
| Right-click | Context menu (edit / delete / convert to endnote) |

This is **Word's behavior**, not Google Docs' (Docs single-click jumps, which is surprising when editing near a ref). Word's behavior also matches `feedback_convention_alignment.md` implicitly — the default when Word and Docs disagree is the less-surprising one for power users.

**Cross-surface viewport sync**: jumping from a ref to its body requires scrolling if the target is offscreen. Scroll machinery accepts `{ surfaceId, pos }` tuples instead of just `pos`. Same for Escape-back jumps from body to ref.

**Tab inside footnote body**: inserts a tab character (matches both Word and Docs). Does NOT escape the surface.

**Shift-Tab at start of footnote body**: jumps back to the ref (Word's behavior; Docs no-ops). Worth doing because it matches expected surface-exit semantics elsewhere.

### 8.6 `metricsVersion` + iteration

Two-level versioning distinguishes "within-run iteration" from "cross-run invalidation":

```ts
interface DocumentLayout {
  // ...existing fields from header-footer-plan.md §3.1
  runId: number;             // increments per full layout run
  convergence: "stable" | "exhausted";
}

interface MeasureCacheEntry {
  // ...existing fields from header-footer-plan.md §3.4
  placedRunId?: number;
  placedContentTop?: number;
  // placedMetricsVersion retired — runId subsumes it
}
```

**Phase 1b cache guard** (replaces the version in header-footer-plan §3.4):

Phase 1b only accepts the cross-run shortcut when **both**:

1. `cachedEntry.placedRunId === previousLayout.runId` — the block was placed in the run we're comparing against, not an older one
2. `cachedEntry.placedContentTop === metricsFor(currentPage.pageNumber).contentTop` — this specific page's contentTop hasn't shifted

**Why `runId` replaces `metricsVersion`**: `metricsVersion` was designed before iteration existed. With iteration, within-run `metricsVersion` would bump 2–3 times per run, invalidating Phase 1b constantly. `runId` is stable within a run and bumps once per run, which is the right granularity.

**`metricsVersion` still exists** but is **finalized only after convergence** — it's a hash of the stabilized `ResolvedChrome` used for external cache keying (e.g., the tile renderer, PDF export) that needs to know "has the final resolved chrome changed." During iteration, intermediate `metricsVersion` values are never observed by anything outside the aggregator.

**Intra-iteration state is NOT cached.** Phase 1b is a cross-run cache; intermediate iterations within a run re-run the flow pipeline from scratch. There's no "iteration 2 reuses iteration 1's placements" machinery. The cost is a few extra runs, and footnotes are rare enough that it doesn't matter.

**Cross-run seeding via `previousRunPayload`** is the perf win: it moves most edits back to 1-iteration convergence even when footnotes are present. Documented in §3.4 and §8.2.

### 8.7 Footnote overflow and splitting

Settled design. Footnote bodies are **fragment-producing** — a single note body can land on multiple pages as a sequence of `FootnoteFragment`s, analogous to how a body paragraph becomes multiple `LayoutBlock`s with `isContinuation: true` when it straddles a page boundary.

#### 8.7.1 Reuse what exists; don't build a "subflow engine"

Three specific anti-patterns to avoid, each of which a well-meaning but uninformed reviewer will propose:

1. **Don't introduce a `SubflowLayoutEngine` class.** The right reuse target is `buildBlockFlow` at `PageLayout.ts:812`. It already measures position-independent line lists with the main pipeline's text measurer, cache, font handling, and margin collapse — everything a footnote body needs. A parallel engine class duplicates infrastructure we already have.
2. **Don't reuse `paginateFlow`'s page loop. Do reuse its innermost line-fit primitive.** `paginateFlow` has top-down page-fill semantics, gap suppression, leaf-block handling, hard page breaks, and margin collapsing all tangled together at `PageLayout.ts:469`. The enclosing control flow is body-specific and not shareable. BUT the innermost "walk lines, accumulate height, stop when capacity runs out" loop IS a clean primitive and should be lifted into a shared helper `fitLinesInCapacity(lines, capacity)` in `packages/core/src/layout/splitLines.ts` — ~10 lines, pure, no dependencies. Both `paginateFlow`'s split loop (`PageLayout.ts:620-630`) and the footnote plugin's `bandFill` (see §8.7.3) call it. Any future iterative chrome (balanced columns, line-number gutters) gets it for free. This is a Phase 0 addition, not a §8.7-specific one, because it's the right factoring regardless of footnotes.
3. **Don't create a parallel `FragmentedLayout` abstraction.** `DocumentLayout.fragments: LayoutFragment[]` (`PageLayout.ts:87-115`) is already the universal fragment shape for split body blocks. Footnote fragments are a sibling shape (`FootnoteFragment`) with band-relative positioning instead of page-relative, but the fragment-identity mindset and stamping logic are the same as `buildFragments` at `PageLayout.ts:1312`. Pattern after it, don't duplicate it.

The plugin ships `buildBlockFlow` reuse + one new `bandFill` helper (~80 lines) + a new `FootnoteFragment` type. No new core engines.

#### 8.7.2 Types

```ts
// packages/plugins/src/footnotes/types.ts

export interface FootnoteFragment {
  noteId: string;
  /** 1-based page number this fragment lands on. */
  page: number;
  /** Y offset within the footnote band, top-aligned. */
  bandY: number;
  height: number;
  /** Index range into the note body's flat line list. */
  lineStart: number;
  lineCount: number;
  /**
   * True if this fragment continues a previous fragment of the same note.
   * The first fragment of every note has isContinuation: false, even when
   * the note was displaced from its anchor page to a later page.
   * Render-time logic compares fragment.page to anchorPages[noteId] to
   * distinguish "split continuation" from "displaced note" for marker text.
   */
  isContinuation: boolean;
}

export interface FootnoteIterationPayload {
  /** Ordered fragment list, flattened across all pages. */
  fragments: FootnoteFragment[];
  /** First-fragment page for each note, keyed by id. */
  assignment: Map<FootnoteId, number>;
  /**
   * Sticky split boundary per note: the line index after which the note
   * was split in a previous iteration of THIS run. Locked until the note's
   * first-fragment page changes (which voids the sticky entry).
   */
  stickySplits: Map<FootnoteId, number>;
  /** Precomputed table for bottomForPage(n). */
  heightsByPage: Map<number, number>;
}
```

`FootnoteFragment` is intentionally a different shape from `LayoutFragment` — band-relative positioning and line-range indexing are footnote-specific. The fragment-identity pattern is what we reuse, not the exact field set.

#### 8.7.3 The `bandFill` algorithm

Three-phase per page, in page order: (1) drain any spill carried forward from previous pages, (2) process this page's anchored notes in document order, (3) push any remaining unplaced lines into the spill queue for the next page.

```ts
// packages/plugins/src/footnotes/bandFill.ts

interface BandFillInput {
  pageCount: number;
  /** Anchor → page map from the current flow layout. */
  anchorPages: Map<FootnoteId, number>;
  /** Notes grouped by anchor page, preserving anchor document order within each page. */
  notesByPage: Map<number, FootnoteId[]>;
  /** Line list per note, produced by buildBlockFlow. Cached by PM Node identity. */
  noteLines: Map<FootnoteId, LayoutLine[]>;
  /** Max band capacity per page (see §8.7.5). */
  capacityForPage: (pageNumber: number) => number;
  /** Sticky splits carried over from the previous iteration. */
  stickySplits: Map<FootnoteId, number>;
}

interface BandFillOutput {
  fragments: FootnoteFragment[];
  heightsByPage: Map<number, number>;
  newStickySplits: Map<FootnoteId, number>;
  /** Any notes that still have unplaced lines after the last page. */
  tailOverflow: Array<{ noteId: FootnoteId; remainingLines: LayoutLine[] }>;
}

function bandFill(input: BandFillInput): BandFillOutput {
  const fragments: FootnoteFragment[] = [];
  const heightsByPage = new Map<number, number>();
  const newStickySplits = new Map<FootnoteId, number>();

  // FIFO queue of unplaced line ranges, ordered by spill age.
  // Each entry is { noteId, lines, originallyAnchoredPage }.
  let spillQueue: Array<{
    noteId: FootnoteId;
    lines: LayoutLine[];
    anchoredPage: number;
  }> = [];

  for (let page = 1; page <= input.pageCount; page++) {
    let bandY = 0;
    let remaining = input.capacityForPage(page);

    // ── Phase 1: drain previous pages' spill ─────────────────────────────
    // Continuation fragments go FIRST on a page's band — readers expect
    // "(continued from previous page)" at the top, then new anchored notes.
    while (spillQueue.length > 0 && remaining > 0) {
      const spill = spillQueue[0]!;
      const { fitted, rest, fittedHeight } = fitLinesInCapacity(spill.lines, remaining);

      if (fitted.length > 0) {
        fragments.push({
          noteId: spill.noteId,
          page,
          bandY,
          height: fittedHeight,
          lineStart: /* running offset per note — tracked separately */,
          lineCount: fitted.length,
          isContinuation: true,
        });
        bandY += fittedHeight;
        remaining -= fittedHeight;
      }

      if (rest.length === 0) {
        spillQueue.shift();
      } else {
        spillQueue[0] = { ...spill, lines: rest };
        break; // page is full, can't drain further
      }
    }

    // ── Phase 2: process this page's anchored notes ───────────────────────
    const anchored = input.notesByPage.get(page) ?? [];
    for (const noteId of anchored) {
      let lines = input.noteLines.get(noteId) ?? [];

      // Sticky split: if we split this note in a previous iteration at line
      // index K AND its first-fragment page is unchanged, reuse the split.
      const sticky = input.stickySplits.get(noteId);
      if (sticky !== undefined) {
        // Split lines [0..sticky) here, push [sticky..end] to spill.
        const head = lines.slice(0, sticky);
        const tail = lines.slice(sticky);
        const headHeight = sumHeight(head);
        if (headHeight <= remaining) {
          fragments.push({
            noteId, page, bandY, height: headHeight,
            lineStart: 0, lineCount: head.length, isContinuation: false,
          });
          bandY += headHeight;
          remaining -= headHeight;
          if (tail.length > 0) {
            spillQueue.push({ noteId, lines: tail, anchoredPage: page });
          }
          newStickySplits.set(noteId, sticky);
          continue;
        }
        // Sticky head no longer fits — void the sticky entry and re-split below.
      }

      const { fitted, rest, fittedHeight } = fitLinesInCapacity(lines, remaining);

      if (fitted.length > 0) {
        fragments.push({
          noteId, page, bandY, height: fittedHeight,
          lineStart: 0, lineCount: fitted.length, isContinuation: false,
        });
        bandY += fittedHeight;
        remaining -= fittedHeight;
      }

      if (rest.length > 0) {
        spillQueue.push({ noteId, lines: rest, anchoredPage: page });
        // Remember the split point for sticky-reuse next iteration.
        newStickySplits.set(noteId, fitted.length);
      }

      if (remaining === 0) break; // no capacity for further anchored notes on this page
    }

    heightsByPage.set(page, bandY);

    // Remaining anchored notes (if we broke out of Phase 2) spill whole.
    // They were anchored on this page but land on later pages as (displaced).
    // Their spillQueue entries have the current page as anchoredPage so
    // render time can label them "(from p. N)".
    const processedCount = fragments.filter(f => f.page === page && !f.isContinuation).length;
    for (let i = processedCount; i < anchored.length; i++) {
      const noteId = anchored[i]!;
      spillQueue.push({
        noteId,
        lines: input.noteLines.get(noteId) ?? [],
        anchoredPage: page,
      });
    }
  }

  return {
    fragments,
    heightsByPage,
    newStickySplits,
    tailOverflow: spillQueue.map(s => ({ noteId: s.noteId, remainingLines: s.lines })),
  };
}

function fitLinesInCapacity(
  lines: LayoutLine[],
  capacity: number,
): { fitted: LayoutLine[]; rest: LayoutLine[]; fittedHeight: number } {
  let used = 0;
  let i = 0;
  while (i < lines.length && used + lines[i]!.lineHeight <= capacity) {
    used += lines[i]!.lineHeight;
    i++;
  }
  return { fitted: lines.slice(0, i), rest: lines.slice(i), fittedHeight: used };
}
```

#### 8.7.4 Resolved design decisions (the edge cases)

**Footnote taller than a full page band.** Split across as many pages as needed, each with a continuation fragment. No special case — the `bandFill` loop handles this naturally because each page's remaining capacity is computed fresh and the spill queue is drained first.

**Interaction with another page's anchored notes.** A very tall footnote anchored on page 5 might consume all of pages 5, 6, and part of 7 via continuation fragments. Notes anchored on pages 6 and 7 are processed **after** their pages' continuation drains — so they land below the continuation in band document order, or spill to the next page if there's no room. This matches Word's behavior: continuation is "older content," new anchored notes come after it.

**Multiple notes on one page exceeding capacity — always split at line boundary, never lookahead.** If page 5 has anchored notes A (3 lines), B (3 lines), C (5 lines) and band capacity is 8 lines, we place A + B (6 lines, 2 remaining) and split C at line 2 (2 lines on page 5, 3 on page 6 as continuation). We do **not** implement "prefer whole-note spill" lookahead where C would be spilled entirely to page 6 even though 2 lines fit on page 5. This is a deliberate deviation from Word (see §9). Rationale: lookahead requires pre-measuring subsequent pages' anchored notes before deciding, which interacts with iteration convergence in subtle ways and is not worth the complexity for a rare visual polish.

**End-of-document overflow.** When `tailOverflow` is non-empty after processing the last page, **fabricate footnote-only pages** at the end of the document. Each fabricated page has no body content, its full content area as band capacity, and drains the spill queue until empty. These pages show up in `DocumentLayout.pages` with a flag indicating they're synthetic. This matches Word and LaTeX. Rejected: silent truncation (user-visible data loss), band compression (uglier and non-monotonic).

**Maximum band height.** Uncapped in v1, matching Word and LaTeX defaults. A pathological 200-line footnote can eat entire pages of body content; sticky spill and iteration handle the reflow. If this turns out to be a problem in practice, we add a configurable max (e.g., `footnotes.maxBandFraction: 0.5`) in v2. Not shipping a cap by default because picking an arbitrary number is worse than matching convention.

**Sticky continuation — page-scoped refinement.** The rule from §8.2 generalizes for splits:

> Once a note has been split in iteration K with first-fragment on page P, the split boundary (line index) is locked for the rest of the run **as long as the note's first-fragment page is still P**. If the anchor moves to a different page (P changes) between iterations, the sticky entry is voided and the note re-splits at the new page's capacity.

This prevents both oscillations that concerned me earlier:
- **Spill point oscillation**: iteration K+1 can't pick a different split line because the sticky value forces the same cut.
- **Whole-spill vs split oscillation**: if iteration K decided to split at line 4 and iteration K+1 has slightly more capacity, it would naturally prefer to put one more line on page P, but sticky prevents that. Stability wins over optimality within a run.

**Convergence condition.** Stability requires **both**:

1. `assignment` (anchor → first-fragment page) is unchanged from the previous iteration
2. `fragments` (full fragment list including continuation structure) is unchanged

With sticky splits active, condition 2 is *implied* by condition 1 in practice — if assignment is unchanged, sticky forces identical split boundaries, which forces identical fragment structure. The explicit check is belt-and-suspenders for the case where the sticky map gets voided mid-run (anchor moved), which would satisfy condition 1 with different fragments.

#### 8.7.5 Band capacity

Per page, the band capacity available to footnotes is:

```ts
capacityForPage(pageNumber) =
  pageHeight
  - margins.top - margins.bottom
  - otherChromeContributions.top(pageNumber)   // header
  - otherChromeContributions.bottom(pageNumber) // excluding this contributor
  - MIN_BODY_HEIGHT                             // reserve at least N lines of body
```

`MIN_BODY_HEIGHT` is a small reserve (e.g., 3 lines worth) preventing footnotes from consuming *all* body capacity on a page. A page with zero body lines visible is a worse UX than a page with one body line and some footnote spill. This isn't a band cap — it's a body floor — and it's required because without it, iteration can produce pages that are 100% footnote band, which defeats the point of having a flow document.

**TODO**: sanity-check `MIN_BODY_HEIGHT` against real documents once the plugin exists. Three lines is a guess; one line might be enough. This is an implementation tuning knob, not a design choice.

#### 8.7.6 Iteration integration

The footnote contribution's `measure()` (from §8.2) calls `bandFill` once per iteration after computing `anchorPages` from `ctx.currentFlowLayout`. The returned `FootnoteIterationPayload` becomes the contribution's `payload`, which feeds the next iteration via `ctx.previousIterationPayload`. `heightsByPage` is the table that `bottomForPage(n)` reads from — pure lookup, no recomputation.

Seeding via `ctx.previousRunPayload`: on iteration 1, if the previous run's `assignment` matches the current flow's anchor→page mapping (checked cheaply via the shared doc position space), reuse the previous run's `fragments` wholesale and report `stable: true`. This is the common case for steady-state editing — one-iteration convergence even with footnotes present.

End-of-doc overflow: when `tailOverflow` is non-empty, the contribution reports the required number of synthetic footnote-only pages via a new `syntheticPages` field on `ChromeContribution`. The core aggregator accumulates these across contributors and extends `DocumentLayout.pages` accordingly. This is the one core addition footnotes force beyond the generic `LayoutIterationContext` — a "reserve extra pages for chrome overflow" channel.

```ts
// Extension to ChromeContribution
export interface ChromeContribution {
  // ...existing fields
  /**
   * Number of synthetic pages this contributor needs appended after the
   * flow's last natural page. Used for chrome-only overflow (e.g., footnote
   * end-of-doc spill). Zero for contributors that never overflow.
   */
  syntheticPages: number;
}
```

Synthetic pages are flagged on the resulting `LayoutPage` so `PageRenderer` can draw them without calling into body-layout code paths.

#### 8.7.7 Test plan

The implementation PR ships with these test cases (happy-dom + `mockCanvas`, following the existing layout test pattern):

1. **Single note, fits entirely** → 1 fragment, `isContinuation: false`
2. **Single note spans 2 pages** → 2 fragments, 2nd has `isContinuation: true`
3. **Single note spans 4 pages** → 4 fragments, convergence in ≤3 iterations
4. **Two notes on same page, both fit** → 2 fragments, assignment maps both to the same page
5. **Two notes on same page, 2nd is split** → 3 fragments total, split at line boundary per `bandFill`
6. **Three notes, first exceeds capacity** → 1st split, 2nd and 3rd displaced to next page
7. **Displaced note (not split)** → fragment on page ≠ anchorPages[noteId], `isContinuation: false`, render layer distinguishes via the page comparison
8. **End-of-doc overflow** → synthetic footnote-only page fabricated
9. **Sticky split stability** → edit body on page 3, note on page 5 should not re-split in iteration 2
10. **Oscillation guard** → pathological input that would loop without sticky; with sticky, converges in ≤5 iterations or exhausts gracefully
11. **Seeding from `previousRunPayload`** → single-character body edit converges in iteration 1
12. **Font-change invalidation** → changing `fontConfig` bumps `runId`, invalidates Phase 1b, correctly re-iterates

---

---

## 9. "What do Word and Google Docs do?" — applied baselines

Where decisions aren't obvious, this is the cross-reference table. Each row is an actual decision made in the plan (or deferred) with the Word/Docs baseline.

| Decision | Word | Google Docs | Scrivr v1 | Rationale |
|---|---|---|---|---|
| Header distance from edge | Configurable, separate from margin | Uses page margin | Uses page margin | Simpler config shape; distance-from-edge is a v2 knob |
| Different first-page header | Yes | Yes | Yes | Standard expectation |
| Different odd/even headers | Yes | Yes | Flag reserved, not wired | Cheap to add later |
| Page number token rendering | Field code, measured with placeholder | Field, auto-updates | Inline leaf node, widest-digit placeholder | Correctness (avoid right-aligned clip) |
| Frozen vs live dates | Both | Both | Frozen is default | Deterministic for collab + tests |
| Select-all scope | Body only | Body only | Body only | Matches `editor.state` = flow |
| Undo across header edits | Separate per-surface stacks | Unified | Unified (via `DocAttrStep` in body history) | Docs' model is less surprising |
| Click on footnote ref | Select; Cmd/DblClick jumps | Click jumps | Select; Cmd/DblClick jumps | Word is less surprising in edit mode |
| Footnote too tall | Split with continuation notice | Best-effort, overflow | Split with continuation (§8.7) | Word's approach is correct for print fidelity |
| Small note that doesn't fully fit | Prefer whole-note spill if it fits on next page | Same | **Always split at line boundary** | Lookahead for whole-spill interacts with iteration convergence in subtle ways; simpler rule is stable and correct. Deliberate v1 deviation. |
| End-of-doc footnote overflow | Fabricate footnote-only page(s) | Same | Fabricate footnote-only page(s) | Standard expectation; silent truncation is data loss |
| Max footnote band height | Uncapped | Uncapped | Uncapped | Match convention; add cap in v2 only if real documents hit pathological cases |
| Footnote numbering | Auto, doc order | Auto, doc order | Auto, derived from anchor doc order | Standard expectation |
| Section-scoped headers | Yes | Yes | v2 (sections not yet modelled) | Out of scope for v1 |
| Comments UX | Sidebar + rich text + threads | Sidebar + rich text + threads + resolve | Markers + simple input + headless API | Deliberate deviation — app owns the product surface |
| Header/footer in pageless mode | N/A (Word is always paged) | N/A | Disabled (contributor short-circuits) | Pageless is Scrivr-specific |

The general rule (`feedback_convention_alignment.md`): when Word and Docs disagree, pick the less surprising option for the edit context. When they agree, match them. When we deliberately deviate (comments), document why.

---

## 10. Implementation sequencing across multi-surface features

This is the order of work from the Phase 0 refactor through footnotes. It cross-references `header-footer-plan.md` so you can see which PR in the header plan unblocks which subsequent work.

| Step | Feature | Package | Depends on | Header plan ref |
|---|---|---|---|---|
| **0** | `PageMetrics` per-page refactor + `runMiniPipeline` export | `@scrivr/core` | — | §3, Phase 0 |
| **1a** | `DocAttrStep` + `addDocAttrs()` lane with collision detection | `@scrivr/core` | 0 | §4.1, §4.3, Phase 1a |
| **1b** | `addPageChrome()` lane + `aggregateChrome` (single-pass) + `DocumentLayout.metrics[]` + `_chromePayloads` | `@scrivr/core` | 0, 1a | §4.2, Phase 1b |
| **1c** | `SurfaceRegistry` + `EditorSurface` + `addSurfaceOwner()` + `InputBridge` routing | `@scrivr/core` | 1a | §4.4, Phase 1c |
| **2** | `HeaderFooter` plugin (config + measurement, no render yet) | `@scrivr/plugins/header-footer` | 0, 1a, 1b | §5, §6, Phase 2 |
| **3** | Canvas rendering, page-number nodes, `addInlineMeasurer` lane | `@scrivr/core` (lane) + plugin (content) | 2 | §7, Phase 3 |
| **4** | Header/footer live editing | `@scrivr/plugins/header-footer` | 1c, 3 | Phase 4 |
| **5** | Header/footer collab | `@scrivr/plugins/collaboration` | 4 | §8, Phase 5 |
| **6** | Header/footer PDF export via `addExports()` contribution | `@scrivr/plugins/header-footer` + `@scrivr/export-pdf` | 3, export-extensibility M1-M2 | §10, Phase 6. See `docs/export-extensibility.md` §7.1 |
| **7** | `differentFirstPage` slots end-to-end | All | 6 | Phase 7 |
| **—** | **End of header-footer plan** | | | |
| **8** | `LayoutIterationContext` + iterative `ChromeContribution` + aggregator loop refactor | `@scrivr/core` | 1b | NEW — not in header plan |
| **9** | Marker facility + `doc.attrs["comments"]` storage + headless comment API + minimal built-in overlay | `@scrivr/core` (facility) + `@scrivr/plugins/comments` (surface-less plugin) | 1a | NEW |
| **10** | `Footnotes` plugin: data model + `footnote_ref` node + body storage + lazy surfaces | `@scrivr/plugins/footnotes` | 1a, 1c, 8 | NEW |
| **11** | Footnote layout: measure loop, sticky spill, assignment payload | `@scrivr/plugins/footnotes` | 10 | NEW |
| **12** | Footnote overflow + splitting (`bandFill` helper, sticky continuations, synthetic overflow pages, `ChromeContribution.syntheticPages` field) | `@scrivr/plugins/footnotes` + `@scrivr/core` (one small addition) | 11 | NEW — design resolved in §8.7 |
| **13** | Footnote canvas rendering + hit testing + cross-surface viewport sync | `@scrivr/plugins/footnotes` + core scroll machinery | 12 | NEW |
| **14** | Footnote live editing + commit-on-deactivate | `@scrivr/plugins/footnotes` | 13 | NEW |
| **15** | Footnote collab (bodies sync via the same `Y.Map("prose_doc_attrs")` as headers) | `@scrivr/plugins/collaboration` | 14 | NEW |
| **16** | Footnote PDF export via `addExports()` contribution | `@scrivr/plugins/footnotes` + `@scrivr/export-pdf` | 12, export-extensibility M1-M2 | NEW. Follows the HeaderFooter pattern |

**Key insights from the sequencing**:

- Steps 0–7 are the full header-footer plan and ship independently. Everything after Step 7 depends on header-footer being done.
- Step 8 (iterative chrome) is the one pure-core addition for footnotes that isn't in the header plan. It's additive — headers pass `stable: true` on iteration 1 and don't notice the change.
- Step 9 (marker facility + comments) can happen any time after Step 1a. It has no dependency on chrome or surfaces. Could slot in between Step 1a and Step 2 if we want comments before headers, though the natural ordering is headers first (they're the bigger architectural payoff).
- Step 12 (footnote overflow/splitting) is the blocker for the rest of footnotes. **Design session before implementation.**
- Iterative chrome (Step 8) unblocks future features beyond footnotes: widow/orphan control, balanced columns, margin notes. All follow the same `LayoutIterationContext` pattern.

---

## 11. Open questions / pending

1. **Marker facility API exact shape** — the sketch in §3.5 is a starting point. Needs a design pass before Step 9.
2. **`FootnoteSurface` commands API + collab granularity** — deferred from the footnote pressure-test. Separate design session before Step 14.
3. **Streaming layout + iteration** — v1 disables streaming when footnotes are present. Revisit if it becomes a perf issue for footnote-heavy docs.
4. **Cross-surface viewport sync** — scroll machinery needs to accept `{ surfaceId, pos }` tuples. Minor refactor, lands with Step 13.
5. **Section-scoped headers/footers** — out of scope for v1. When sections land, `HeaderFooterPolicy` moves from `doc.attrs` to section metadata, and `resolveSlot`'s `SlotContext.section` field becomes meaningful.
6. **Paste transformer re-keying** — plugins that add ID-bearing inline nodes (footnote refs, comment anchors, mentions) all need re-keying on paste. Shared concern; extract to a core utility before Step 9.
7. **`MIN_BODY_HEIGHT` tuning** (§8.7.5) — the body floor that prevents pages from becoming 100% footnote band. Three lines is a guess; verify against real documents during implementation.

---

## 12. References

- **`docs/header-footer-plan.md`** — the concrete v1 implementation plan for headers and footers. This doc references it heavily (§6, §10) as the first surface feature.
- **`docs/pagination-model.md`** — the pre-existing pagination reference that the `PageMetrics` refactor is specified in.
- **Memory `project_comments_headless.md`** — the comments-as-markers decision with rationale.
- **Memory `feedback_convention_alignment.md`** — the "match Word / Google Docs conventions by default" rule that §9 applies.
- **Memory `feedback_no_shortcut_tech_debt.md`** — the "correct design over shortcut + `TODO(v2)`" rule that killed uniform-height headers and forced the per-page `PageMetrics` refactor.
- **Memory `feedback_pdf_parity.md`** — the PDF export parity requirement (every canvas feature ships PDF support in the same PR).
- **POC commit** `736ba7d` on branch `feat/header-footer` — the exploratory work that shaped many of the primitives documented here.
