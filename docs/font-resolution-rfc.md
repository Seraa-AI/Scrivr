# RFC: Font Resolution

Status: draft (2026-09-09)

## Thesis

**A font family name is a request, not a resource.** Scrivr treats it as a
resource: the string `"Aptos"` is carried from DOCX import through layout to
every exporter, and each stage privately turns it into an actual face using its
own rules and its own inventory. Those inventories differ. Nobody records which
face they got, so nobody downstream can agree with them.

The consequence is precise: **layout measures one face and the PDF paints a
different one, at coordinates computed from the first.** Geometry and glyphs
come from different fonts. Every symptom below is that single sentence, seen
from a different lane.

This is not a rendering bug to patch in the exporter. `resolveFont` in
`packages/export-pdf/src/fonts.ts` is *correct* — given only a family name and
the base-14 fonts, Helvetica is the right answer. Canvas is correct too:
handing an unknown family to `ctx.font` and letting the browser substitute is
exactly what a browser is for. Both lanes are locally right and jointly wrong,
which is the signature of a missing shared value rather than a missing check.

## Evidence

A real MSA (Aptos, 135 blocks, 25,641 characters) imports with **zero
diagnostics** and renders correctly on canvas. Aptos is not installed. Measuring
its own sentences against the face the browser substitutes:

| text | substituted | Helvetica | delta |
|---|---|---|---|
| "This Master Services Agreement is entered into…" | 419.4 | 442.5 | **-5.2%** |
| "Confidential Information" | 143.2 | 147.9 | -3.1% |
| "IN WITNESS WHEREOF, the parties have executed…" | 391.1 | 424.8 | **-7.9%** |

Layout breaks lines at 419pt; the PDF draws the same string at 442pt. On a
468pt text column that is ~34pt past the right margin, compounding down every
justified line. The document is not corrupt and no error is raised — the PDF is
simply not the page the user approved.

## Symptoms, and why they are one bug

| # | Symptom | The missing decision |
|---|---|---|
| 1 | Canvas silently substitutes a face for an unavailable family | resolution happens inside `ctx.font` and is never observed |
| 2 | PDF metrics diverge from layout by 3–8% | PDF re-derives resolution instead of reading layout's |
| 3 | `WinAnsi cannot encode` aborted exports on Latin Extended text | a fallback chosen without regard to the text it must carry |
| 4 | A Unicode font supplied via `fontResolver` still produced `????` | text reduced before resolution was known |
| 5 | DOCX import reports 0 diagnostics for a document we cannot render faithfully | import has no notion of "requested but unavailable" |

**3 and 4 are fixed** (`@scrivr/export-pdf`, this branch): the WinAnsi allowlist
is now the exact repertoire pdf-lib's encoder accepts, and sanitizing runs after
font resolution so embedded fonts keep their glyphs. Both were the same species
of error — a decision about a font taken at the wrong time, by a stage that did
not have the facts. They are worth naming here because fixing them locally does
not stop 1, 2 and 5, and never could.

## Where the truth diverges today

```
DOCX <w:rFonts w:ascii="Aptos">
   │  FontFamily.ts:167  (import handler)
   ▼
fontFamily mark { family: "Aptos" }          ← a request, stored as if a resource
   │  StyleResolver.resolveFont → buildFont
   ▼
CSS font string  "14px Aptos"
   │
   ├──► TextMeasurer.ts:171   ctx.font = …  → browser picks a face, silently
   │                                          MEASURED GEOMETRY
   ├──► PageRenderer.ts:394   ctx.font = …  → same face. canvas is self-consistent
   │
   ├──► export-pdf fonts.ts   standardFamilyFor() → Helvetica
   │                                          PAINTED GLYPHS ✗ different face
   │
   └──► docx walker.ts:156    w:rFonts ascii="Aptos"
                                              faithful passthrough — Word resolves
```

Three consumers, three independent resolutions, one of which (the canvas's) is
the one all the geometry was derived from and is also the only one never written
down.

Note the DOCX lane is *right* to pass the name through: it hands the request to
another layout engine that will resolve it itself. That is the distinction the
model needs — some consumers forward the **request**, others must honour the
**resolution**.

## The invariant

> Whatever face the layout measured is the face every pixel-exact consumer must
> paint. If a consumer cannot obtain that face, the output is an approximation
> and must be declared as one.

Nothing in the codebase can state this today, because the measured face is not a
value. `TextMeasurer` knows it (it just measured with it) and immediately
discards it.

## Proposal

### 1. Resolution becomes a value

```ts
interface FontRequest {
  family: string;              // "Aptos" — what the document asked for
  weight: "normal" | "bold";
  style: "normal" | "italic";
  size: number;
}

interface FontResolution {
  request: FontRequest;
  /** The face actually used. Never a request — always something that exists. */
  resolved: { family: string; source: "requested" | "substituted" | "generic" };
  /** Set when the environment can hand over the bytes (embedding, hashing). */
  bytes?: () => Promise<ArrayBuffer | null>;
}
```

`source: "substituted"` is the fact the whole system is currently missing.

### 2. One resolver, owned by the editor

A `FontRegistry` resolves `FontRequest → FontResolution` and is injected the
same way `TextMeasurer` already is (`Editor` accepts a `TextMeasurerLike`; the
same DI seam takes the registry). Browser and server implementations differ in
how they *detect* availability, not in what they return.

Detection is the one genuinely environment-specific part:

- **Browser** — `document.fonts.check("14px Aptos")`, which also closes
  `todo_font_loading_detection`.
- **Server** — an explicit inventory supplied by the caller. `ServerEditor` has
  no system fonts and should not pretend otherwise.

### 3. Layout records what it measured

`LayoutSpan.font` stays a CSS string (it is what `ctx.font` wants), and gains
the resolution alongside it. This is the load-bearing change: geometry and the
face that produced it travel together, so a consumer can no longer accidentally
use one without the other.

### 4. Consumers read, they do not re-derive

- **Canvas** — unchanged behaviour, but the substitution is now observable.
- **PDF** — `resolveFont` stops guessing. Given `source: "substituted"` it knows
  the metrics are already wrong and says so; given `bytes()` it embeds the real
  face and the metrics are right. `standardFamilyFor` survives only as the
  last-resort mapping when no bytes exist.
- **DOCX** — keeps forwarding the request, deliberately. It should record the
  substitution as a diagnostic (symptom 5) without changing what it writes.

### 5. Substitution is a reportable outcome

Already shipped at the PDF seam and worth generalising: `PdfExportOptions.onFontSubstitution`
reports each unembeddable named font, `PdfExport` batches them and warns by
default, and the playground shows a header pill. That is the *shape* the general
mechanism should take — the registry becomes the single producer of these
events, and import, canvas and every exporter become consumers of one stream
instead of each inventing their own.

## Phasing

Each phase is independently landable and independently useful.

1. **Observe** — `FontRegistry` with browser + server detection; report
   substitutions at import and on first layout. No behaviour change; the
   invisible failure becomes visible. Closes symptoms 1 and 5.
2. **Carry** — thread `FontResolution` onto layout spans. Still no behaviour
   change; makes phase 3 possible.
3. **Honour** — PDF reads the resolution instead of re-deriving it. Closes
   symptom 2 for the embeddable case and makes the non-embeddable case explicit.
4. **Supply** *(optional, later)* — a default `fontResolver` that fetches common
   families so the embeddable case is the normal one.

Phase 1 alone would have turned the MSA from "wrong PDF, no signal" into "wrong
PDF, clearly announced", which is most of the user-visible value.

## Decisions to lock before building

These are open. Listing them rather than assuming them.

- **Does layout re-measure when a font loads late?** A webfont arriving after
  first layout changes every measurement. Invalidation exists
  (`TextMeasurer.invalidate()`); the policy does not.
- **Is `FontResolution` public API?** It appears on `LayoutSpan`, which
  extensions read. Once public it is subject to the 1.x compat policy.
- **Does substitution block export?** Proposal: never block, always report.
  A wrong-metrics PDF the user was warned about beats no PDF.
- **Per-span or per-run resolution?** Per-span is simplest and matches how
  spans already carry `font`; a document-level table would be smaller but adds
  an indirection to every read.
- **Does the canvas lane get `fontResolver` too?** It cannot embed, but it could
  `FontFace`-load bytes the app supplies, making canvas and PDF agree by
  construction rather than by reporting.

## Alternatives considered

- **Fix the PDF heuristic** — widen `standardFamilyFor` to know Aptos → sans and
  more. Cheap, and wrong: it makes the guess better without making it shared.
  The next font not in the table has the same bug.
- **Always require `fontResolver`** — correct output, but pushes a font pipeline
  onto every consumer for a problem most documents do not have, and does nothing
  for canvas.
- **Measure with pdf-lib metrics during layout** — makes PDF exact by making the
  screen wrong. Inverts the priority: the canvas is what the user approves.
- **Ship a default font bundle** — orthogonal, and defensible later (phase 4),
  but it narrows the failure rather than removing it; licensing is a real
  constraint.

## The stripping policy, and why it is not the fix

`@scrivr/docx` now offers `unavailableFonts: "strip"`, which drops a family the
environment cannot draw so the text inherits the document default. It works,
and for a reason worth stating: the default is `"Arial, sans-serif"`, which the
PDF lane resolves to Helvetica, and Arial and Helvetica share advance widths by
design. Both lanes land on the same metrics and the divergence disappears.

That is a real fix for the symptom and the wrong shape for the problem.
Stripping is resolution performed **once, eagerly, and destructively** — it
achieves agreement between lanes by deleting the thing they disagreed about.
The author's font is gone, a round-trip writes the fallback, and a reader who
does have Aptos never gets it back. Word does not do this, and neither should
our default.

The proposal below is the same operation performed continuously and
non-destructively: resolve, record, and let every lane read the same answer.
Once that exists, stripping collapses into a one-line policy on top of it
rather than a separate mechanism — which is the test of whether the seam is in
the right place.

## What this does not solve

- **Font licensing and embedding rights.** Having bytes is not permission to
  embed them. Out of scope; the registry should carry whatever the supplier
  says and let the caller decide.
- **Shaping.** pdf-lib does no complex shaping, so scripts needing ligature
  substitution or bidi will not render correctly even with the right face. This
  RFC gets the right *face*, not the right *shaping*.
- **The MSA's fallback quality.** With no Aptos bytes anywhere, the PDF is still
  an approximation. The gain is that it is a declared one.
