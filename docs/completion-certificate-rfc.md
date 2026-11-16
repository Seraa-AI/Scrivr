# RFC: Certificate of completion

Status: built on PR #260 (2026-11-16) — see [Decided](#decided) and [What shipped](#what-shipped).
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
| The executed PDF beside it, and its `artifactHash` | Scrivr | **prints** it in the same call |
| Each required field answered; each signature as that PDF prints it | Scrivr | **checks**, from that printing |
| When each signature was given (`signedAt`) | host | prints its own stamp, checked for zone and order |
| Party names, emails, authentication, IP, user agent | host | prints its word, absent or blank left out |
| Events (sent, viewed, consented, signed, declined, completed, its own) | host | prints its word in time order and UTC; checked for zone and order |
| Document id, title, issuer | host | prints its word |

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
   *Verified at issue*: the two hashes and the signatures as the executed
   PDF prints them. Everything the host supplies — the parties, its events,
   and when each signature was given — sits under *Signing record — as
   recorded by {issuer}*. Scrivr never prints a host fact as checked.

2. **Issued only for a complete signing.** It is a certificate of
   *completion*: issuing refuses while a required field is unanswered, as
   `exportExecutedPdf` does. No interim report.

3. **Issued with the executed PDF, from one printing.** One call,
   `exportCompletionCertificate(snapshot, values, options)`, prints the
   executed record and then its certificate from the same editor, fields,
   kinds and printed values — so a certificate can only describe the
   document it was issued beside, and a mismatched pair cannot be built.
   The certificate is its own PDF that names the executed one by its
   `artifactHash`; the executed record stays verifiable alone. A host that
   wants one file, as Adobe and Documenso deliver, bundles the two with
   `bundleCertificate` under a `bundleHash` of their own.

4. **A Scrivr document, printed by the same exporter.** The certificate is
   built as an ordinary document — headings, labelled lines, the drawn
   signatures as images, nothing beyond StarterKit — and printed with the
   executed record's `editorOptions`, so the two share fonts and page setup
   and need no second renderer. Its JSON is returned too, to show in a
   viewer.

5. **A signature's time is the host's.** With the default `formatSignedDate`
   the executed PDF prints no signature's time — only the day a date-signed
   field derives from its party's latest signature — so `signedAt` is the
   host's stamp on the value. It is printed in the record,
   beside its party, as the signer gave it and in UTC, and is checked only
   for its shape and its order against the host's events. A time that is
   not a full timestamp with a zone is refused, a bare day included: an
   audit line whose instant is ambiguous, or invented, is worse than none.

6. **The signatures come from the printing.** A drawing the executed PDF
   could not embed is no value there and no signature here; a drawing is
   shown in its own proportions, fitted to its kind's box from the size its
   embedding read, as the executed PDF fits it.

7. **Personal data is what the host passes, nothing more.** IP, user agent
   and authentication method are optional per party, as Adobe makes IP
   collection opt-in. Scrivr reads no request, header or clock.

8. **Not a digital signature.** Scrivr returns bytes and their hash. Sealing a
   PDF with an X.509 certificate (PAdES), as Documenso does, needs the host's
   key, which never enters Scrivr; the host signs the bytes it is given.

9. **Labels are the host's language.** Every fixed heading and label comes
   from one table with English defaults a host overrides; a signature is
   headed by its field kind's own label, a party by its name.

10. **The host's own content, everywhere but what was checked.** `content`
    hands a host the record body Scrivr would print, the verified facts and
    its record, and takes blocks `before` the certificate (a logo, an
    intro), `after` it (a disclosure), or a `record` body of its own.
    *Verified at issue*, and the record's title naming its issuer, stay
    Scrivr's: a host can place anything around what was checked, and nothing
    in it. The checks run on the record data whatever is printed.

## API

```ts
import { bundleCertificate, exportCompletionCertificate } from "@scrivr/export-pdf";

const result = await exportCompletionCertificate(snapshot, values, {
  editorOptions: { extensions: [StarterKit, Field], fonts }, // as the signers saw it
  record: {
    issuer: "Acme Sign",
    documentId: "AGR-2026-0042",
    title: "Master Services Agreement",
    parties: [
      { role: "client", name: "Ada Lovelace", email: "ada@example.com", authentication: "Email code", ip: "203.0.113.7" },
      { role: "legal-cc", name: "Legal team" },             // a copy sent: no fields of its own
    ],
    events: [
      { at: "2026-11-15T09:12:03Z", kind: "sent", party: "client" },
      { at: "2026-11-15T09:30:00Z", kind: "custom", label: "Identity verified", party: "client" },
      { at: "2026-11-15T12:44:10+03:00", kind: "signed", party: "client" }, // 09:44:10 UTC
      { at: "2026-11-15T09:44:12Z", kind: "completed" },
    ],
  },
  content: ({ record }) => ({ after: [{ title: "Disclosure", level: 3 }, { paragraph: disclosure }] }),
  labels,                                                   // optional overrides of the English defaults
});
// { ok: true, executed: { pdf, artifactHash }, certificate: { pdf, certificateHash, verified, content } }
// | { ok: false, refusal }

// One file, when the host wants it
const bundled = await bundleCertificate(result.executed.pdf, result.certificate.pdf);
// { pdf, bundleHash }
```

**Events** are one of `sent`, `viewed`, `consented`, `signed`, `declined`,
`completed`, labelled through the table, or `{ kind: "custom", label }`, a
host's own step, placed by its time. Order is checked where it means
something: a party comes to the document — its first `sent`, `viewed` or
`consented` — before its first signing, whether that signing is a printed
signature or the host's `signed` event; and nothing is signed after
`completed`. Views after signing, or after completion, are what signing
tools record, and pass. `declined` is labelled, not checked.

`VerifiedFacts` is the checked section as data — `contentHash`,
`artifactHash`, and each signature by `fieldId`, `role` and `kind` — so a
host stores exactly what the certificate claims beside it.

### Refusals

A result, not an exception, as `createSnapshot` and `exportExecutedPdf` do:
each is an answer the host shows someone. The executed PDF's own refusals
come first.

| `reason` | When |
|---|---|
| `snapshot-altered` | `verifySnapshot(content, contentHash)` fails |
| `unanswered-fields { missing }` | a required field is unanswered, or holds a drawing the PDF cannot embed |
| `unknown-field-kind { kind }` | a field's kind is not in the editor setup — a signature could not be told from text |
| `unnamed-issuer` | the record names no issuer, so its facts would sit under nobody's name |
| `undated-signature { fieldId }` | a printed signature carries no `signedAt` |
| `unzoned-time { at }` | an event time or a `signedAt` is not `YYYY-MM-DDThh:mm[:ss[.fff]]` with `Z` or `±hh:mm` |
| `unknown-event { event }` | an event of no known kind, or a `custom` step with no label |
| `duplicate-party { role }` | two parties play one role |
| `missing-party { role }` | a role that answered or must answer a field has no party in the record |
| `unknown-party { role }` | an event's `party` is a role no party in the record plays |
| `signed-after-completed { fieldId }` | a signature's `signedAt` is later than the `completed` event |
| `events-out-of-order { event }` | a party first comes to the document after it signed, or a host `signed` event follows `completed` |

## Ownership

- **The chain's facts** come from one printing: `printExecuted` verifies the
  snapshot, opens it with the signers' extensions, holds the values it can
  print, checks completeness against `valuesOnRecordOf`, prints, and hands
  the certificate what it read — fields, kinds, the values on record, each
  drawing's embedded size, each field's own box.
- **The grammar of `signedAt`** is core's: `readSigningMoment`, beside
  `parseSignedAt` and built on the same one reader, gives the instant, the
  day, and the clock and zone together when a time was written.
- **The record** is the host's, passed in, never stored.
- **The certificate** — its checks and the blocks it is laid out in —
  lives in `@scrivr/export-pdf` beside `exportExecutedPdf`, and is reachable
  only through `exportCompletionCertificate`. The blocks become a document
  through core's `documentFromBlocks`, so the exporter names no node.

## What changes, where

| Place | Change |
|---|---|
| `export-pdf/src/certificate.ts` (new) | `exportCompletionCertificate`, `bundleCertificate`, the record types, labels, checks and document |
| `export-pdf/src/executed.ts` | `exportExecutedPdf` prints through `printExecuted`, which also returns what it read; each drawing's embedded size |
| `export-pdf/src/contain.ts` (new) | `containedSize`, the one contain-fit both PDFs use |
| `export-pdf/src/pdf.ts` (new) | `exportToPdf` and `buildPdf`, moved out of the barrel so the modules that print import them without a cycle |
| `core/src/sealing/snapshot.ts` | `snapshotDocument`, the snapshot's document object, shared by every reader |
| `core/src/model/documentFromBlocks.ts` (new) | `documentFromBlocks`: a plain document from titles, paragraphs, labelled lines and images — core owns StarterKit's vocabulary, so the exporter names no node |
| `core/src/extensions/built-in/fieldKinds.ts` | `readSigningMoment`, `SigningMoment` |
| `plugins/src/sealed-viewer/FieldCompletion.ts` | the signing walkthrough: `fieldsBeforeSigning`, `waitingLabel`, a held-back signature opening the first field owed |
| `docs/guides/certificate.mdx` (new) | the certificate's own guide; `sealing.mdx` points to it, `fields.mdx` describes the walkthrough |
| playground *Signing* demo | the executed PDF and its certificate from one click |

## Invariants

- *Verified at issue* holds only what was checked in that call, laid out
  before the host's `content` runs; the host's record never appears there.
  Its title and note are labels the host may translate.
- The certificate's `artifactHash` is the hash of the executed PDF issued
  with it.
- The signatures it shows are the ones that PDF prints, fitted to the same
  field boxes.
- With the default `formatSignedDate`, a party's latest signature's
  recorded day is the day its date-signed field prints.
- No refusal case yields either PDF.

## Tests

- The executed PDF and the certificate from one call; the certificate's
  hashes equal `contentHash` and the executed PDF's `artifactHash`.
- A drawing the executed PDF could not embed is no signature on the
  certificate; a 3:1 drawing is 132 × 44 in a 180 × 44 box.
- A signature's time is in the record, not *Verified at issue*; its recorded
  day and the executed PDF's date-signed field agree across midnight UTC.
- Each refusal, one test each, including an unknown field kind.
- Blank host details print nothing, and the certificate opens.
- Re-views and copies sent pass; labels override, a blank one keeps its
  default; the defaults are frozen.
- The host's `content`: blocks before and after, a record body of its own,
  the facts handed over frozen — a write to them changes nothing printed or
  kept; a refusal still fires whatever it prints.
- A drawing with no area answers nothing; a signature fits its field's own
  box; the guide's own example record is issued.
- The walkthrough: a held-back signature opens the first field owed (a
  checkbox only focused), and its tag counts what pressing it waits on.

## Out of scope

- Signing the certificate or the executed PDF with an X.509 key (PAdES).
- Storing, emailing or looking up certificates by id.
- Events Scrivr could observe itself (`ReadingProgress`'s pages in view) —
  the host already receives them and decides what its record keeps.
- An audit log of every event in a separate PDF (Documenso's second file).

## Decided

1. **Separate, with a bundle helper.** The certificate is its own PDF;
   `bundleCertificate` makes one file for hosts that want it, under its own
   `bundleHash`, the certificate inside still naming the executed record's
   `artifactHash`.
2. **Completion only.** No interim certificate.
3. **The host's `documentId` only, for now.** Printed as an opaque string.
   A document id of Scrivr's own, carried in the document, would be printed
   beside it once there is one.
4. **A closed set of events, plus custom.** The six kinds are labelled and
   translated, and those order means something for are checked (see *API*);
   `{ kind: "custom", label }` carries a host's own step, placed by its time.
5. **One call issues both PDFs (2026-11-16).** A first build took the
   executed PDF and its values as two inputs, and nothing proved they
   belonged together; the certificate is now issued with the executed PDF,
   from its printing.
6. **A signature's time is in the record (2026-11-16).** It is the host's
   stamp — with the default date format the executed PDF prints only its
   day — so it moved out of *Verified at issue*.
7. **A host overrides everything but what was verified (2026-11-16).** See
   decision 10. Full control was weighed and declined: nothing would stop a
   host printing "verified" over what was not checked.

## What shipped

Built as designed above, which now records the build (PR #260). Guide:
`guides/certificate.mdx`, its own page; *Sealing a revision* points to it and
*Fields* describes the signing walkthrough. The playground's signing room
keeps a record as a host would — sent on opening, viewed per party, each
signing taken from its value, completed as the executed PDF is made — adds
a disclosure through `content`, and issues the executed PDF and its
certificate with one click.

## Sources

- [DocuSign certificate contents, as summarised by an Oracle integration guide](https://docs.oracle.com/cd/E97085_01/TPMhelp/en/North_America/10311519.htm)
- [Adobe Acrobat Sign — Agreement history and audit report](https://helpx.adobe.com/sign/web/fedramp/user/agreement-history.html)
- [Adobe Acrobat Sign — Audit reports (admin)](https://experienceleague.adobe.com/en/docs/document-cloud-learn/sign-learning-hub/admin-set-up/getting-started-admin/audit-reports)
- [Dropbox Sign — Understanding audit trails](https://help.dropbox.com/security/dropbox-sign-audit-trail-overview)
- [Dropbox Sign — Security & compliance glossary](https://developers.hellosign.com/api/manual-reference-pages/glossary/security-compliance)
- [Documenso — Signing certificates](https://docs.documenso.com/docs/concepts/signing-certificates)
