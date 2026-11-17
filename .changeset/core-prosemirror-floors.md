---
"@scrivr/core": patch
---

Core now requires the current ProseMirror packages: prosemirror-transform ^1.12.6, prosemirror-model ^1.25.13, prosemirror-commands ^1.7.2, prosemirror-history ^1.5.1, prosemirror-inputrules ^1.6.0, prosemirror-schema-list ^1.6.0 and prosemirror-markdown ^1.13.9. Scrivr's plugins reach ProseMirror through `@scrivr/core/pm`, so an app that pins older `prosemirror-*` versions directly installs a second copy, and its steps and marks then fail Scrivr's `instanceof` checks: import from `@scrivr/core/pm` instead. prosemirror-model now validates attributes when a node or mark is created, so content built with an attribute its schema's `validate` refuses throws at creation rather than at `check()`.
