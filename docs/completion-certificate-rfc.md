# RFC: Certificate of completion

Status: path locked (2026-11-15) — open questions answered; see [Decided](#decided-2026-11-15).
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

Common to them: per-party identity and a timeline of events, with an id
for the transaction, and the certificate either appended to the document or
kept as its own file. DocuSign and Adobe give times in UTC; Dropbox Sign
records the document's hash. None separates what was checked from what was
asserted — they do not need
to, because each vendor ran the whole ceremony and vouches for all of it.
A library does not, so it must.

## Decisions

1. **Checked and asserted, shown apart.** The certificate's first section is
   *Verified at issue*: the two hashes and the signatures, each with what was
   checked. Everything the host supplies sits under *Signing record — as
   recorded by {issuer}*. Scrivr never prints a host fact as checked.

2. **Issued only for a complete signing.** It is a certificate of
   *completion*: issuing refuses while a required field is unanswered, as
   `exportExecutedPdf` does. No interim report.

3. **A separate PDF that names the executed one by hash.** The certificate
   quotes the executed PDF's `artifactHash`, so it cannot be inside the bytes
   that hash covers. It is its own PDF with its own `certificateHash`. The
   executed record stays exactly the artifact the signers' values were
   printed into, verifiable alone. A host that wants one file, as Adobe and
   Documenso deliver, bundles the two with `bundleCertificate`: the executed
   pages, then the certificate's, under a `bundleHash` of their own.

4. **A Scrivr document, printed by the same exporter.** The certificate is
   built as an ordinary document — headings, labelled lines, the drawn
   signatures as images, nothing beyond StarterKit — and exported by
   `@scrivr/export-pdf`, so given the executed record's `editorOptions` it
   shares its fonts and page setup, and needs no second renderer.
   Building and printing are two steps: `buildCompletionCertificate` returns
   the document, so a host can show it in a viewer, restyle it, or add a
   section before printing.

5. **Times are UTC, and each signature also as signed.** Events print in UTC,
   as DocuSign and Adobe do. A signature also shows its `signedAt` read in
   the signer's own offset — the instant and offset its date-signed field
   reads, so the two agree on the day. A time that is not a full timestamp
   with a zone is refused, a bare day included: an audit line whose instant
   is ambiguous, or invented, is worse than none.

6. **The signatures come from the values printed.** `exportExecutedPdf`
   returns the values it printed — a drawing as it embedded it, none it
   could not — and the certificate takes that result whole, bytes and
   values together, so the signatures it shows are the ones that document
   holds. Read through `Field`'s kinds; there is no
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
  snapshot,                 // { content, contentHash } from createSnapshot
  executed,                 // exportExecutedPdf's result: { pdf, values } — bytes hashed here
  extensions: [StarterKit, Field], // the setup the executed PDF was printed with
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
      { at: "2026-11-15T09:30:00Z", kind: "custom", label: "Identity verified", party: "client-authorized-signatory" },
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

// One file, when the host wants it
const bundled = await bundleCertificate(executed.pdf, issued.pdf);
// { pdf: Uint8Array, bundleHash: "sha256:…" }
```

**Events** are one of `sent`, `viewed`, `consented`, `signed`, `declined`,
`completed`, labelled through the table, or `{ kind: "custom", label }`, a
host's own step, printed as given and placed by its time. Order is checked
where it means something: a party comes to the document — its first
`sent`, `viewed` or `consented` — before its first signing, whether that
signing is a checked signature or the host's `signed` event; and nothing is
signed after `completed`. Views after signing, or after completion, are
what signing tools record, and pass. A party with no fields — someone sent
a copy — is listed like any other.

`VerifiedFacts` is the checked section as data — `contentHash`,
`artifactHash`, and each signature with its role and `signedAt` — so a
host stores exactly what the certificate claims beside it.

### Refusals

A result, not an exception, as `createSnapshot` and `exportExecutedPdf` do:
each is an answer the host shows someone.

| `reason` | When |
|---|---|
| `snapshot-altered` | `verifySnapshot(content, contentHash)` fails |
| `unanswered-fields { missing }` | a required field has no answer — not complete |
| `missing-party { role }` | a role that answered or must answer a field has no party in the record |
| `unknown-party { role }` | an event names a role no party in the record plays |
| `unzoned-time { at }` | an event time or a `signedAt` is not a full timestamp with a zone |
| `undated-signature { fieldId }` | an answered signature carries no `signedAt` |
| `signed-after-completed { fieldId }` | a signature's `signedAt` is later than the `completed` event |
| `events-out-of-order { event }` | a party first comes to the document after it signed, or a `signed` event follows `completed` |

The executed bytes are hashed, not compared to a stored hash: the
certificate quotes the hash of the bytes it was given, so a host that hands
over the wrong file gets a certificate for that file, never a false match.

## Ownership

- **The chain's facts** are read where they already live: `verifySnapshot`
  and `hashArtifact` (core `sealing/`), the fields from the verified content,
  the answers and their `signedAt` from the values the executed PDF printed,
  through `Field`'s kinds — the same functions `exportExecutedPdf` uses to
  refuse an unanswered record.
- **The record** is the host's, passed in, never stored.
- **The certificate document** is built in one pure function in core
  `sealing/certificate.ts`; printing is `@scrivr/export-pdf`'s, beside
  `exportExecutedPdf`.

## What changes, where

| Place | Change |
|---|---|
| `core/src/sealing/certificate.ts` (new) | `buildCompletionCertificate`, `CompletionRecord`, `VerifiedFacts`, refusals, default labels |
| `core/src/sealing/snapshot.ts` | nothing — reused |
| `export-pdf/src/certificate.ts` (new) | `exportCompletionCertificate` — the exporter, then `hashArtifact`; `bundleCertificate` — copies both documents' pages into one |
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

## Decided (2026-11-15)

1. **Separate, with a bundle helper.** The certificate is its own PDF;
   `bundleCertificate` makes one file for hosts that want it, under its own
   `bundleHash`, the certificate inside still naming the executed record's
   `artifactHash`.
2. **Completion only.** No interim certificate.
3. **The host's `documentId` only, for now.** Printed as an opaque string.
   A document id of Scrivr's own, carried in the document, would be printed
   beside it once there is one.
4. **A closed set of events, plus custom.** The six kinds are checked for
   order and translated; `{ kind: "custom", label }` carries a host's own
   step, printed as given.

## What shipped

Built as designed above, which records the build. Two things worth knowing
that the design does not say:

- **The builder opens the snapshot as `exportExecutedPdf` does** — a sealed
  `ServerEditor` with the signers' `extensions`, holding the printed values,
  reading the fields from the verified content and completeness from
  `valuesOnRecordOf` — so a certificate is issued complete exactly when the
  executed PDF printed complete. Both read the snapshot's document through
  `snapshotDocument`.
- **A drawn signature keeps its proportions.** Core reads a drawing's pixel
  size from its own PNG or JPEG header (`drawingSize`, beside
  `safeDrawingUrl`), and the certificate fits it to its kind's box, as the
  canvas and the executed PDF (`fit: "contain"`) do — so it looks the same on
  both documents.

Guide: `guides/sealing.mdx`, *The certificate of completion*. The
playground's signing room keeps a record as a host would — sent on opening,
viewed per party, signed per signature, completed when the executed PDF is
made — and issues the certificate from that PDF's result and that record.

## Sources

- [DocuSign certificate contents, as summarised by an Oracle integration guide](https://docs.oracle.com/cd/E97085_01/TPMhelp/en/North_America/10311519.htm)
- [Adobe Acrobat Sign — Agreement history and audit report](https://helpx.adobe.com/sign/web/fedramp/user/agreement-history.html)
- [Adobe Acrobat Sign — Audit reports (admin)](https://experienceleague.adobe.com/en/docs/document-cloud-learn/sign-learning-hub/admin-set-up/getting-started-admin/audit-reports)
- [Dropbox Sign — Understanding audit trails](https://help.dropbox.com/security/dropbox-sign-audit-trail-overview)
- [Dropbox Sign — Security & compliance glossary](https://developers.hellosign.com/api/manual-reference-pages/glossary/security-compliance)
- [Documenso — Signing certificates](https://docs.documenso.com/docs/concepts/signing-certificates)
