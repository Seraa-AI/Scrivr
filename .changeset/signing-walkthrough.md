---
"@scrivr/plugins": patch
---

A signature that has to wait says so, and pressing it takes the signer where they need to go. `SigningFieldDrawing.waitingOn` counts the viewer's fields still owed before a held-back signature, and the default painter shows "After N fields" in place of "Sign". Pressing a held-back signature opens the first field owed, scrolled into view, rather than only moving focus to it. A checkbox is still never ticked on the signer's behalf; it gets focus only.
