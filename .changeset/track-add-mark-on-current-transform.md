---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

Track added formatting on prosemirror-transform 1.12.3 and later. `AddMarkStep.invert` there needs the document, so the no-argument call threw, the error was swallowed, and bold or colour landed untracked. Core now asks for the latest ProseMirror packages (`prosemirror-transform` ^1.12.6, `prosemirror-model` ^1.25.13 and the rest), which Scrivr's own tests now run against.
