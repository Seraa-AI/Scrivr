---
"@scrivr/core": patch
---

Extensions can be extended. `extension.extend(overrides)` returns a new extension: a hook you declare replaces the original's, and can call it as `this.parent` to change or add to its result. Hooks you leave out stay the original's.

- **Options:** they carry over and merge, and `configure` still applies afterwards.
- **Names:** an extended extension can be renamed so it sits beside the original.
- **Chaining:** each layer's `parent` is the one below it.
- **New types:** `ExtendConfig`, `ExtendHookContext` and `ExtensionHookName` are exported.
