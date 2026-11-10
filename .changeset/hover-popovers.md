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

A wrapped link peeks under the line the pointer rests on, and shows full under
the line the caret is on. `editor.getRangeViewportRects(from, to)` is new: one
rect per line a range paints on, `Range.getClientRects()` for the canvas. Each
`HoverTarget` carries `at`, where in it the pointer rests; a target built by
hand must set it.

A popover keeps showing the same link, image or table through a
collaborator's edit (`onMove`), and shows a different one anew (`onShow`), so
an edit elsewhere no longer cancels a link edit or overwrites an image size
being typed. The `"update"` event now carries the transaction's `mapping`;
code that emits `"update"` itself must pass one (`StepMap.empty` will do).
Hover positions are mapped before `"update"` is emitted.

Escape or typing closes a peek at once, even under the pointer, with
`dismissed: true` on the hover event; a lone modifier, `Fn` and `Super`
included, does not. Moving onto another link while a peek is open swaps after
the grace period, so crossing it on the way into the peek keeps the peek.

`resolvePointOwner` takes a required `regionAt`: a `behind` image under a
table no longer owns points in the table's cells, for hover as for click. A
linked inline image is hovered as a link too.

`IEditor` gains `getNodeViewportRects`, `getRangeViewportRects` and
`getHoverTargets`. A hand-written `IEditor` test double needs all three;
returning `[]` from each is enough.
`ResolvedExtension` gains a required `hoverResolvers` array; code that builds
one by hand passes `[]`.
