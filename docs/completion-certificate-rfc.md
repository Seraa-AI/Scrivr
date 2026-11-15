# RFC: Certificate of completion

Status: draft (2026-11-15) — see [Open questions](#open-questions--answer-before-building).
Builds on [Sealed Revisions](./sealed-revisions-rfc.md).

## Problem

A signing ends with two artifacts in every e-signature tool: the executed
document, and a certificate that says who signed it, when, and that it has
not changed since. DocuSign calls it the Certificate of Completion, Adobe
Acrobat Sign the Audit Report, Dropbox Sign the Audit Trail, Documenso the
signing certificate. A host building signing on Scrivr has the first —
`exportExecutedPdf` prints the sealed snapshot with every party's values and
returns its `artifactHash` — and has to build the second by hand, outside
Scrivr, from facts Scrivr already holds and could check.

Building it by hand goes wrong in specific ways:

- **It restates facts without checking them.** A certificate that prints a
  `contentHash` copied from the host's database proves nothing if the
  snapshot beside it was edited since. Scrivr can verify the hash at the
  moment the certificate is made; a hand-built page just repeats it.
- **It drifts from the record.** Who signed which field, and when, is in the
  values `exportExecutedPdf` printed: each signature carries its `signedAt`.
  A certificate assembled from a second source can disagree with the
  executed PDF it describes.
- **It needs a second renderer.** The executed PDF comes out of Scrivr's
  exporter, with its fonts. A certificate written with another PDF library
  looks like another product's page stapled on.

## Scope — revisiting a line the Sealed Revisions RFC drew

That RFC listed "completion certificates" among what Scrivr does **not** own,
with signers, identity, consent and evidence ledgers. The reason stands:
identity is the host's, and Scrivr's type system must not grow a person.

This RFC moves the line by exactly one step. Scrivr does not own the
*ceremony record* — who a party is, how they authenticated, where from, every
event the host logged. It does own the *document's chain* — sealed snapshot →
`contentHash` → signer values → executed PDF → `artifactHash` — and only
Scrivr can check that chain end to end. So:

| On the certificate | Owner | Scrivr's part |
|---|---|---|
| The snapshot matches `contentHash` | Scrivr | **checks**, at issue |
| The executed PDF matches `artifactHash` | Scrivr | **checks**, at issue |
| Each required signature is answered, and when (`signedAt`) | Scrivr | **checks** against the values printed |
| Fields per role, page count | Scrivr | **reads** from the snapshot |
| Party names, emails, authentication, IP, user agent | host | prints as given |
| Events (sent, viewed, consented, signed, completed) | host | prints as given, checked for order and zone |
| Document id, title, issuer | host | prints as given |

The certificate shows which is which. That is the one thing a library's
certificate can do that a hand-built one cannot: say plainly which lines a
machine checked against the document, and which are the host's word.

## Prior art

- **DocuSign — Certificate of Completion.** Envelope id; page, signature and
  initials counts; per signer: name, email, security level, signature image,
  IP, and sent / viewed / signed timestamps; envelope events (sent,
  delivered, signing complete, completed). Times in UTC. A separate download
  from the envelope.
- **Adobe Acrobat Sign — Audit Report.** Title, created, creator, status,
  transaction id; the agreement's history, every event in GMT "to mitigate
  confusion for auditors reviewing transactions from users across multiple
  time zones". IP collection is off unless an admin enables it. Interim
  reports are marked interim; the final report is made when the agreement
  reaches a terminal state. Concatenated with the agreement into one PDF by
  default, or downloadable alone; findable by transaction id.
- **Dropbox Sign — Audit Trail.** A document id (GUID), each view and
  signature with its time and IP, and the SHA-256 of the document when it was
  uploaded and when it completed — "the hash proving the document wasn't
  altered after signing". Affixed to the document, or separate on request.
- **Documenso (open source).** A signing certificate PDF — signers and a
  timeline — and an optional audit-log PDF, appended to the signed document;
  the whole file is then digitally sealed with the instance's certificate.

Common to all four: per-party identity and events, UTC times, a document
id, the document's hash, and a choice between appending and a separate file.
None separates what was checked from what was asserted — they do not need
to, because each vendor ran the whole ceremony and vouches for all of it.
A library does not, so it must.

## Decisions

1. **Checked and asserted, shown apart.** The certificate's first section is
   *Verified at issue*: the two hashes and the signatures, each with what was
   checked. Everything the host supplies sits under *Signing record — as
   recorded by {issuer}*. Scrivr never prints a host fact as checked.

2. **Issued only for a complete signing.** It is a certificate of
   *completion*: issuing refuses while a required field is unanswered, as
   `exportExecutedPdf` does. (An interim report is an open question.)

3. **A separate PDF that names the executed one by hash.** The certificate
   quotes the executed PDF's `artifactHash`, so it cannot be inside the bytes
   that hash covers. It is its own PDF with its own `certificateHash`. The
   executed record stays exactly the artifact the signers' values were
   printed into, verifiable alone. (Appending, as Adobe and Documenso do, is
   an open question.)

4. **A Scrivr document, printed by the same exporter.** The certificate is
   built as an ordinary document — headings, a table per party, the drawn
   signatures as images — and exported by `@scrivr/export-pdf`, so it shares
   the executed record's fonts and page setup and needs no second renderer.
   Building and printing are two steps: `buildCompletionCertificate` returns
   the document, so a host can show it in a viewer, restyle it, or add a
   section before printing.

5. **Times are UTC, and each signature also as signed.** Events print in UTC,
   as every vendor does. A signature also shows `signedAt` in the signer's
   own offset — the day `formatSignedDate` printed in its date-signed field,
   so the certificate and the record agree on the date. A time without a zone
   is refused: an audit line whose instant is ambiguous is worse than none.

6. **The signatures come from the values printed.** A party's signature on
   the certificate — its drawing, or its typed text — is read from the same
   `values` `exportExecutedPdf` printed, through `Field`'s kinds. There is no
   second list of who signed.

7. **Personal data is what the host passes, nothing more.** IP, user agent
   and authentication method are optional per party, as Adobe makes IP
   collection opt-in. Scrivr reads no request, header or clock.

8. **Not a digital signature.** Scrivr returns bytes and their hash. Sealing a
   PDF with an X.509 certificate (PAdES), as Documenso does, needs the host's
   key, which never enters Scrivr; the host signs the bytes it is given.

9. **Labels are the host's language.** Every heading and label comes from one
   table with English defaults that a host overrides, so a certificate can be
   issued in the signers' language.

## API

```ts
// @scrivr/core — pure: no PDF, runs in a browser or a backend
const built = await buildCompletionCertificate({
  snapshot,                 // { content, contentHash, fields } from createSnapshot
  values,                   // what exportExecutedPdf printed
  executed: { bytes },      // the executed PDF, hashed here — never trusted from a column
  record: {
    documentId: "AGR-2026-0042",
    title: "Master Services Agreement",
    issuer: "Acme Sign",
    parties: [
      {
        role: "client-authorized-signatory",
        name: "Ada Lovelace",
        email: "ada@example.com",
        authentication: "Email code",
        ip: "203.0.113.7",            // optional, like everything below name
      },
    ],
    events: [
      { at: "2026-11-15T09:12:03Z", kind: "sent", party: "client-authorized-signatory" },
      { at: "2026-11-15T09:40:51+03:00", kind: "viewed", party: "client-authorized-signatory" },
      { at: "2026-11-15T09:44:10+03:00", kind: "signed", party: "client-authorized-signatory" },
      { at: "2026-11-15T09:44:12Z", kind: "completed" },
    ],
  },
  labels,                    // optional overrides of the English defaults
});
// { ok: true, certificate: { content: DocJson, verified: VerifiedFacts } }
// | { ok: false, refusal }

// @scrivr/export-pdf
const issued = await exportCompletionCertificate(built.certificate, { editorOptions, ...pdfOptions });
// { pdf: Uint8Array, certificateHash: "sha256:…" }
```

`VerifiedFacts` is the checked section as data — `contentHash`,
`artifactHash`, and per role the answered signatures with `signedAt` — so a
host stores exactly what the certificate claims beside it.

### Refusals

A result, not an exception, as `createSnapshot` and `exportExecutedPdf` do:
each is an answer the host shows someone.

| `reason` | When |
|---|---|
| `snapshot-altered` | `verifySnapshot(content, contentHash)` fails |
| `unanswered-fields { missing }` | a required field has no answer — not complete |
| `unknown-party { role }` | a party's role carries no field in the snapshot |
| `missing-party { role }` | a role with fields has no party in the record |
| `unzoned-time { at }` | an event time or a `signedAt` names no zone |
| `signed-after-completed` | a signature's `signedAt` is later than the `completed` event |

The executed bytes are hashed, not compared to a stored hash: the
certificate quotes the hash of the bytes it was given, so a host that hands
over the wrong file gets a certificate for that file, never a false match.

## Ownership

- **The chain's facts** are read where they already live: `verifySnapshot`
  and `hashArtifact` (core `sealing/`), the fields from `snapshot.fields`, the
  answers and their `signedAt` through `Field`'s kinds — the same functions
  `exportExecutedPdf` uses to refuse an unanswered record.
- **The record** is the host's, passed in, never stored.
- **The certificate document** is built in one pure function in core
  `sealing/certificate.ts`; printing is `@scrivr/export-pdf`'s, beside
  `exportExecutedPdf`.

## What changes, where

| Place | Change |
|---|---|
| `core/src/sealing/certificate.ts` (new) | `buildCompletionCertificate`, `CompletionRecord`, `VerifiedFacts`, refusals, default labels |
| `core/src/sealing/snapshot.ts` | nothing — reused |
| `export-pdf/src/certificate.ts` (new) | `exportCompletionCertificate` — the exporter, then `hashArtifact` |
| `docs/guides/sealing.mdx` | the certificate step after the executed PDF |
| playground *Signing* demo | "Download certificate" beside the executed PDF |

## Invariants

- Every line under *Verified at issue* was checked in that call; nothing the
  host supplied appears there.
- The certificate's `artifactHash` is the hash of the bytes it was given.
- The signatures it shows are the values the executed PDF printed.
- The day shown for a signature equals the date-signed field's day in the
  executed PDF.
- No refusal case yields a certificate.

## Tests

- Verified section: built from a real snapshot and a real executed PDF, its
  hashes equal `contentHash` and `hashArtifact(bytes)`.
- Each refusal, one test each, from a real snapshot.
- A party's drawn signature appears as the image `exportExecutedPdf` embedded.
- A signature's shown day matches the executed PDF's date-signed field for an
  offset that crosses midnight UTC.
- Host fields absent → their lines absent, not blank.
- Labels override; defaults otherwise.
- Export: the PDF's hash is `certificateHash`; the certificate's text lists
  the executed `artifactHash`.

## Out of scope

- Signing the certificate or the executed PDF with an X.509 key (PAdES).
- Storing, emailing or looking up certificates by id.
- Events Scrivr could observe itself (`ReadingProgress`'s pages in view) —
  the host already receives them and decides what its record keeps.
- An audit log of every event in a separate PDF (Documenso's second file).

## Open questions — answer before building

1. **Separate, or appended?** Decision 3 keeps the certificate a separate PDF
   so the executed record's hash is untouched. Adobe and Documenso append by
   default; a host that wants one file could get `bundleCertificate(executed,
   certificate)` → `{ pdf, bundleHash }`, the certificate inside still
   naming the executed record's hash. Ship the helper now, later, or never?
2. **Interim reports.** Adobe issues interim reports marked as such while an
   agreement is in progress. Issue only on completion (Decision 2), or also
   an interim certificate with its own refusal set?
3. **`documentId`.** This RFC takes the host's id as an opaque string. The
   next PR, Word-signature import, introduces a document id of Scrivr's own;
   should the certificate print both, or should Scrivr's become the default
   when the host gives none?
4. **Event kinds.** A closed set (`sent`, `viewed`, `consented`, `signed`,
   `declined`, `completed`) labelled through the table, or any string the
   host likes? Closed lets Scrivr check order and translate; open fits hosts
   with their own steps.

## What shipped

Nothing yet — this section records the build as each part lands.

## Sources

- [DocuSign certificate contents, as summarised by an Oracle integration guide](https://docs.oracle.com/cd/E97085_01/TPMhelp/en/North_America/10311519.htm)
- [Adobe Acrobat Sign — Agreement history and audit report](https://helpx.adobe.com/sign/web/fedramp/user/agreement-history.html)
- [Adobe Acrobat Sign — Audit reports (admin)](https://experienceleague.adobe.com/en/docs/document-cloud-learn/sign-learning-hub/admin-set-up/getting-started-admin/audit-reports)
- [Dropbox Sign — Understanding audit trails](https://help.dropbox.com/security/dropbox-sign-audit-trail-overview)
- [Dropbox Sign — Security & compliance glossary](https://developers.hellosign.com/api/manual-reference-pages/glossary/security-compliance)
- [Documenso — Signing certificates](https://docs.documenso.com/docs/concepts/signing-certificates)
