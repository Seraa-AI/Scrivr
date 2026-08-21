---
"@scrivr/core": minor
---

**Node Actions Support**

Extensions can now contribute contextual operations for the UI to render (e.g., context menus, node gutters) based on the current selection.

- **`addNodeActions()`** — introduced in the `Extension` contract. Extensions declare what actions they support for a given selection `kind`, moving action definition away from hand-written UI factories into the extensions themselves.
- **`NodeActionRegistry`** — resolves, deduplicates, and sorts node actions dynamically against the active selection context during render.
- **`IEditor.getNodeActions()` and `IEditor.runNodeAction(id)`** — new API surface exposing resolved actions to the UI, allowing it to seamlessly render and execute actions by ID.
- **`buildNodeActions()`** — implemented in `ExtensionManager` to aggregate these contributions across all loaded extensions.

The built-in `Image` extension has been updated to provide a placeholder node action as a proof of concept.
