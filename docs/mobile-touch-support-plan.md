# Mobile Touch Support Plan

## Status

Baseline pointer-event support is in progress on branch `touch-pointer-events`.

The editor should keep this baseline feature even before full mobile support is complete:

- `PointerController` uses Pointer Events instead of mouse-only events.
- Mouse, touch, and pen input enter the same hit-testing and drag paths.
- The controller tracks one active pointer and ignores competing pointers during a gesture.
- Pointer capture/release is guarded so browsers can keep drag gestures coherent.
- `pointercancel` resets in-flight drag state.
- The tile container sets `touch-action: manipulation`.

This is not yet production-complete mobile editing support. It is the foundation that makes mobile testing and browser validation meaningful.

## Why This Exists

The project has strong unit coverage for editor logic, layout, rendering helpers, and desktop-style pointer behavior. Mobile was not explicitly covered. A real mobile editor has additional failure modes that `happy-dom` unit tests cannot prove:

- touch and pen input routing
- browser gesture stealing
- virtual keyboard resize behavior
- textarea focus on tap
- mobile Safari/WebKit differences
- canvas rendering on small viewports
- popover and toolbar placement near viewport edges

The work should advance in layers: first pointer event support, then mobile-specific regressions, then real browser mobile tests.

## Current Baseline Contract

These behaviors should remain supported:

- Mouse behavior should not regress.
- A single touch tap should route like a click.
- A single touch drag should route through existing drag behavior.
- Inline image drag, anchored image drag, resize drag, and text selection should continue using shared pointer coordinates.
- A second pointer during an active gesture should not start a competing transaction.
- Pointer cancellation should leave the controller idle and ready for the next gesture.

This baseline deliberately does not claim native-quality mobile selection handles, long-press selection, or refined touch scrolling behavior yet.

## Production Readiness Checklist

### Core Regressions

- [ ] Test that pointer capture is called on `pointerdown` when available.
- [ ] Test that pointer capture is released on `pointerup`.
- [ ] Test that a second pointer is ignored during text selection drag.
- [ ] Test that a second pointer is ignored during image drag.
- [ ] Test that `pointercancel` clears text selection drag state.
- [ ] Test that `pointercancel` clears resize drag state.
- [ ] Test that `pointercancel` clears inline image drag state.
- [ ] Test that `pointercancel` clears anchored image drag state.
- [ ] Test that touch pointer events can perform text selection drag.
- [ ] Test that touch pointer events can move inline images.
- [ ] Test that touch pointer events can move anchored images.

### Browser Mobile Smoke Tests

Add Playwright coverage with mobile browser projects:

- [ ] Mobile Chrome profile.
- [ ] Mobile Safari/WebKit profile.
- [ ] Editor loads on mobile viewport.
- [ ] Tap places the cursor.
- [ ] Tap focuses the hidden textarea.
- [ ] Typing through the mobile path inserts text.
- [ ] Scrolling keeps canvas content nonblank.
- [ ] Cursor/input bridge remains near the caret after scroll.
- [ ] Toolbar and popovers stay inside the viewport.
- [ ] Image selection and basic image drag do not break the document.

### Manual Device Pass

Before marking mobile editing production-ready, test on real devices:

- [ ] iPhone Safari.
- [ ] Android Chrome.
- [ ] Tablet-sized viewport or real tablet.

Focus areas:

- tap-to-type reliability
- virtual keyboard opening and closing
- visual viewport resize
- scroll behavior while the editor is focused
- cursor placement after scroll
- canvas rendering after zoom/scroll
- image drag accidental activation
- toolbar and menu usability

## Gesture Policy Decisions

The current baseline maps touch to existing pointer behavior. That is useful, but mobile editing likely needs explicit gesture rules before it feels polished:

- tap places cursor
- drag may select text or scroll depending on context
- selected image may require a second drag before moving
- resize handles may need larger touch hit targets
- long-press selection can be handled later
- multi-touch should probably be reserved for browser/page gestures unless product requirements say otherwise

These decisions should be made after the first Playwright and manual-device pass, not guessed upfront.

## Definition Of Done

Mobile touch support can be considered production-ready when:

- core pointer regressions pass
- Playwright mobile smoke tests pass in CI
- real-device testing has no blocking issues
- known limitations are documented
- mouse/desktop behavior remains unchanged

