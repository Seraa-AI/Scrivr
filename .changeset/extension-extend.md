---
"@scrivr/core": patch
---

Extensions can be extended. `extension.extend(overrides)` returns a new extension: a hook you declare replaces the original's, and can call it as `this.parent` to change or add to its result. Hooks you leave out stay the original's.

- **Options:** they carry over and merge, and `configure` still applies afterwards.
- **Names:** `name` renames the extension. Keys its hooks write literally stay the same, and a key built from `this.name` follows the new name.
- **Chaining:** each layer's `parent` is the one below it.
- **New types:** `ExtendConfig`, `ExtendHookContext`, `ExtensionHookName` and `Phase1Context` (the context most hooks run in) are exported.
