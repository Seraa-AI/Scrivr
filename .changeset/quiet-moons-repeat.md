---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
---

Four ways a document could come out of an export as something other than itself.

**A font used only in a header was never embedded.** The exporter collected
faces from body blocks and table cells, so a face appearing only in a header or
footer fell back to a standard PDF font — WinAnsi only, so anything outside
that range printed as `?` — and because it was never requested, no shortfall
was reported either. The image lane already walked chrome; the font lane did
not, and both read one primitive now.

**An edit during export could change what was exported.** Preparing fonts is
asynchronous and the editor kept accepting edits. The font answers came from
the layout captured before the await; the re-typeset path read the document
back after it. A late edit naming a new face threw `Font request changed during
PDF layout`; a text-only edit quietly exported a revision nobody asked for. The
document is captured with its layout now and the export works from that
snapshot.

**A DOCX run could not refuse its style's formatting.** `<w:b w:val="false"/>`
is Word saying "not bold here", and the importer dropped it — which read as
silence once styles could supply bold, so the style won and the text imported
bold. Italic and underline took the same path. The cancellation is carried
through parsing and resolved where editor marks are made.

**Image fetching is now bounded.** A document names its own image URLs, so
exporting one made this process request them — with no destination check, no
timeout, no size cap, and redirects followed blindly. On a server that is an
SSRF: an untrusted document could reach loopback, a private range, or a cloud
metadata endpoint.

The built-in resolver now refuses anything that is not a public http(s)
address, re-checks on every redirect, and caps the wait, the size and the
number of hops. **This is a behaviour change**: if your images live on an
internal host, pass `resolveImage` to keep fetching them —

```ts
editor.commands.exportPdf({ resolveImage: async (src) => myFetcher(src) });
```

`resolveImage` replaces the policy entirely, so it is also the way to be
stricter than the default when the documents are untrusted. `onImageRefused`
reports what was turned away, since a refusal otherwise looks exactly like a
broken link.
