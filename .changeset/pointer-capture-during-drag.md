---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Closes the double-click rapid-drag race condition: while a drag is in flight, a second `mousedown` is now ignored. Without this guard, an accidental double-click during drag could fire two PM transactions from a single user gesture, or resolve text selection at a stale point.

**@scrivr/core**

- `PointerController.handleMouseDown` returns early when any drag is active (`isDragging`, `resizeDrag`, `anchoredDrag`, or `inlineImageDrag`). The guard releases on `mouseup` so a fresh gesture can start cleanly. Equivalent to `setPointerCapture` + `pointerdown` ignore — we use mouse events so the guard is explicit.
- **Tests.** Three new cases in `PointerController.dragUX.test.ts § Step 9 — pointer capture during drag`: anchored-drag re-entry, resize-drag re-entry, and post-mouseup re-acquisition.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
