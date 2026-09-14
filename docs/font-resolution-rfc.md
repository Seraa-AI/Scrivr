# RFC: Font Resolution

Status: draft (2026-09-09)

## Thesis

**A font family name is a request, not a resource.** Scrivr treats it as a
resource: the string `"Aptos"` travels from DOCX import through layout to every
exporter, and each stage privately turns it into an actual face using its own
rules and its own inventory. Those inventories differ. No stage records which
face it got, so no stage downstream can agree with it.

The consequence is precise: **layout measures one face and the PDF paints a
different one, at coordinates computed from the first.**

Font is not geometry, ownership, a surface, or an exclusion. It is an **input
to measurement**, and measurement produces geometry — so it sits *upstream of
layout*. Every attempt to fix this downstream of layout has been a patch, and
felt like one.

## Two problems, routinely conflated

| | Problem | Fixed by |
|---|---|---|
| **1** | **Resolution divergence** — lanes disagree about *which* face | sharing the decision |
| **2** | **Inventory divergence** — lanes physically hold *different fonts* | sharing the bytes |

Sharing a resolution decision does nothing for (2). pdf-lib's standard fonts
are Helvetica, Times, Courier, Symbol and ZapfDingbats — **there is no Arial**.
A document rendering in Arial on canvas can only ever be painted in Helvetica
in PDF. The two are metrically compatible by design, which is why this has gone
unnoticed: lines break in the same places while the letterforms differ.

That yields a ladder, and only the top rung is harmonization:

| Tier | Guarantee | Requires |
|---|---|---|
| **Metric** | lines break identically; letterforms differ | nothing — what we have by accident |
| **Decision** | every lane agrees which face it *should* use | a shared resolver |
| **Bytes** | output is genuinely identical | the app supplies font files |

**You cannot harmonize without owning the fonts.** The system's job is to make
the bytes tier the supported path, and to make the lesser tiers *explicitly
labelled* rather than silently assumed.

Which sets the boundary for everything below: **Scrivr ships the engine, never
the fonts.** It owns resolution, inventory, loading, invalidation and the
guarantee that both lanes consume one resource. It does not own a typeface, and
a default it picked would be a typeface every consumer carries and cannot
remove. An application brings the fonts; Scrivr is what stops them being
resolved twice, differently.

## Evidence

A real MSA (Aptos, 135 blocks, 25,641 characters) imports with **zero
diagnostics** and renders correctly on canvas. Aptos is not installed.
Measuring its own sentences against the face the browser substitutes:

| text | substituted | Helvetica | delta |
|---|---|---|---|
| "This Master Services Agreement is entered into…" | 419.4 | 442.5 | **-5.2%** |
| "Confidential Information" | 143.2 | 147.9 | -3.1% |
| "IN WITNESS WHEREOF, the parties have executed…" | 391.1 | 424.8 | **-7.9%** |

In the exported PDF this does not read as narrow text. Each span is drawn at
the `x` layout computed in the substitute, then painted in a wider face, so
every span overruns the next and paints over the gap between them:

```
        "Affiliate" means an entity that directly or indirectly controls
   →    "Affiliate"means an entity that directly or indirectly controlledby
```

Every collision lands on a **run boundary**, because that is where one span
ends and the next begins. The canvas cannot produce this artifact:
`TextMeasurer.ts:171` and `PageRenderer.ts:394` assign the identical font
string, so measuring and painting always agree there. Only a
measure-in-A/paint-in-B pipeline does.

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
   ├──► PageRenderer.ts:394   ctx.font = …  → same face; canvas is self-consistent
   │
   ├──► export-pdf fonts.ts   standardFamilyFor() → Helvetica
   │                                          PAINTED GLYPHS ✗ different face
   │
   └──► docx walker.ts:159    w:rFonts ascii="Aptos"
                                              faithful passthrough — Word resolves
```

Resolution happens in three places. The one that determined all our geometry —
the browser — is the only one that never writes it down.

| Stage | Owns | |
|---|---|---|
| Document (`fontFamily` mark) | the **request**, durable intent | ✅ |
| Browser (`ctx.font =`) | the **resolution** | ❌ implicit, unobservable, discarded |
| Layout | **geometry** derived from a resolved face | ✅ but records only the request |
| export-pdf | — | ❌ re-derives resolution independently |
| docx export | forwards the request | ✅ deliberately |

This is the shape of the anchor/yOffset arc on a new axis: there, `anchor` is
ownership and `yOffset` is placement; here, the **mark is the request** and
**`FontResolution` is derived**.

## The invariant

> Every glyph run has a **request**.
> Every measured glyph run has a **resolution**.
> Every geometry-preserving renderer consumes that resolution.
> Where Scrivr owns the resource, every such renderer consumes the same **bytes**.
> If the requested resource cannot be shared by those renderers, resolution
> selects a shareable fallback **before measurement**, without altering the
> durable request.

The last clause is what makes degrading legitimate rather than a workaround: it
happens at resolution time, ahead of measurement, and the document is never
rewritten. A lane that cannot obtain the measured face does not warn and paint
something else — it resolves again, to a face it can obtain, and measures
against that.

And the rule that makes the design decidable:

> Consumers that **re-layout downstream** consume the **request**.
> Consumers that **reproduce our geometry** consume the **resolution**.

DOCX hands the document to Word, which resolves fonts itself — so forwarding
`"Aptos"` untouched is correct. PDF reproduces our geometry — so re-deriving is
wrong. Without this distinction, "forward the name everywhere" and "resolve
everywhere" both look defensible; with it, exactly one lane is broken.

## Proposal

### 1. Resolution becomes a value

Weight and style are part of a font's identity, not decoration on top of a
family — `Inter 400` and `Inter 700` are different resources. Keying on family
alone solves family resolution and reproduces the same bug for bold and italic
a release later.

```ts
interface FontKey {
  family: string;
  weight: number;
  style: "normal" | "italic";
  stretch?: string;
}

interface FontRequest extends FontKey {
  size: number;
}

interface FontResolution {
  request: FontRequest;
  resolved: {
    family: string;
    source: "requested" | "substituted" | "default" | "generic";
    /**
     * False when the face exists only because this environment happens to
     * have it. A lane that must reproduce the geometry elsewhere cannot use
     * such a resolution and has to resolve again.
     */
    portable: boolean;
  };
  resource?: FontResource;
}
```

`source` and `portable` are the two facts the system is missing entirely today.

Spans do not carry this object. A document has thousands of runs and a handful
of distinct resolutions, so layout interns them and a span carries the id:

```ts
interface LayoutSpan {
  font: string;
  resolution: FontResolutionId;
}

interface DocumentLayout {
  fontResolutions: ReadonlyMap<FontResolutionId, FontResolution>;
}
```

That keeps the storage representation out of the 1.x public surface — an
extension reading `LayoutSpan` gets an opaque id, not a contract — and gives
the PDF exporter a natural cache key for embedding. If extensions later need to
inspect a resolution, that becomes a deliberate read-only accessor rather than
a shape we published by accident.

### 2. A `FontProvider`, owned by the editor

Injected alongside `measurer` — `Editor.ts:444` already establishes exactly
this seam for `TextMeasurerLike`, including the server/client split.

It owns three things and nothing else:

- **inventory** — which faces exist here, and their bytes where available
- **resolution** — `(request, inventory) → FontResolution`
- **invalidation** — the signal that the inventory changed

Detection is the environment-specific part. In the browser, availability is
decided by **measurement** — probe the family against a generic and see whether
asking for it changed anything. `document.fonts.check()` is not usable: it
answers "is this face loaded" and returns true for families the browser will
substitute. On the server there is no font system to ask, and an inventory
supplied by the caller is the only honest answer.

### 3. Layout records what it measured

`LayoutSpan.font` stays a CSS string — it is what `ctx.font` wants — and gains
the resolution beside it. This is the load-bearing change: geometry and the
face that produced it travel together, so a consumer cannot use one without the
other. Sixteen sites read `span.font` today; all are read-only.

### 4. Consumers read; they do not re-derive

- **Canvas** — unchanged behaviour, but the substitution becomes observable.
- **PDF** — stops guessing. Given `bytes()` it embeds the measured face and the
  geometry is finally right; given `source: "substituted"` it knows the metrics
  are already wrong and can say so. `standardFamilyFor` survives only as the
  last-resort mapping when no bytes exist.
- **DOCX** — keeps forwarding the request, deliberately, and records the
  substitution as a diagnostic without changing what it writes.

### 5. Degrading is a provider policy, not a document edit

When the requested face is unavailable, the provider resolves to a fallback
every lane can obtain, and *records* that. The mark still says `"Aptos"`, so a
round-trip back to DOCX stays lossless; every lane measures and paints the
fallback, so the output is consistent.

This is deliberately **not** a rewrite of the document at import. An earlier
attempt did exactly that — dropping unavailable families so the text inherited
the document default. It worked, and for an instructive reason: the default is
`"Arial, sans-serif"`, which the PDF lane maps to Helvetica, and Arial and
Helvetica share advance widths. But it bought agreement by deleting the thing
the lanes disagreed about. The author's font was gone, a round-trip wrote the
fallback, and it violated *user commits are the only durable mutations*. The
policy above achieves the same consistency and keeps the request.

If a user genuinely wants their document normalized, that is an explicit
command producing an explicit transaction — not a side effect of opening a file.

### 6. The default font is a request too

Text with no `fontFamily` mark is not "unstyled" — it carries the document's
default, and that default is a `FontRequest` like any other. Today it is
`"Arial, sans-serif"`, handed to the host to resolve however it likes, which is
the same implicit resolution this RFC exists to remove. One machine answers it
differently from another, and Scrivr holds no bytes for the answer, so the PDF
lane can never be exact about it.

So the provider owns the default:

```ts
interface FontProvider {
  defaultRequest(): FontRequest;
  resolve(request: FontRequest): FontResolution;
}
```

and `defaultRequest()` names a resource the **application** supplies. Scrivr
does not bundle a typeface: a font baked into a library is a decision consumers
cannot undo, and it would put a licence and a few hundred kilobytes per weight
into a package whose point is being embeddable.

Shipping one permissively licensed fallback was considered and declined: it
makes `new Editor()` work out of the box, and it makes every consumer carry a
typeface they did not choose and cannot remove, for a default that should be
theirs. That makes this a breaking change, and it should be documented as one
rather than softened. An editor constructed with no font resource has no honest default —
it must say so loudly rather than quietly asking the host, which is the failure
this RFC is about. The demo app carries a working configuration to start from,
and the migration note should point at it rather than describe it.
The browser receives those bytes through `FontFace`; the PDF exporter embeds the
same bytes. A generic family is a last-resort *rendering* policy, not a default.

That gives a hierarchy where only the last rung is degraded:

| | Request | Outcome |
|---|---|---|
| 1 | requested, resource supplied | exact |
| 2 | requested, app-known resource | exact once loaded |
| 3 | requested, resource unavailable | Scrivr-owned fallback, reported |
| 4 | no resource at all | host generic — degraded, diagnostic |

An imported document keeps both facts: `request.family === "Aptos"` while
`resolution.family === "Scrivr Default"`. Nothing is rewritten, and the
divergence is legible rather than inferred from a measurement.

### 7. Callers supply fonts, as resources rather than names

An API that takes a family name and hopes the host has it recreates the
ambiguity this RFC removes. What a caller supplies is a **resource**, or
something that can produce one:

```ts
interface FontResource extends FontKey {
  id: string;
  bytes(): Promise<ArrayBuffer>;
  format?: "woff2" | "woff" | "ttf" | "otf";
  /** Holding the bytes is not permission to embed them. */
  embedding?: { allowed: boolean; source?: "font-metadata" | "caller" };
}
```

A URL is not a second architecture — it is a convenient way to obtain the same
resource, normalized to bytes on first use and cached. Bytes and URL both yield
a portable resource: the browser gets it through `FontFace`, the PDF exporter
embeds the same bytes, and both lanes measure the same metal.

A locally installed font is a different thing wearing the same word. The
browser can render Arial without Scrivr owning Arial, and there is no portable
way to take those bytes to a PDF. So it registers as a candidate, not a
resource, and resolves with `portable: false` — which is exactly the signal
export needs to resolve again before laying itself out.

```ts
import { fonts, interRegular } from "@acme/fonts";

const editor = new Editor({
  fonts: new DefaultFontProvider({
    default: interRegular,
    resources: fonts,
  }),
});
```

`resources` is a catalogue, not a download. A package hands over descriptors;
Scrivr fetches the three faces the open document actually uses.

The common case should not require a font pipeline, so `DefaultFontProvider`
handles inventory, loading and resolution. The interface behind it is what an
organisation with its own typography implements:

```ts
interface FontResolutionConstraints {
  /** The result must be usable outside this environment. */
  portable?: boolean;
  /** The result's licence must permit embedding it in an export. */
  embeddable?: boolean;
}

interface FontProvider {
  defaultRequest(): FontRequest;
  resolve(
    request: FontRequest,
    constraints?: FontResolutionConstraints,
  ): Promise<FontResolution>;
  subscribe?(listener: (change: FontProviderChange) => void): () => void;
}
```

A resolution carries its resource, so there is one way to reach it and no
second call that could disagree. The consumer's requirement is an argument
rather than a rule it is expected to know: canvas asks `resolve(request)`, an
export asks `resolve(request, { portable: true, embeddable: true })`, and
"resolve again under different implicit rules" stops being something a lane has
to remember.

**Registration is eager; acquiring bytes is not.** Registering adds a
descriptor to the inventory and fetches nothing — a font package can hand over
five hundred faces for the price of five hundred objects. The first resolution
that selects one calls `bytes()`, registers the result through `FontFace`, and
caches it. Eager loading is an option, not the default.

That distinction matters because a resource that is registered but unloaded is
already *known to exist*; what changes when it loads is not the inventory but
the resource's state. Modelling that separately is what lets invalidation be
narrow:

```ts
type FontResourceState = "registered" | "loading" | "loaded" | "failed";

interface FontProviderChange {
  key: FontKey;
  reason: "resource-added" | "resource-loaded" | "resource-failed" | "resource-removed";
}
```

| reason | what it can change |
|---|---|
| `resource-added` | a request may now resolve differently |
| `resource-loaded` | a request resolved by substitution may now resolve exactly |
| `resource-failed` | an expected resolution needs a fallback |
| `resource-removed` | an exact resolution may no longer hold |

Calling all four "the inventory changed" would make §8 re-measure for things
that cannot have moved.

**Registering is not requesting.** A document saying `fontFamily: "Aptos"`
creates a request and changes no inventory; `fonts.register(...)` changes the
inventory and names no document. The two words name the two halves of the
thesis, and the API should never blur them:

```text
DOCUMENT                    ENVIRONMENT
"Aptos"                     Aptos bytes
   │                             │
FontRequest                FontResource
   └──────────────┬──────────────┘
                  ▼
             FontProvider
                  ▼
            FontResolution
```

This supersedes `PdfExportOptions.fontResolver`, which asks a per-export
callback for bytes by family name and tells the canvas nothing — the shape that
lets PDF embed a face canvas never measured.

### 8. Invalidation

| | |
|---|---|
| **Input** | the inventory changes — a webfont finishes loading |
| **Smallest unit** | blocks whose spans name that family, not the document |
| **Trigger** | `FontFace` load → provider → `TextMeasurer.invalidate(font)` (exists, `TextMeasurer.ts:266`) |
| **Stays valid** | every block using an unaffected family |

Closes `todo_font_loading_detection`, and wants `todo_typed_layout_invalidation`
as its partner — "the font arrived" is precisely the typed reason that today
would flip a single `_dirty` boolean and re-lay the document.

### 9. What must never know about what

- `LineBreaker` never learns about availability; it consumes measurements.
- PDF never re-derives resolution; it reads it.
- DOCX never reads resolution; it forwards the request.
- The provider is per-editor, not per-surface: an inventory is a property of
  the environment, and header, footer and body legitimately share it.

## Phases

1. **Own it** — `FontProvider` on `Editor`; inventory, resolution,
   invalidation, and the default as an app-supplied resource. Resolution runs
   as a pass over the document's distinct requests *before* layout, so
   measurement never asks a question the provider has not answered. Reads
   `fontTable.xml` on import, since that is inventory. Substitutions are
   reported at import and at first layout.

   The editor now measures against the installed face and reflows when its
   provider changes the answer. The break and the machinery ship together on purpose:
   requiring a default before anything consumes one is a migration that buys
   nothing, and shipping the provider while the default still asks the host
   leaves the hole this document is about. One version, one migration note, the
   demo app as the configuration to copy.

2. **Record it** — layout interns its resolutions and a span carries the id.
   Still no behaviour change; it is what makes phase 3 expressible.

3. **Honour it** — the PDF lane resolves with `{ portable, embeddable }` and
   embeds the resource it was given, instead of re-deriving a family name. This
   is where an exported document stops lying about what it was measured in.

There is no phase that ships fonts. A resolver that fetched common families
would make the bytes tier the normal case by making Scrivr own typefaces, which
is the boundary above. The application brings them; what the phases build is
the guarantee that both lanes then consume the same ones.

## What shipped

Updated as each phase lands. Where the code and the proposal above disagree,
this section says so rather than the proposal being quietly rewritten to match.

### Phase 1 — in progress

- `packages/core/src/fonts/` — `FontKey`, `FontRequest`, `FontResource`,
  `FontResolution`, `FontResolutionConstraints`, `FontProviderChange`,
  `FontProvider`, and `DefaultFontProvider`.

**Deviation: `resolve` is synchronous.** The proposal has
`resolve(request, constraints): Promise<FontResolution>`. It cannot be — layout
is reached through `get layout()`, a synchronous property getter, so nothing on
the measurement path can await. Resolution is therefore two calls:

```ts
prepare(requests, constraints?): Promise<void>   // ahead of measurement, may fetch
resolve(request, constraints?): FontResolution   // what is known now, never blocks
```

`prepare` is the pre-layout pass. `resolve` always answers: a request `prepare`
never saw resolves to the default and reports `source: "default"`, rather than
the caller inferring it from the geometry afterwards. This is a closer fit to
"the work happens before the layout path" than the async signature was, since
the async work is now unambiguously outside that path rather than notionally
ahead of it.

### Phase 2 — shipped

Layout resolves at `resolveFont`'s two call sites in `BlockLayout`, measures
the resolved family, and records which answer it used. `DocumentLayout` carries
the interned table; a span carries the id. Empty and absent respectively when
the editor has no provider, so an application that supplies none is unaffected.

**"Still no behaviour change" did not hold, as expected.** The proposal says phase 2 interns
resolutions and changes nothing. But a span records the face it was *measured*
in, and measurement uses the CSS string handed to `ctx.font` — so attaching a
resolution while still measuring the requested family records an answer layout
did not honour. That is the lie this document exists to remove, one layer in.

For the record to be true, layout has to measure the *resolved* family. Which
means canvas stops silently substituting, and an editor with a provider renders
differently — correctly, and only if it has one. An editor with no provider
resolves nothing and is unaffected, so the change is opt-in rather than
breaking.

**The threading was the real cost, and it was paid rather than added to.**
`buildBlockFlow` took nine positional parameters, `resolveAnchoredObjects` and
`reflowFlowsAgainstExclusions` seven each — and five were the same threaded
dependencies in all three. A resolver would have been the tenth. They take a
`MeasureContext` now, so this dependency cost a field rather than a parameter
in three signatures, and the next one is free.

**A family sometimes has to be quoted.** Substituting a resolved family into a
CSS shorthand produces a string handed to `ctx.font`, and an invalid shorthand
is *ignored* rather than rejected — leaving whatever the previous span set. A
name that is not a sequence of CSS identifiers is quoted before substitution.

### Phase 3 — shipped

The PDF stops deriving a face from the family name. `exportToPdf` resolves the
document's requests under `{ portable: true, embeddable: true }` before layout
is reached, reporting anything it could not honour through `onFontShortfall`.
`buildPdf` embeds the resources in `layout.fontResolutions` and keys them by
resolution id; a span picks its face by the id it carries. The name-based guess
survives only where nothing resolved anything — no provider, an unembeddable
licence, or bytes that would not embed — so an application supplying no
provider is unaffected.

`PdfExportOptions.fontResolver` is **removed**, a breaking change. It resolves
bytes by family name at export time, which is precisely how a PDF comes to
embed a face the layout never measured. Keeping it deprecated would have left
that door open for the sake of an option that contradicts the model; an
application that used it supplies a `FontProvider` instead.

**Phase 2 shipped three gaps, and all three were inert rather than wrong.**
Nothing downstream could observe the recording, which is why the phase looked
complete:

- `Editor` never accepted `fonts`. `BaseEditor` and `ServerEditor` did, but the
  browser editor's own options interface omitted it and its constructor
  destructure dropped it — so the whole lane was unreachable from the main
  consumer.
- `MeasureContext` carried the resolver and none of the three `layoutBlock`
  calls forwarded it, so blocks were measured without one. `resolveBlockEntry`
  still took the twelve-positional-parameter list `MeasureContext` had replaced
  everywhere else; it takes the context now.
- `DocumentLayout.fontResolutions` was declared and never populated — nothing
  called `table()`. The pipeline publishes it now.

**The resolver's lifetime is the measure cache's, not the run's.** It was built
per pipeline run. A span records its resolution as an id into that resolver's
table, and the measure cache hands cached spans back on later runs without
re-measuring — so ids minted by one run pointed into a table rebuilt empty by
the next. It is created once, with the coordinator.

**An id names a face, not a family.** The interning key was
`family|source|portable`, which gave regular and bold Arial one id and one
answer — and would have had the exporter embed one set of bytes for both, every
bold run painted from the regular face. The key now includes the resource and
the requested weight and style, encoded rather than joined on a separator: a
resource id is whatever the application called it, so it can contain the
separator, and its absence has to stay distinguishable from an id that happens
to be the empty string.

**Running a real contract found two more paths outside the lane.** A ten-page
DOCX set in Aptos exported with 3510 glyphs from the embedded face and 187 from
a standard one. The 187 were table cells: `layoutTableRowCells` never received
the resolver, so cell text was measured in the family nobody owned and painted
in Helvetica — the original bug, alive inside tables long after body text was
fixed. List markers had the same shape for a different reason: the marker was
pinned to `fontRegistry.fallback`, which would put the number of a numbered
clause in a different typeface from the clause. Both now take the face of the
line they belong to; the document exports with one face throughout.

The lesson is about coverage, not about tables: a lane that spans opt into is a
lane every new drawing path silently opts out of. The remaining opt-out is the
drawing surface — `PdfFontHandle` names a family and carries no resolution — so
a handler drawing its own text still chooses by name. It has one caller today
(header/footer tokens), which is why it was left rather than fixed blind.

**What phase 3 does not do.** Canvas resolves with no constraints and the
export resolves with two, so the two can disagree — a face that is registered
but unembeddable is measured on screen and cannot go in the file. Export takes
its own constrained snapshot and re-layouts from that snapshot, so pagination
and painting remain internally consistent. It reports any substitution through
`onFontShortfall`.

### Phase 3 follow-ups — shipped

Running the playground's own configuration against the contract found two more
faults, both invisible until a real inventory existed.

**The default was a face, not a family.** Falling back went straight to the one
`default` resource, so a document naming a family nobody owns lost its bold and
its italic: 3697 glyphs of a contract came out in the regular weight. A
document that says bold still means bold even when the family is unavailable,
so the fallback now picks the nearest face in the default's *family*. The
contract exports as 3107 regular, 568 bold, 22 italic — the same distribution
it had before any substitution, re-faced.

**A font-family list was treated as one family name.** `parseFont` returns
everything after the size, so `"Arial, sans-serif"` was asked of the provider
verbatim and matched nothing registered as `Arial`. The rest of the list is the
host's fallback chain, which is the decision a provider exists to replace; only
the primary family is a request.

**Reporting was per size.** Interning on `request.size` gave one answer per
`(face, size)` pair, so the contract reported thirteen substitutions for five
faces. Size is a measurement parameter, not part of a face's identity. The
requested family stays in the key, because two families sharing a fallback
today must still split when one of them is registered tomorrow.

**The adapter and the demo.** `useScrivrEditor` accepted no `fonts` option, so
the React lane had the same hole `Editor` did. The docs playground now supplies
an Inter inventory, which is the worked example the guide points at: an
application owns its typefaces, and Scrivr owns the resolution.

**A face is one set of bytes, which decides how a font is packaged.** The
playground first used `@fontsource`'s per-script subsets, the arrangement the
web normally uses: one file per script, chosen by `unicode-range`. That assumes
the browser picks a file per character. It cannot here — the same bytes have to
measure on canvas and embed in a PDF, and an exporter has no per-character
choice to make. The Latin subset holds 231 glyphs, so a document that turned
out to contain Cyrillic would have rendered in something nobody chose. The
playground uses `inter-ui`'s unsubsetted files instead: ~110 KB and 2852 glyphs
per face, verified by exporting Latin, Latin Extended, Cyrillic, Greek and
Vietnamese and reading the characters back out of the PDF's ToUnicode map.

Supporting per-script files properly would mean a face composed of several
sources plus script-aware run splitting in the exporter. That is a real
feature, not a packaging detail, and nothing has asked for it.

### The picker — shipped

A font control was the last thing still describing an inventory nobody had.
`FontFamily` declares its presets in phase 1, before an editor exists, so it
cannot know what the editor it ends up in can render: with a provider holding
Inter, its six preset families were six names that all resolved to one
typeface. Meanwhile a `.docx` written in Aptos showed "Aptos" in the control
while the page was drawn in Inter — a name for a face that was neither present
nor used.

`FontProvider` gained an optional `inventory()`, and the editor exposes
`fontFamilies` from it. The family toolbar group is reconciled against that at
construction, which is the first moment both facts exist; with no provider the
extension's presets stand, because nothing was claimed and removing them would
leave the control empty. Enumeration is optional because a provider backed by a
remote catalogue can resolve a name without being able to list every name it
would accept.

The document's own family is still shown — it is what the document says, and a
control that renamed it would lie in the other direction. It is shown as
`Aptos → Inter`, and no longer styled in the missing family, which had been
rendering the label in an arbitrary browser fallback and making an absent font
look present.

**Enumeration exposed a bug in the thing being enumerated.** `systemCandidates`
were stored lowercased for matching, so `inventory()` offered "courier new" to
be displayed. The set became a map: lowercase to match on, the caller's
spelling to show.

### Reporting — shipped

Import reported once and export reported at the end; nothing answered "what is
this document not getting" in between, although `DocumentLayout.fontResolutions`
had held the answer since phase 2. `Editor.fontSubstitutions` derives the same
`FontShortfall` the other two producers emit — one type, three producers, one
live view rather than a fourth shape. It is memoised on the layout version,
because a getter that rebuilt its array would re-render every subscriber on
every notification.

`getActiveFontFamily()` returns the family in effect at the selection with the
face it is drawn in. The playground had reconstructed the inline-mark →
block-attr → document-default precedence itself, which is the editor's own rule
and the same re-derivation this document exists to stop; the control now reads
it.

No UI ships in core. Whether a substitution is a badge, a banner or nothing is
a decision about what an application is for, and the two consumers we can name
would answer it differently. The `Aptos → Inter` treatment in the playground is
one application's choice, not a component.

## Decisions (locked)

**Does layout re-measure when a font loads late?** Yes — when the *resolution*
changes, not when a font event fires. Geometry is a function of the resolved
face, so a block measured against a fallback whose request later resolves to
the real thing is holding geometry that no longer matches. A font arriving that
nothing requested changes nothing and invalidates nothing. Font loading is not
the source of truth; the provider's answer is.

**What happens if a font is still loading when an export starts?** The export
takes a resolution snapshot: settle what is already loading, resolve every
request, freeze those resolutions, measure against them, and hand the same
resolutions and bytes to the renderer. A font that arrives mid-export does not
move the ground underneath it — it can invalidate the editor afterwards, and
that export stays internally consistent.

**Is `FontResolution` public API?** Not initially. `LayoutSpan` carries an
opaque `FontResolutionId` and the layout snapshot holds the table (§1). The
concept is settled; the representation is not, and putting it on `LayoutSpan`
would publish storage as contract under the 1.x compat policy.

**Does substitution block an export?** No — but an export must not knowingly
break the invariant either, and "warn, then paint something else" is the bug
this RFC exists to remove.

The resolution is to do the work **before entering the layout path**, not to
discover a divergence afterwards and lay out a second time. A document's font
requests are knowable without measuring anything: walk it, collect the distinct
`FontKey`s, resolve them all against the inventory — applying the consumer's
own constraint, which for an export means *portable* — and only then measure.
An export whose resolutions all match the editor's reuses the editor's layout,
which is the common case. One whose constraint changes an answer lays out once,
against the set it chose up front. There is no re-measure-after-discovery
because there is no discovery.

OOXML uses a similar separation, and it is worth borrowing rather than
claiming as a precedent — a runtime provider does more than a static part.
`word/fontTable.xml` declares every font a document uses, with the panose, family, pitch and charset metadata a renderer
needs to substitute, plus optional embedded font parts — and Word reads it
before rendering rather than learning about fonts run by run. The declared
inventory is separate from the runs that reference it, which is the same split
as request-versus-resource.

Two diagnostics, because they are different situations:

- `font-substituted` — internally correct, differs from what was requested.
- `font-unreproducible` — a lane that cannot satisfy the invariant at all.
  Reserved; the built-in PDF exporter should never emit it.

**Per-span or per-run resolution?** Logically per run, physically interned.
Resolution depends on family × weight × style — and later stretch and variation
axes — so it belongs to the unit whose text is measured, but the object is
stored once (§1).

**Does canvas accept supplied bytes?** Yes, and this is the load-bearing one.
The claim is stronger than "both lanes agree on a name": **both lanes consume
the same font resource**. Supplied bytes become a `FontFace` for measurement
and the same bytes are embedded on export. Without this, supplying a font makes
things worse — PDF embeds a face the canvas never measured, which is this bug
pointing the other way.

**Can callers supply fonts?** Yes, as resources (§7). Bytes or a fetchable URL,
normalized to bytes and portable to both lanes. A locally installed font
registers as a *candidate*, not a resource: it resolves with `portable: false`,
which an export treats as grounds to resolve again. Document `fontFamily`
values never register anything — they are requests.

## Alternatives considered

- **Widen the PDF heuristic** — teach `standardFamilyFor` about Aptos and
  friends. Cheap, and wrong: it improves the guess without making it shared,
  and the next unfamiliar font has the identical bug.
- **Strip unavailable fonts at import** — tried; see §5. Effective, lossy, and
  at the wrong layer.
- **Always require `fontResolver`** — correct output, but pushes a font
  pipeline onto every consumer for a problem most documents do not have, and
  does nothing for canvas.
- **Measure with pdf-lib metrics during layout** — makes the PDF exact by
  making the screen wrong. Inverts the priority: the canvas is what the user
  approves.
- **Ship a default font bundle** — orthogonal and defensible later (phase 4),
  but it narrows the failure rather than removing it, and licensing is a real
  constraint.

## The font table we throw away

`@scrivr/docx` neither reads nor writes `word/fontTable.xml`. Neither direction
is harmless.

On import, Word hands us the substitution metadata for every font in the file —
panose classification, family, pitch, charset — which is the closest thing to a
machine-readable answer to "what should stand in for this". The document that
prompted this RFC declared Aptos there, and we discarded it before deciding
what to substitute. A provider that reads it can pick a fallback by
classification rather than by the exporter's `/georgia|times|serif/` guess.

On export we emit no font table at all. Word tolerates that, but a document we
wrote carries no record of what it was set in — so the round trip loses the one
part that would let the next reader resolve it the way we did.

Reading it belongs with Phase 1 (it is inventory), writing it with whatever
phase gives the DOCX lane resolutions to write down. Neither is on the critical
path for the PDF bug, and both are the difference between resolving from
evidence and resolving from a regex.

## What this does not solve

- **Licensing.** Having bytes is not permission to embed them. The provider
  should carry whatever the supplier asserts and let the caller decide.
- **Shaping.** pdf-lib performs no complex shaping, so scripts needing ligature
  substitution or bidi will not render correctly even with the right face. This
  gets the right *face*, not the right *shaping*.
- **Documents whose fonts exist nowhere.** With no Aptos bytes available, the
  output remains an approximation. The gain is that it becomes a declared one.
