# RFC: Zoom — one scale at the viewport, fit to the screen

Status: proposed (2026-11-15). Not built.

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
   *(Default chosen without a direct answer; strike if unwanted.)*
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
| `renderer/PageRenderer`, `OverlayRenderer` | take the render scale; snapping uses it; the caret keeps its width |
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

Nothing yet.
