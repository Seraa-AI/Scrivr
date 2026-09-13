import type { MarkDecorator, SpanRect } from "../extensions/types";
import type { ResolvedTheme } from "../model/theme";

/** One mark as it appears on a laid-out span. */
interface SpanMark {
  name: string;
  attrs: Record<string, unknown>;
}

/**
 * The colour a span's text is actually painted in.
 *
 * Two kinds of mark want a say and they are not equal. A colour mark is an
 * authorial choice; a link's blue is how a link looks when nobody chose
 * otherwise. Authored wins, whatever order the marks arrive in.
 *
 * That is the cascade OOXML applies — direct run formatting overrides a
 * character style — so a coloured hyperlink keeps its colour, which is what
 * Word does with the same document. Resolving by array position instead would
 * hand the answer to schema declaration order, where `link` happens to sort
 * last.
 */
export function resolveSpanFill(
  marks: readonly SpanMark[] | undefined,
  decorators: Map<string, MarkDecorator> | undefined,
  rect: Omit<SpanRect, "markAttrs">,
  theme: ResolvedTheme,
): string {
  if (!decorators || !marks) return theme.defaultText;

  let authored: string | undefined;
  let defaulted: string | undefined;
  for (const mark of marks) {
    const decorator = decorators.get(mark.name);
    if (!decorator) continue;
    const withAttrs: SpanRect = { ...rect, markAttrs: mark.attrs };
    authored = decorator.decorateFill?.(withAttrs, theme) ?? authored;
    defaulted = decorator.decorateDefaultFill?.(withAttrs, theme) ?? defaulted;
  }
  return authored ?? defaulted ?? theme.defaultText;
}
