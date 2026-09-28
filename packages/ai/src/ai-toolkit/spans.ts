/**
 * The protocol's inline runs → the engine's.
 *
 * `InlineSpan` exists in two vocabularies: the zod protocol, where a mark's
 * `attrs` is optional because an agent omits what it does not set, and the core
 * model, which wants the key absent rather than explicitly undefined. Both the
 * rich and structural apply paths cross that boundary, so the crossing lives
 * here once.
 */
import type { InlineSpan } from "@scrivr/core";

import type { InlineSpan as EditInlineSpan } from "../schema/edit";

export function toCoreSpans(spans: readonly EditInlineSpan[]): InlineSpan[] {
  return spans.map((span) => ({
    text: span.text,
    marks: span.marks.map((mark) =>
      mark.attrs !== undefined ? { type: mark.type, attrs: mark.attrs } : { type: mark.type },
    ),
  }));
}
