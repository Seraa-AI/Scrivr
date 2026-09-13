/**
 * Which mark decides the colour of a span.
 *
 * Two marks can both have an opinion, and they are not equal: a colour mark is
 * something the author chose, a link's blue is what a link looks like. The
 * answer must not depend on the order the marks happen to arrive in, because
 * that order is schema declaration rank — an arbitrary fact about how the
 * StarterKit is written.
 */

import { describe, it, expect } from "vitest";
import { resolveSpanFill } from "./resolveSpanFill";
import { defaultEditorTheme } from "../model/theme";
import type { MarkDecorator, SpanRect } from "../extensions/types";

const theme = defaultEditorTheme;
const rect: Omit<SpanRect, "markAttrs"> = { x: 0, y: 0, width: 10, ascent: 8, descent: 2 };

const authored: MarkDecorator = {
  decorateFill: (r) => (typeof r.markAttrs["color"] === "string" ? r.markAttrs["color"] : undefined),
};
const semantic: MarkDecorator = { decorateDefaultFill: (_r, t) => t.link };

const decorators = new Map<string, MarkDecorator>([
  ["color", authored],
  ["link", semantic],
]);

const colorMark = { name: "color", attrs: { color: "#dc2626" } };
const linkMark = { name: "link", attrs: { href: "https://example.com" } };

const fill = (marks: Array<{ name: string; attrs: Record<string, unknown> }>) =>
  resolveSpanFill(marks, decorators, rect, theme);

describe("resolveSpanFill", () => {
  it("uses the theme default when nothing has an opinion", () => {
    expect(fill([])).toBe(theme.defaultText);
  });

  it("uses a mark's semantic colour when the author chose none", () => {
    expect(fill([linkMark])).toBe(theme.link);
  });

  it("uses the authored colour when there is one", () => {
    expect(fill([colorMark])).toBe("#dc2626");
  });

  it("prefers the authored colour over a semantic one, in either order", () => {
    // Schema rank puts `color` first today; nothing should depend on that.
    expect(fill([colorMark, linkMark])).toBe("#dc2626");
    expect(fill([linkMark, colorMark])).toBe("#dc2626");
  });

  it("takes the last authored colour when two marks both claim one", () => {
    const second = { name: "other", attrs: { color: "#2563eb" } };
    const withOther = new Map(decorators).set("other", authored);
    expect(resolveSpanFill([colorMark, second], withOther, rect, theme)).toBe("#2563eb");
  });

  it("ignores marks nothing decorates", () => {
    expect(fill([{ name: "bold", attrs: {} }, linkMark])).toBe(theme.link);
  });
});
