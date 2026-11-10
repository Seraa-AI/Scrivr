import { spansToFragment, type InlineSpan } from "@scrivr/core";
import type { Fragment, NodeType, Schema } from "@scrivr/core/pm";
import type { NewInsertAttrs } from "../helpers";
import { setFragmentAsInserted } from "./fragments";

/**
 * Inline content a suggestion inserts into a block of `parentType`, recorded
 * as one insertion. Built by `spansToFragment`, so a "\n" becomes the block's
 * line break (a newline in a code block) — the rule the semantic export reads
 * breaks by — and recorded as the engine records any insert
 * (`setFragmentAsInserted`): text marked, a break or image stamped with a
 * record of its own, so a rejected suggestion takes all of it back.
 */
export function suggestedContent(
  spans: readonly InlineSpan[],
  schema: Schema,
  parentType: NodeType,
  insertAttrs: NewInsertAttrs,
  onWarn?: (message: string) => void,
): Fragment {
  return setFragmentAsInserted(spansToFragment(spans, schema, { parentType, ...(onWarn ? { onWarn } : {}) }), insertAttrs, schema);
}
