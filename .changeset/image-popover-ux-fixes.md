---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
---

Playground image and popover UX fixes.

**Images**

- Click adjacent to an inline image now places the cursor instead of force-selecting the image. Selection only fires when the click is physically inside the image's visual rect (new `CharacterMap.objectRectAtPoint`).
- Toggling an end-of-document image to wrap (`square-left` / `square-right`) or break (`top-bottom`) no longer makes it disappear. Pass 2 float placement now materialises any overflow page it assigns so the float has a tile to render on.
- Break-mode images honour `attrs.width`. Resize handles and the `ImageMenu` W/H inputs actually change the rendered size — the exclusion zone still spans the full content width so text can't wrap beside the image.
- Resize drag ghost now grows in the drag direction. New `computeGhostRect` pins the edge opposite the dragged handle so dragging a left/top handle visually expands leftward/upward instead of from the original top-left.
- Resize drag ghost updates on every mousemove. Overlay paint used to short-circuit until the next cursor-blink tick, so break-mode handles never appeared to move at all until mouseup; the overlay now has a `pendingResizeDirty` check.

**Popovers (ImageMenu, LinkPopover, BubbleMenu, FloatingMenu, SlashMenu, TrackChangesPopover, AiSuggestionPopover)**

- Popovers follow their anchor on scroll and resize instead of freezing. New `viewport` editor event emitted by `TileManager` on scroll / resize; menu controllers listen via the shared `subscribeViewUpdates` helper.
- Popovers hide when their anchor scrolls above or below the visible content area, so `position: fixed` popovers no longer render over app chrome (top toolbars, headers). New `editor.getScrollContainerRect()` + `setScrollContainerLookup()`; menus call the shared `isAnchorInsideContainer` helper.
