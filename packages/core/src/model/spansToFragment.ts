/**
 * Inverse of the semantic export's `toSpans`: rich inline runs → a ProseMirror
 * `Fragment` of marked text nodes. The write half of the Rich Semantic Merge —
 * an agent returns `InlineSpan[]` and this reconstructs the inline content.
 *
 * The agent's spans are model output: untrusted. This never crashes the merge
 * and never poisons the document:
 *  - empty-text runs are skipped (`schema.text("")` throws);
 *  - the `NEWLINE_SPAN` sentinel is dropped (block boundaries can't occur
 *    inside a single-block unit — the edit path reads one unit per block);
 *  - an unknown mark type is dropped but its TEXT is kept, warned once;
 *  - url-bearing mark attrs (`link.href`) are sanitized through `safeUrl`;
 *    an unsafe url drops the mark, keeping the text;
 *  - a mark whose attrs `create` throws is dropped, keeping the text.
 */
import { Fragment, Mark, type Node as PmNode, type Schema } from "prosemirror-model";
import type { InlineMark, InlineSpan } from "../exports/semantic";
import { safeUrl } from "./safeUrl";
import { stableStringify } from "./hash";

/** Mark attrs that carry a URL and must pass the `safeUrl` gate. */
const URL_ATTRS: Record<string, readonly string[]> = {
  link: ["href"],
};

export interface SpansToFragmentOptions {
  /** Called once per distinct dropped mark type (unknown type or bad attrs). */
  onWarn?: (message: string) => void;
}

export function spansToFragment(
  spans: readonly InlineSpan[],
  schema: Schema,
  options: SpansToFragmentOptions = {},
): Fragment {
  // Dedupe warnings so a dropped mark type is reported once, not per run.
  const warned = new Set<string>();
  const warnOnce = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    options.onWarn?.(message);
  };

  const nodes: PmNode[] = [];
  for (const span of spans) {
    // Empty runs and the newline sentinel never become text nodes.
    if (span.text === "" || (span.text === "\n" && span.marks.length === 0)) continue;

    const marks: Mark[] = [];
    for (const inline of span.marks) {
      const mark = resolveInlineMark(inline, schema, warnOnce);
      if (mark) marks.push(mark);
    }
    nodes.push(schema.text(span.text, marks.length > 0 ? marks : null));
  }
  return Fragment.fromArray(nodes);
}

/**
 * Resolve one untrusted `InlineMark` to a real PM `Mark`, or `null` if it must
 * be dropped (unknown type, unsafe url, invalid attrs). The single seam where
 * agent-supplied marks are validated — shared by `spansToFragment` (inserted
 * text) and the rich merge's mark-change path (retained text), so both treat
 * model output identically.
 */
export function resolveInlineMark(
  inline: InlineMark,
  schema: Schema,
  onWarn?: (message: string) => void,
): Mark | null {
  const warn = (why: string) =>
    onWarn?.(`[resolveInlineMark] dropped mark "${inline.type}": ${why}`);

  const markType = schema.marks[inline.type];
  if (!markType) {
    warn("not in schema");
    return null;
  }

  let attrs = inline.attrs;
  for (const urlAttr of URL_ATTRS[inline.type] ?? []) {
    if (attrs && attrs[urlAttr] !== undefined) {
      const safe = safeUrl(attrs[urlAttr]);
      if (safe === null) {
        warn(`unsafe ${urlAttr}`);
        return null;
      }
      attrs = { ...attrs, [urlAttr]: safe };
    }
  }

  try {
    return markType.create(attrs);
  } catch {
    warn("invalid attrs");
    return null;
  }
}

/**
 * Attr-normalized mark equality. Two `InlineMark`s are the same mark when their
 * types match and their attrs canonicalize identically — `#fff` vs `#ffffff`
 * are NOT equal (values differ) but reordered attr keys ARE (canonical serialize
 * matches `stableStringify`, the same normalization `describeMark` feeds in).
 * The "marks changed on retained text" step depends on this being exact.
 */
export function sameMark(a: InlineMark, b: InlineMark): boolean {
  return (
    a.type === b.type &&
    stableStringify(a.attrs ?? {}) === stableStringify(b.attrs ?? {})
  );
}
