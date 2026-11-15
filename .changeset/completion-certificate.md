---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

Certificate of completion. `buildCompletionCertificate` (core) checks a signing's own chain — the sealed snapshot against its `contentHash`, the executed PDF's bytes hashed, every signature answered with its `signedAt` — and builds a certificate document whose *Verified at issue* section holds only what it checked, followed by the host's parties and events under the issuer's name, printed as given. It refuses an altered snapshot, an incomplete signing, a record whose parties do not fit the document, an unzoned time, or events out of order. `exportCompletionCertificate` prints it with the same exporter as the executed record (`certificateHash`); `bundleCertificate` puts the executed pages and the certificate's in one file (`bundleHash`). Labels are overridable for other languages.
