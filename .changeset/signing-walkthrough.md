---
"@scrivr/plugins": patch
---

A signature that has to wait says so, and pressing it takes the signer where they need to go. `SigningFieldDrawing.fieldsBeforeSigning` counts the viewer's fields that must be answered before a signature can be signed — the rule pressing it applies — and the default painter shows `waitingLabel` ("After N fields", worded with `FieldCompletion.configure({ waitingLabel })`) in place of "Sign". Pressing a waiting signature opens the first field owed, scrolled into view. A checkbox is still never ticked on the signer's behalf; it gets focus only.
