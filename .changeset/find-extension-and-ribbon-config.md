---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — new `editor.findExtension(name)` API and React
ribbon sizes itself from `HeaderFooter.options.activeEditingGap`
(no more parallel magic constant).

**New public API:**

```ts
const ext = editor.findExtension("headerFooter");
if (ext) {
  // ext.options is typed as `object` (the manager has no compile-time
  // link from name → option shape); narrow with a runtime guard.
}
```

Returns the registered `Extension` instance or `null`. Mirrors the
existing `ExtensionManager.findExtension(name)` it delegates to.
Useful for cross-package consumers (React adapter hooks, future
DevTools) that want to read another extension's configured options
without coupling to its presence.

**Ribbon now reads its size from the extension config:**

`useHeaderFooterRibbon` (in `@scrivr/react`) now calls
`editor.findExtension("headerFooter")` and reads
`options.activeEditingGap`. The returned hook value exposes
`ribbonHeight`, which `HeaderFooterRibbon.tsx` uses for both the
ribbon's CSS `height` and its top offset. The previous hardcoded
`28` is gone from the React side — the only remaining `28` is a
defensive fallback for the case where the `HeaderFooter` extension
is not registered at all (so `findExtension` returns null).

Change `HeaderFooter.configure({ activeEditingGap: 40 })` and the
extension's reserved gap *and* the ribbon's height move together,
no manual sync.

Other packages: lockstep version bump, no behavior change.
