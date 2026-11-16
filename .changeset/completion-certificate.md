---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

Certificate of completion. `exportCompletionCertificate(snapshot, values, { editorOptions, record })` (export-pdf) issues the executed PDF and its certificate from one printing: *Verified at issue* holds only what it checked — the snapshot against its hash, the executed PDF's hash, each signature as that PDF prints it — and the host's parties, events and signing times follow under the issuer's name. It refuses as `exportExecutedPdf` does (a drawing with no area now answers nothing), and for an unknown field kind, a record with no issuer or two parties for one role, a record that does not fit the document, an undated or unzoned time, an event it cannot name, or events out of order. `bundleCertificate` joins the two PDFs; labels are overridable for other languages, and `content` adds a host's blocks before and after the certificate or replaces the record's body — never what was verified. Core adds `snapshotDocument`, `readSigningMoment` (with `SigningMoment`) and `documentFromBlocks`.
