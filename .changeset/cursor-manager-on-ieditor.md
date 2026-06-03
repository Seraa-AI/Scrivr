---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — expose `cursorManager: CursorManager` on the `IEditor`
interface so extensions running in `onViewReady` can reset the blink
cycle and read the current blink phase with full typing instead of
ad-hoc structural mirrors.

`ServerEditor` still does not implement this surface — blink is a
view-layer concern and only `Editor` (browser) carries a `CursorManager`.
The `IBaseEditor` interface is unchanged.

`@scrivr/plugins` — `HeaderFooter` no longer carries the `CursorManagerLike`
structural-typing workaround. The `isCursorManagerLike` runtime guard
and `getCursorManager` / `isCursorVisible` helpers are gone; call sites
now read `editor.cursorManager` directly. No behavior change — the
blink reset on every header keystroke and the cursor-visibility gate
on the overlay handler fire identically. Just the wrong-shape failure
class (a rename of `CursorManager.resetSilent` would have silently
broken header blink behavior) is removed.

Other packages: lockstep version bump, no behavior change.
