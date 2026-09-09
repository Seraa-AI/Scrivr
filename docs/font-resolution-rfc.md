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

> The face used to **measure** a glyph run is the face used to **paint** it, in
> every lane that reproduces our geometry.
>
> If a lane cannot obtain that face, the document must be **re-measured**
> against a face every lane can obtain — never silently painted in another.

The second clause matters: it makes degrading a *legitimate resolution of the
invariant* rather than a workaround, provided it happens at resolution time
and not by rewriting the document.

And the rule that makes the design decidable:

> Consumers that **re-layout downstream** consume the **request**.
> Consumers that **reproduce our geometry** consume the **resolution**.

DOCX hands the document to Word, which resolves fonts itself — so forwarding
`"Aptos"` untouched is correct. PDF reproduces our geometry — so re-deriving is
wrong. Without this distinction, "forward the name everywhere" and "resolve
everywhere" both look defensible; with it, exactly one lane is broken.

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
  /** Present when the environment can hand over the bytes. */
  bytes?: () => Promise<ArrayBuffer | null>;
}
```

`source: "substituted"` is the fact the system is currently missing entirely.

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

### 6. Invalidation

| | |
|---|---|
| **Input** | the inventory changes — a webfont finishes loading |
| **Smallest unit** | blocks whose spans name that family, not the document |
| **Trigger** | `FontFace` load → provider → `TextMeasurer.invalidate(font)` (exists, `TextMeasurer.ts:266`) |
| **Stays valid** | every block using an unaffected family |

Closes `todo_font_loading_detection`, and wants `todo_typed_layout_invalidation`
as its partner — "the font arrived" is precisely the typed reason that today
would flip a single `_dirty` boolean and re-lay the document.

### 7. What must never know about what

- `LineBreaker` never learns about availability; it consumes measurements.
- PDF never re-derives resolution; it reads it.
- DOCX never reads resolution; it forwards the request.
- The provider is per-editor, not per-surface: an inventory is a property of
  the environment, and header, footer and body legitimately share it.

## Phases

1. **Own it** — `FontProvider` on `Editor`; inventory, resolution, invalidation.
   Report substitutions at import and first layout. No behaviour change; the
   invisible failure becomes visible and correctly owned.
2. **Record it** — thread `FontResolution` onto layout spans. Still no
   behaviour change; makes phase 3 possible.
3. **Honour it** — PDF reads the resolution and the bytes instead of
   re-deriving. This is where the exported document stops lying.
4. **Supply it** *(optional)* — a default resolver that fetches common
   families, so the bytes tier is the normal case rather than the lucky one.

## Decisions to lock before building

- **Does layout re-measure when a font loads late?** Invalidation exists; the
  policy does not.
- **Is `FontResolution` public API?** It would appear on `LayoutSpan`, which
  extensions read, and would then fall under the 1.x compat policy.
- **Does substitution block an export?** Proposal: never block, always report.
  A wrong-metrics PDF the user was warned about beats no PDF.
- **Per-span or per-run resolution?** Per-span matches how `font` already
  travels; a document-level table is smaller but adds an indirection per read.
- **Does canvas accept supplied bytes too?** It must, for the bytes tier to
  mean anything — otherwise PDF embeds a face canvas never measured, which is
  the same bug pointing the other way.

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

## What this does not solve

- **Licensing.** Having bytes is not permission to embed them. The provider
  should carry whatever the supplier asserts and let the caller decide.
- **Shaping.** pdf-lib performs no complex shaping, so scripts needing ligature
  substitution or bidi will not render correctly even with the right face. This
  gets the right *face*, not the right *shaping*.
- **Documents whose fonts exist nowhere.** With no Aptos bytes available, the
  output remains an approximation. The gain is that it becomes a declared one.
