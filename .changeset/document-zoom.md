---
"@scrivr/core": patch
"@scrivr/react": patch
---

Zoom the document without changing it. `editor.setZoom(1.5 | "fit-width" | "fit-page")` (or `zoom` in `EditorOptions` / `useScrivrEditor`) shows the pages at a factor from `MIN_ZOOM` (10%) to `MAX_ZOOM` (500%), or fitted to the scroll container, re-fitting as it resizes. Layout never changes: each page is painted at the zoom's resolution, clicks, hover, selection and drags read through the same scale, and `getViewportRect` and its siblings — so every menu and popover — follow it. `editor.zoom` is the factor in effect, `editor.zoomRequest` what was asked, and a `"zoom"` event (with `"viewport"`) fires when it changes. The line at the top of the view stays put across a change; Ctrl/Cmd + wheel and a trackpad pinch zoom about the pointer (`TileManagerOptions.zoomGestures`, `<Scrivr zoomGestures>`, default on). The caret and resize handles keep their screen size; overlay handlers draw in page units with a context scaled by the pixel ratio and the zoom, and `screenPixels(n)` sizes something that should keep its size on screen. `setupCanvas` takes `scale`. React: `useZoom(editor)`, and the header/footer ribbon follows the zoom.
