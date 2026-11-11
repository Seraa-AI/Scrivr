---
"@scrivr/core": patch
"@scrivr/docx": patch
---

Fields come in more kinds, and hosts can add their own. Name, email, title, company, number and dropdown join signature, initials, date, text and checkbox. A dropdown carries its choices and exports to Word as a dropdown list. `Field.configure({ kinds })` registers a kind with a label, a box size and a `control` (signature line, checkbox, date, dropdown or text), which decides how it draws, toggles, prints and exports. A new guide, "Fields", explains how fields work and how to add a kind.
