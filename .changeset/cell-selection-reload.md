---
"@scrivr/core": patch
---

Editing the cell selection's module while a dev server runs no longer throws
"Duplicate use of selection JSON ID scrivr:cell": the `scrivr:cell`
registration goes on while a dev server hot-reloads the module
(`import.meta.hot`). A second registration anywhere else still fails fast, as
a duplicate Scrivr runtime.
