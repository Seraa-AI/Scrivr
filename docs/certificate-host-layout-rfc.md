# RFC: The certificate in the host's own document

Status: built (2026-11-17). See *What shipped*.

Builds on [Certificate of completion](./completion-certificate-rfc.md).

## Problem

A certificate is a product's page. Seraa's reads as a summary first — the
document, its certificate ID, when it completed — then a card for each
signatory with their signature in it, the activity history, and the integrity
details and a verification code at the end, under its own header and footer.
DocuSign, Dropbox Sign and Adobe Sign each lay theirs out their own way.

Today a host can rename every label and place blocks before the title, after
the certificate, or as the record body. It cannot:

- **order it.** *Verified at issue* follows the title, before anything the
  host says about the document; integrity cannot come last.
- **style it.** Host content is titles, paragraphs, bold labelled lines and
  images. No muted text, eyebrow, rule, grid, table, link, colour or size.
- **put a signature with its signer.** Signatures print in *Verified at
  issue*, headed by role, apart from the signer's details.
- **give it a header or footer** — the certificate ID, page numbers.

All four come from one decision in the first RFC: the certificate is printed
in StarterKit, built from a handful of block kinds. That kept the exporter
from needing a second renderer. It did not need the certificate to be poorer
than the documents the host already prints.

## Decided

1. **The certificate is printed in the host's own editor setup** —
   `editorOptions`, the extensions, fonts and page the signers saw, as the
   executed record is. Whatever a host can put in a document it can put on its
   certificate: its own extensions for an eyebrow or a muted line, tables,
   colour, links, a header and footer. A host that adds an extension can use it
   there the day it adds it. Scrivr's own parts are built from headings,
   paragraphs, bold and images; a setup without them is refused
   (`unprintable-certificate`) rather than printed without what was checked.

2. **The host lays out the certificate as a document, with slots for
   Scrivr's parts.** `content` may return a `body`: document nodes in the
   host's schema, with three kinds of slot among them:

   | Slot | Scrivr fills it with |
   |---|---|
   | `{ slot: "verified" }` | *Verified at issue*: its title, note, both hashes, and every signature not placed elsewhere |
   | `{ slot: "record" }` | the record's title naming the issuer |
   | `{ slot: "signature", role }` | that role's signatures as the executed PDF prints them, each under its field kind's label |

   The host places anything around them. It places nothing in them: Scrivr
   builds what fills a slot after `content` has run, from facts the host only
   ever sees frozen.

3. **What was checked is always on the certificate.** A `body` without the
   `verified` slot, or with it twice, is refused (`verified-slot`); so is a
   `record` slot missing or repeated, since the issuer's name heads the host's
   word. A signature whose role has no slot prints in *Verified at issue*, so
   placing signatures can move them and never drop one. A role's slot placed
   twice is refused.

4. **Host nodes are checked against the schema.** A body that does not make a
   valid document in the host's setup is refused (`invalid-content`), with the
   reason the schema gave. Document attributes the host returns (`attrs`) set
   page-level state such as a header and footer, as for any document.

5. **The block form stays.** `before`, `record` and `after` keep working: a
   host that wants Scrivr's layout with its own intro changes nothing.

## API

```ts
const result = await exportCompletionCertificate(snapshot, values, {
  editorOptions, // the signers' setup — Seraa's extensions included
  record,
  labels: { verified: "Document integrity" },
  content: ({ verified, signingRecord }) => ({
    attrs: { headerFooter: seraaCertificateChrome(signingRecord.documentId) },
    body: [
      { type: "eyebrow", content: [{ type: "text", text: "Certificate of completion" }] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Document signing completed" }] },
      summaryTable(signingRecord),
      { slot: "record" },
      ...signingRecord.parties.flatMap(party => [signatoryCard(party), { slot: "signature", role: party.role }]),
      activityTable(signingRecord.events),
      { slot: "verified" },
      verificationCode(signingRecord.documentId),
    ],
  }),
});
```

## Refusals added

| Refusal | When |
|---|---|
| `unprintable-certificate { message }` | the setup cannot hold the titles, paragraphs, labelled lines and images Scrivr's parts are printed in |
| `verified-slot` | a `body` has no `verified` slot, or more than one |
| `record-slot` | a `body` has no `record` slot, or more than one |
| `duplicate-signature-slot { role }` | a role's signatures are placed twice |
| `invalid-content { message }` | the body is not a document the host's schema accepts |

## Invariants

- Everything in the first RFC's invariants holds: *Verified at issue* is laid
  out from checked facts before `content` runs; the host's record never
  appears in it; the signatures are the bytes the executed PDF embedded.
- Every checked signature is printed exactly once.
- A host cannot write inside a slot; it can only choose where the slot goes.
- No refusal case yields either PDF.

## Tests

- Seraa's reference certificate — eyebrow, summary table, signatory cards with
  their signatures, activity table, integrity last, header and footer — issued
  in a setup with a host extension, and checked page by page.
- Each refusal, one test each.
- A signature with no slot prints in *Verified at issue*; with a slot, only
  there.
- The block form prints as before.
- Host nodes that name a node the schema lacks are refused, not dropped.

## What shipped

- `exportCompletionCertificate` prints in `editorOptions` as given; the block
  form prints as before in any setup with StarterKit's vocabulary.
- `CertificateContent.body` and `.attrs`, with `CertificateSlot` and
  `CertificateNode` exported; `layOut` fills the slots, and the body is checked
  with `schema.nodeFromJSON(...).check()`.
- The reference test issues a Seraa-shaped certificate: a host `eyebrow`
  extension (core's `TextBlockStrategy`, block styles, a PDF handler), summary
  and activity tables, muted colour, signatures in signer cards, integrity
  last, a link, and a footer with the page number through `HeaderFooter`.
- Not in this change: core's pagination gives up the gap before a block when
  that lets its first line fit at the foot of a page (`landingAfter`). It is a
  layout rule for every document, not a certificate one.
