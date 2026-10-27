---
"@scrivr/core": patch
"@scrivr/react": patch
---

Links, images and tables peek on hover; selecting them expands the same popover.

Hover used to pick a mouse cursor and nothing else. Reading where a link went
meant clicking into it, which moved the caret and opened the edit popover;
tables had no popover at all.

The editor now records what the pointer is over and emits `"hover"` when that
changes. `editor.resolveHoverTargets(point)` and `editor.getHoverTargets()`
answer with every layer, innermost first — a link in a table cell is
`[link, table-cell, table]`. Click routing keeps `resolveHitTarget`'s first-wins
chain, so a hover claim never shadows a click. Extensions claim marks or nodes
through `addHoverResolvers`; `Link` and `Table` ship theirs. Outside the body
content box — margins, the page gap, a header or footer band — there is no
target.

`createLinkPopover` and `createImageMenu` report `presentation: "peek" | "full"`:
a compact read-only peek once the pointer has rested on the target, the full
popover when the selection is in it. Selection wins, and peek → full grows in
place through `onMove`. `createTableMenu` is new, with `useTableMenu` and
`<TableMenu>` in React. Each takes `hover: false` to stay selection-only, or
`{ showDelay, hideDelay }`; `subscribeHoverTarget` is the debounced listener
they share. `<LinkPopover>` takes `renderPeek` / `renderFull`.

`editor.getNodeViewportRects(docPos)` returns one rect per painted fragment, so
a table split across pages can be anchored on whichever page is on screen.

`IEditor` gains `getNodeViewportRects` and `getHoverTargets`. A hand-written
`IEditor` test double needs both; returning `[]` from each is enough.
