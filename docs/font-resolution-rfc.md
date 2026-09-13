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

That makes it a breaking change, and it should be documented as one rather than
softened. An editor constructed with no font resource has no honest default —
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
const editor = new Editor({
  fonts: new DefaultFontProvider({
    default: interRegular,
    resources: [interRegular, interBold, acmeLegal],
  }),
});
```

The common case should not require a font pipeline, so `DefaultFontProvider`
handles inventory, loading and resolution. The interface behind it is what an
organisation with its own typography implements:

```ts
interface FontProvider {
  defaultRequest(): FontRequest;
  resolve(request: FontRequest): Promise<FontResolution>;
  getResource(resolution: FontResolution): Promise<FontResource | null>;
  subscribe?(listener: (change: FontInventoryChange) => void): () => void;
}
```

Registration is asynchronous — bytes are fetched, metadata inspected, a
`FontFace` added and awaited — and defaults to `loading: "lazy"`, so a resource
is paid for when something first resolves to it. Completion emits an inventory
change, which is what drives the targeted re-layout in §8.

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

0. **Require it** — the default becomes an app-supplied resource. Breaking, and
   documented as such, with the demo app as the configuration to copy. Nothing
   resolves implicitly after this.
1. **Own it** — `FontProvider` on `Editor`; inventory, resolution, invalidation.
   Resolution runs as a pass over the document's distinct requests *before*
   layout, so measurement never asks a question the provider has not answered.
   Report substitutions at import and first layout. No behaviour change; the
   invisible failure becomes visible and correctly owned.
2. **Record it** — thread `FontResolution` onto layout spans. Still no
   behaviour change; makes phase 3 possible.
3. **Honour it** — PDF reads the resolution and the bytes instead of
   re-deriving. This is where the exported document stops lying.
4. **Supply it** *(optional)* — a default resolver that fetches common
   families, so the bytes tier is the normal case rather than the lucky one.

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

This is also how OOXML does it. `word/fontTable.xml` declares every font a
document uses, with the panose, family, pitch and charset metadata a renderer
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
