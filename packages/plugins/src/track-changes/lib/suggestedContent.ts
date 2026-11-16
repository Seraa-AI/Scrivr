import { spansToFragment, type InlineSpan } from "@scrivr/core";
import { Fragment, type NodeType, type Node as PMNode, type Schema } from "@scrivr/core/pm";
import { genId, type NewInsertAttrs } from "../helpers";
import { setFragmentAsInserted } from "./fragments";

/**
 * Inline content a suggestion inserts into a block of `parentType`, recorded
 * as one insertion. Built by `spansToFragment`, so a "\n" becomes the block's
 * line break (a newline in a code block) — the rule the semantic export reads
 * breaks by — and each piece recorded as the engine records any insert
 * (`setFragmentAsInserted`): text marked, a break or image stamped. The first
 * piece names the act and the rest are its parts (`creationId`), so reviewing
 * any of it decides all of it.
 */
export function suggestedContent(
  spans: readonly InlineSpan[],
  schema: Schema,
  parentType: NodeType,
  insertAttrs: NewInsertAttrs,
  onWarn?: (message: string) => void,
): Fragment {
  const content = spansToFragment(spans, schema, { parentType, ...(onWarn ? { onWarn } : {}) });
  const act = genId();
  const pieces: PMNode[] = [];
  content.forEach((piece, _offset, index) => {
    const attrs: NewInsertAttrs & { id?: string } = index === 0 ? { ...insertAttrs, id: act } : { ...insertAttrs, creationId: act };
    setFragmentAsInserted(Fragment.from(piece), attrs, schema).forEach((recorded) => pieces.push(recorded));
  });
  return Fragment.fromArray(pieces);
}
