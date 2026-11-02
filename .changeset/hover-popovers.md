---
"@scrivr/core": patch
"@scrivr/react": patch
---

Links peek on hover; images and tables can too. Selecting any of them expands
the same popover.

Hover used to pick a mouse cursor and nothing else. Reading where a link went
meant clicking into it, which moved the caret and opened the edit popover;
tables had no popover at all.

The editor now records what the pointer is over and emits `"hover"` when that
changes. `editor.getHoverTargets()` answers with every layer, innermost first —
a link in a table cell is `[link, table-cell, table]`. Click routing keeps
`resolveHitTarget`'s first-wins chain, so a hover claim never shadows a click.
Extensions claim marks or nodes through `addHoverResolvers`; `Link` and `Table`
ship theirs. Text is hovered only inside the content box; an image or table
cell is hovered wherever its own rect is, so an image hanging into the margin
still peeks. Hover positions follow edits made while the pointer rests; those
events carry `fromEdit: true`, and a peek whose target an edit deleted closes
at once.

`createLinkPopover` and `createImageMenu` now pass
`presentation: "peek" | "full"` on `LinkPopoverInfo` and `ImageMenuInfo` — a
required field, so code that builds either type by hand must set it. Peek is a
compact read-only card once the pointer has rested on the target; full is the
popover as before, shown when the selection is in it. Selection wins, and peek
→ full grows in place through `onMove`.

**Hover is on by default for links**, so existing `createLinkPopover` and
`<LinkPopover>` consumers will see `onShow` fire on hover. Pass `hover: false`
to keep the popover selection-only. Images and tables default to
`hover: false`, as in Word, Docs and Pages; pass `hover: true` or
`{ showDelay, hideDelay }` to turn their peeks on. `subscribeHoverTarget` is the
debounced listener the controllers share.

`createTableMenu` is new, with `useTableMenu` and `<TableMenu>` in React. Its
full menu renders `editor.getNodeActions()`, and the `Table` extension now
contributes row, column and delete-table actions for a cell selection. They
are hidden in a read-only editor, where a cell selection shows the table's
peek instead. `<LinkPopover>`, `<ImageMenu>` and `<TableMenu>` take
`renderPeek` / `renderFull`.

`createImageMenu` now shows only for an image selection. It used to show for
any selection with node actions, which a table-cell selection now has.

`editor.getNodeViewportRects(docPos)` returns one rect per painted fragment, so
a table split across pages can be anchored on whichever page is on screen.
Nodes inside table cells are found too, so a table nested in a cell gets its
own menu.
`getNodeViewportRect(docPos)` is its first entry, so it now answers for tables
and paragraphs as well as images.

`IEditor` gains `getNodeViewportRects` and `getHoverTargets`. A hand-written
`IEditor` test double needs both; returning `[]` from each is enough.
`ResolvedExtension` gains a required `hoverResolvers` array; code that builds
one by hand passes `[]`.
