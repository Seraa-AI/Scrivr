---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

Certificate of completion. `buildCompletionCertificate` (core) takes the sealed snapshot and `exportExecutedPdf`'s result and builds a certificate whose *Verified at issue* section holds only what it checked — the snapshot against its hash, the executed PDF's bytes hashed, every signature it printed with its time — then the host's parties and events under the issuer's name. It refuses an altered snapshot, an incomplete signing, a record that does not fit the document, an undated or unzoned time, or events out of order. `exportCompletionCertificate` prints it (`certificateHash`); `bundleCertificate` joins it to the executed PDF (`bundleHash`). `exportExecutedPdf` now returns the `values` it printed, and core exports `snapshotDocument`.
