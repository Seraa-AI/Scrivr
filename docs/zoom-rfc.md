# RFC: Zoom — one scale at the viewport, fit to the screen

Status: v1 built (2026-11-15) — see [What shipped](#what-shipped).

## Problem

Scrivr shows a page at exactly its CSS size: an A4 page is 794 × 1123 CSS
pixels, whatever the screen. On a phone the page runs off the right edge; on a
large monitor it sits small in the middle; and a reader who wants to look
closer, or see a whole page at once, has only the browser's own zoom, which
scales the toolbar and every other part of the app with it.

Word and Google Docs both zoom the document alone:

- **Word** zooms 10%–500%, and offers *Page width* and *Whole page*, which
  track the window as it resizes. Ctrl+wheel zooms. Text reflows never: a
  line breaks in the same place at every zoom, because layout is in page
  units and zoom only scales the view.
- **Google Docs** zooms 50%–200% and *Fit*, and on a phone opens fitted to
  the screen's width.

Both keep the caret, the selection handles and the resize handles the same
size on screen whatever the zoom: they are the pointer's furniture, not the
page's.

## The core idea

Zoom is a view scale. It never touches the document, the layout, or the
character map: everything Scrivr computes stays in page units, and one factor
is applied at the single boundary where page units meet the screen.

```
screen = pageOrigin + page × zoom        (painting, popovers, the hidden input)
page   = (screen − pageOrigin) / zoom     (click, hover, drag)
```

The whole column of pages — each page and the gap between pages — is scaled
as one, so the inverse is the existing slot math run on a divided point.

That boundary already exists in two places, which is what makes this small:

- **Page to screen** goes through one hook, `editor.setPageTopLookup`, which
  `TileManager` registers. `getViewportRect`, `getRangeViewportRects`,
  `getNodeViewportRect(s)` and `scrollCursorIntoView` add raw page `x/y/w/h`
  to the page's corner. Every menu, popover, track-changes card, AI marker and
  the hidden textarea reads those, so they follow the zoom with no change of
  their own.
- **Screen to page** goes through one function, `resolvePagePoint`. Click,
  hover, selection, cell selection and header/footer activation all read the
  `PagePoint` it returns, in page units.

## Decisions

1. **View only.** Zoom changes no layout, no measurement, no document state,
   no history and nothing collaborative; it is per-view, like a scroll
   position. Changing it repaints; it never re-lays-out.
2. **Crisp at every zoom.** A tile's canvas backing store is sized at
   `page × zoom × dpr` and its context scaled by `zoom × dpr`, so text and
   rules are rasterised at the zoom, never stretched from a 100% bitmap.
   Painting code still draws in page units.
3. **Range 10%–500%, as Word.** A number outside it is clamped.
4. **Fit modes that react to the screen.** `"fit-width"` scales the page's
   width to the scroll container's width; `"fit-page"` scales the whole page
   into the container. Both are re-resolved whenever the container resizes —
   a phone in portrait fits the width, and rotating it fits again. A fixed
   number stays fixed through a resize.
5. **The view stays put.** When the zoom changes, the point of the document
   at the top of the view stays at the top (a pointer gesture keeps the point
   under the pointer instead), so the reader does not lose their place.
6. **Pointer furniture keeps its screen size.** The caret, resize handles and
   their hit area, and focus rings are divided by the zoom where they are
   drawn, so they stay the size they are today. Pixel snapping on the overlay
   snaps to `dpr × zoom`, so 1px strokes land on device pixels.
7. **Ctrl/Cmd + wheel, and a trackpad pinch (which browsers report as
   Ctrl + wheel), zoom the document** about the pointer, instead of the
   browser zooming the whole app. Cmd/Ctrl + `=` / `−` / `0` stay the
   browser's, as in Google Docs. A host can turn the gesture off.
8. **Pageless mode zooms too.** Its column is scaled the same way; fit-width
   fits its content width.
9. **Export and print are unaffected.** PDF and DOCX read the layout, which
   zoom never changes.

## API

```ts
type ZoomRequest = number | "fit-width" | "fit-page";

new Editor({ ..., zoom: "fit-width" });   // default: 1

editor.setZoom(1.25);             // a factor, clamped to MIN_ZOOM..MAX_ZOOM
editor.setZoom("fit-page");
editor.zoom;                      // the factor in effect: 0.82
editor.zoomRequest;               // what was asked: "fit-page"
editor.on("zoom", ({ zoom, request }) => …);   // after it takes effect
```

`MIN_ZOOM` (0.1) and `MAX_ZOOM` (5) are exported. `TileManagerOptions` gains
`zoomGestures?: boolean` (default `true`). The `"viewport"` event also fires
on a zoom change, so a popover that listens for scroll and resize moves with
it already.

`getViewportRect` and its siblings return screen rects at the zoom — they
already promise screen space. `getPageScreenPosition` is unchanged (a corner
has no size). Page-unit APIs stay page units: `charMap`, `layout`,
`getNodeRect`, `PagePoint`, overlay render handlers (their context is scaled
by `zoom × dpr`; the contract that says "already scaled by dpr" is updated).

React: `useScrivrEditor` passes `zoom` through; the playground gains a zoom
control (presets 50–200%, Fit width, Fit page).

## Ownership

- **The requested zoom** is the editor's: `Editor` holds `zoomRequest`, as it
  holds the page config.
- **The factor in effect** is derived from the request and the container's
  size by one pure function, `resolveZoom(request, container, pageConfig)`,
  in `renderer/zoom.ts`. The container's size reaches the editor through the
  lookup `TileManager` already registers for the scroll container. Nothing
  else computes a zoom.
- **The boundary** (`page ↔ screen`) is one helper on the editor that the
  four `get*ViewportRect` methods and `scrollCursorIntoView` share, and its
  inverse is `resolvePagePoint`, given `zoom` in its context.

## What changes, where

| Place | Change |
|---|---|
| `Editor` | `zoom` option, `setZoom`, `zoom`, `zoomRequest`, `"zoom"` event; one `pageToScreen` helper used by the viewport-rect methods |
| `renderer/zoom.ts` (new) | `resolveZoom`, `MIN_ZOOM`, `MAX_ZOOM`, `clampZoom` |
| `input/InputBridge` | `absoluteBand` scales `coords.y` / `height` |
| `layout/pagePoint` | `PagePointContext.zoom`; divide after subtracting the origin |
| `renderer/TileManager` | column size, tile top/height and canvas CSS size × zoom; resolve fit on resize; keep the view's top point on a zoom change; gesture handling |
| `renderer/canvas` | `setupCanvas({ scale })` sizes the backing store and context by `scale × dpr` |
| `renderer/OverlayRenderer` | snapping uses the render scale; the caret keeps its width |
| `renderer/ResizeController`, `PointerController` | handle size and hit radius ÷ zoom; drag deltas (`clientX − startX`) ÷ zoom |
| `react/useHeaderFooterRibbon` | page-unit offsets (`contentTop`, `footerTop`, `pageWidth`, the gap fallback) × zoom |
| `extensions/types.ts` | overlay handler contract: context scaled by `zoom × dpr` |

## Invariants

- Layout, the character map and the document are identical at every zoom.
- `resolvePagePoint(pageToScreen(p)) === p` at every zoom (round trip).
- A drag of N screen pixels moves an object N ÷ zoom page units.
- The caret and handles are the same screen size at 50% and at 200%.
- A fit mode, after any container resize, equals `resolveZoom` of the new size.

## Tests

- `resolveZoom`: clamping; fit-width and fit-page against container sizes;
  a fixed number ignoring the container.
- Round trip page → screen → page at 0.5, 1, 2.37 through the real
  `TileManager` geometry (DOM test, happy-dom).
- `getViewportRect` scales with the zoom; the hidden textarea follows.
- A click at a screen point resolves to the same doc position at every zoom.
- A resize drag of 100 screen px at 200% grows an image by 50 page units.
- A zoom change keeps the doc position at the view's top in place.
- Fit-width re-resolves when the container is resized.
- Layout version unchanged across `setZoom` (view only).

## Out of scope

- Per-block or per-surface scales (Scrivr is flow-based, not a canvas tool).
- Zoom persisted in the document or synced to collaborators.
- Pinch on a touch screen beyond what the browser's visual viewport already
  does (`canvas.ts` already re-rasterises for it).

## What shipped

Built as proposed, on `feat/zoom`. Where the code departs from the text above:

- **The boundary lives in `InputBridge.pageToScreen`**, beside the page-corner
  lookup it already held, rather than in a new helper on `Editor`: the four
  `get*ViewportRect` methods and `scrollCursorIntoView` all call it. The
  page-corner lookup `TileManager` registers is at the zoom already.
- **The factor in effect is resolved by `Editor.refitZoom()`** (internal),
  through `setViewportSizeLookup`, which `TileManager` registers with the
  scroll container's content box. `TileManager` calls it once it finds the
  container and on every resize. `resolveZoom` returns `null` for a fit with
  nothing to measure — no view yet, or a hidden one — and the factor stays as
  it was rather than snapping to 100%; a new editor shows 100% until a view
  mounts. Fit-width reads only the width.
- **The fit's width leaves out the widest scrollbar the container has shown.**
  With classic scrollbars, a page whose height sits near the view's would
  otherwise refit forever: the scrollbar comes, the fit shrinks, the page no
  longer needs it, it goes, the fit grows.
- **`"zoom"` fires when the request changes too**, not only the factor: a fit
  chosen where it equals the factor already shown changes nothing on screen,
  but a control must show the fit. `"viewport"` fires only for a new factor.
  React gains `useZoomRequest(editor)` beside `useZoom`. A sideways
  Ctrl/Cmd + wheel (`deltaY` 0) asks for no zoom, so it no longer ends a fit.
- **A zoom change moves and repaints the shown pages at once**, rather than
  hiding them for the next frame: a resize refits before the browser paints,
  and hidden tiles would leave it a blank frame. It then re-places the hidden
  textarea over the caret.
- **The canvas resolution is capped.** A backing store is `page × dpr × zoom`
  device pixels until that passes iOS Safari's 16.7M-pixel limit (about 140%
  on a 3× phone), where Safari paints the canvas blank; past it the bitmap is
  lowered and stretched. `canvas.pixelsPerUnit` computes it for paged and
  pageless tiles alike; the `dpr` a paint receives means device pixels per
  page unit. `PageRenderer` needed no change: it already drew in logical
  units on whatever scale its context had.
- **Drags.** Resize deltas are divided into page units. An anchored-object
  drop commits the ghost's page position (`pointer page point − grab offset`)
  — the first cut added raw screen-pixel deltas, landing the image `zoom`
  times off its ghost. The click and still thresholds stay in screen pixels.
  Inline drags resolve a document position from the page point and needed
  nothing.
- **Furniture sizes itself with `screenPixels(n)`**, valid inside an overlay
  paint, backed by the zoom the overlay clear records. The caret, resize
  handles and their hit radius, the anchored-drag source, ghost and drop
  caret keep their screen size. So do collaborators' cursors and the AI
  caret — reversing this RFC's first cut, which let them scale and left
  names unreadable at 10%: both now draw through one primitive,
  `renderLabelledCaret`.
- **Ctrl/Cmd + wheel is heard on the scroll container**, so the gutter beside
  the page zooms the document rather than the browser. A wheel that counts
  in lines (Firefox's mouse wheel) is converted to pixels first.
- **The page column sizes itself.** A host should not also set `<Scrivr />`'s
  width from `useZoom`: that width lands a React render after the zoom has
  re-anchored the scroll, and a centred column then drifts sideways. The
  playground lets the column size its wrapper.
- **`IEditor` gains `zoom`**, and `getPageScreenPosition` documents that a
  page-unit offset from it is `offset × zoom`; the header/footer ribbon in
  React places itself that way.
- **Tests** cover each invariant above, including a click resolving to the
  same document position at 50%, 100% and 237% through the real
  `TileManager`, and the hidden textarea following a zoom change.
- **React:** `useZoom(editor)`; `useZoomRequest(editor)`;
  `useScrivrEditor({ zoom })`; `<Scrivr zoomGestures>`. The playground opens
  at Fit width, with a zoom control.
