---
"@scrivr/export-pdf": patch
---

A certificate of completion can be laid out by the host. `content` may return a `body` — the certificate as document nodes in the host's schema — with slots for Scrivr's parts: `verified` (what was checked, exactly once), `record` (the issuer's title) and `signature` per role, which puts a signature in its signer's card. The body is checked against the schema, and a layout that drops or repeats what was checked, or names a role no party plays, is refused.

Certificates are now printed in the signers' own editor setup rather than StarterKit alone, so a host's extensions, tables, colour, links and header and footer work on them. The block form (`before`, `record`, `after`) keeps its layout, but it takes the setup's styles, and a setup that cannot hold what it prints — headings, paragraphs, bold, and images when a signature is drawn — is refused with `unprintable-certificate`.
