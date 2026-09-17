---
"@scrivr/core": patch
"@scrivr/react": patch
---

A font picker can say what backs each family

**Breaking: `Editor.fontFamilies` is `readonly FontFamilyOption[]`, not
`readonly string[]`.** `fontFamilies.map((option) => option.family)` restores
the old value.

The inventory knows each family's weights and slants and the list threw all of
it away, so a control could offer a family without being able to say whether
its bold would be a designed face or a thickened stand-in — or whether an
export could carry it at all.

Each entry is one family, not one face: bold and italic are marks with their
own controls, and offering "Inter Bold" as a choice would both duplicate them
and name a family no inventory holds. `faces` is what the application owns, and
is empty for a family only the host has, since nothing is known about such a
family's weights. `portable: false` says an export will resolve past it.

The playground's font control now marks a host-only family and describes what
each family is missing on hover.
