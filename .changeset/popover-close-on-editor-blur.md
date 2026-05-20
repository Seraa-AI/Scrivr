---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

**Popover UX — close on editor focus loss.** Floating menus (bubble menu,
slash menu, link popover, image menu, floating block menu, AI suggestion
popover, track-changes popover) now hide when the editor loses DOM focus
to something that isn't the popover itself. Previously they stayed
anchored to invisible selection state when the user clicked into a sidebar,
the browser address bar, or another window — the classic "feels weird"
artifact of subscribing only to PM state changes (DOM blur leaves the
selection untouched).

New `subscribeEditorFocusOutside(editor, onHide, { getPopoverElement? })`
helper in `@scrivr/core/menus` is the shared signal source. Defers the
hide one microtask so a click *into* a popover (which blurs the editor
then focuses an input inside) settles before the check runs.

Popover detection, in priority:

1. `getPopoverElement()` — accessor returning the popover's root DOM node.
   Each `createXMenu` controller now accepts this, and each React hook
   threads its `rootRef.current` through. Bulletproof for internal
   popovers — no marker attribute required.
2. `[data-scrivr-popover="<menu-name>"]` ancestor — fallback for vanilla
   / third-party popovers that don't have a ref accessor. The seven React
   components ship with a named marker (`bubble-menu`, `link-popover`,
   etc.) as defense in depth and to keep DOM inspection self-documenting.

Header/footer surfaces are intentionally excluded — they're a persistent
editing mode, not a popover.

**`cx` utility upgrade.** The class-name combiner in `@scrivr/react/utils`
now accepts strings, numbers, falsy values, nested arrays, and conditional
dictionaries in addition to the previous string-only positional form. The
eight existing callers continue to work unchanged (they pass positional
strings, which the new shape handles identically). New shapes available:

```ts
cx("btn", isActive && "btn-active");           // already worked
cx("btn", { "btn-active": isActive });          // NEW — conditional dict
cx(["base", flagged && "flag"]);                // NEW — nested arrays
cx("col-", count);                              // NEW — numbers
```

Return contract preserved: `string | undefined`. Tailwind utility-class
conflicts are NOT auto-merged (pull in `tailwind-merge` for that).

**React test runner bootstrap.** `@scrivr/react`'s `"test": "true"`
placeholder is replaced with real vitest + a node-environment config.
First occupant: 15 tests for the upgraded `cx` covering positional
strings, conditional dicts, nested arrays, numbers, dedup order, and the
documented Tailwind non-merge limitation. Removes one item from the
stable-1.x roadmap's "React adapter has no regression tests" gap.

Other packages: lockstep version bump, no behavior change.
