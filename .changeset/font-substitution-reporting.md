---
"@scrivr/core": patch
"@scrivr/react": patch
---

The editor can say which fonts it is not getting

DOCX import reported substitutions once and PDF export reported them at the
end. Nothing answered the question in between, even though the layout had held
the answer since it started recording resolutions.

`Editor.fontSubstitutions` returns the same `FontShortfall` shape the other two
producers emit, derived from the current layout and memoised on its version so
a `useEditorState` selector only re-renders when the answer changes.

`Editor.getActiveFontFamily()` returns `{ requested, resolved, substituted }`
for the selection. The inline-mark → block-attr → document-default precedence
is the editor's own rule, so a font control reading it cannot drift from the
page it describes.

No UI: whether a substitution is a badge, a banner or nothing depends on what
the application is for.
