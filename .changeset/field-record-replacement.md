---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
---

Add `replaceFieldValues` to replace a complete field record atomically without changing the document. Executed PDF export uses this boundary so configured initial values cannot fill missing answers or replace unprintable signatures. Field completion reports editor refusals through `onFieldRequestError`, preserves the previous answer, and allows retry.
