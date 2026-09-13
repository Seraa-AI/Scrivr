import type { MarkDecorator, SpanRect } from "../extensions/types";
import type { ResolvedTheme } from "../model/theme";

/** One mark as it appears on a laid-out span. */
interface SpanMark {
  name: string;
  attrs: Record<string, unknown>;
}

/**
 * Ask the actual drawing context which colours it supports. Invalid fillStyle
 * assignments retain the old value, so two different sentinels distinguish a
 * rejected declaration from a valid colour equal to the first sentinel.
 * Preserve the caller's fill, including gradients/patterns. Do not cache:
 * context-dependent colours can resolve differently on another canvas.
 */
function acceptsColor(ctx: CanvasRenderingContext2D, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const previous = ctx.fillStyle;
  try {
    ctx.fillStyle = "#000000";
    ctx.fillStyle = value;
    if (ctx.fillStyle !== "#000000") return true;
    ctx.fillStyle = "#ffffff";
    ctx.fillStyle = value;
    return ctx.fillStyle !== "#ffffff";
  } finally {
    ctx.fillStyle = previous;
  }
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
  ctx: CanvasRenderingContext2D,
): string {
  if (!decorators || !marks) return theme.defaultText;

  let authored: string | undefined;
  let defaulted: string | undefined;
  for (const mark of marks) {
    const decorator = decorators.get(mark.name);
    if (!decorator) continue;
    const withAttrs: SpanRect = { ...rect, markAttrs: mark.attrs };
    const authoredCandidate = decorator.decorateFill?.(withAttrs, theme);
    const defaultCandidate = decorator.decorateDefaultFill?.(withAttrs, theme);
    if (acceptsColor(ctx, authoredCandidate)) authored = authoredCandidate;
    if (acceptsColor(ctx, defaultCandidate)) defaulted = defaultCandidate;
  }
  return authored ?? defaulted ?? theme.defaultText;
}
