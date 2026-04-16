---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

Add standalone `getSchema()` function for building a ProseMirror schema from extensions without instantiating an Editor. Standardize all node/mark type names to camelCase (`tableRow`, `hardBreak`, `fontSize`, `fontFamily`, `trackedInsert`, `trackedDelete`, etc.) for a consistent naming convention across the schema.
