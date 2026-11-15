---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
---

Zoom the document without changing it.

- `editor.setZoom(1.5 | "fit-width" | "fit-page")`, or `zoom` in `EditorOptions` / `useScrivrEditor`: a factor from `MIN_ZOOM` (10%) to `MAX_ZOOM` (500%), or a fit to the scroll container that follows it as it resizes. A fit keeps its factor while the view is hidden; a factor past the range is asked for as the range's end.
- `editor.zoom` is the factor in effect (also on `IEditor`), `editor.zoomRequest` what was asked. `"zoom"` fires when either changes, with `{ zoom, previous, request }`; `"viewport"` fires when the factor does.
- Layout never changes. Clicks, hover, selection and drags read through the same scale; `getViewportRect` and its siblings — so every menu and popover — follow it. A page-unit offset from `getPageScreenPosition` is `offset × zoom` screen pixels. The `gap` between pages is in page units and scales too.
- The line at the top of the view stays put. Ctrl/Cmd + wheel and a trackpad pinch zoom about the pointer, over the editor or the scroll container's gutter beside it; with two editors in one scroll container, only the one under the pointer (`TileManagerOptions.zoomGestures`, `<Scrivr zoomGestures>`, default on).
- Pages are painted at the zoom's resolution, capped at what a browser will paint (iOS Safari's 16.7M pixels per canvas); past it the page is stretched, soft but never blank. `setupCanvas` takes `scale`, and its result's `dpr` — like the `dpr` handed to paints — is device pixels per page unit: the display's ratio times the zoom, capped.
- Overlay handlers draw in page units on a context scaled by that `dpr`. `screenPixels(n)` sizes something that keeps its screen size; `clearOverlay` takes the zoom. The caret, resize handles, drag feedback, collaborators' cursors and the AI caret keep their size on screen; `renderLabelledCaret` draws a named caret, and the AI caret's label matches a collaborator's (11px).
- `resolveZoom(request, viewport, pageConfig)` is exported, returning `null` for a fit with nothing to measure.
- React: `useZoom(editor)` (the factor) and `useZoomRequest(editor)` (what was asked); the header/footer ribbon follows the zoom.
