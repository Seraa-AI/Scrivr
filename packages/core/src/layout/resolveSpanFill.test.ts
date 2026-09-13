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
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import type { MarkDecorator, SpanRect } from "../extensions/types";

const theme = defaultEditorTheme;
const ctx = document.createElement("canvas").getContext("2d")!;
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
  resolveSpanFill(marks, decorators, rect, theme, ctx);

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
    expect(resolveSpanFill([colorMark, second], withOther, rect, theme, ctx)).toBe("#2563eb");
  });

  it("ignores marks nothing decorates", () => {
    expect(fill([{ name: "bold", attrs: {} }, linkMark])).toBe(theme.link);
  });

  it.each(["", "notacolour", "var(--missing)"])("ignores rejected authored colour %j in either order", color => {
    const invalid = { name: "color", attrs: { color } };
    expect(fill([invalid, linkMark])).toBe(theme.link);
    expect(fill([linkMark, invalid])).toBe(theme.link);
    expect(fill([invalid])).toBe(theme.defaultText);
  });

  it("keeps earlier valid declarations in both cascade tiers", () => {
    const invalid = { name: "invalid", attrs: {} };
    const withInvalid = new Map(decorators).set("invalid", {
      decorateFill: () => "invalid",
      decorateDefaultFill: () => "invalid",
    });
    expect(resolveSpanFill([colorMark, invalid], withInvalid, rect, theme, ctx)).toBe("#dc2626");
    expect(resolveSpanFill([linkMark, invalid], withInvalid, rect, theme, ctx)).toBe(theme.link);
    expect(resolveSpanFill([invalid], withInvalid, rect, theme, ctx)).toBe(theme.defaultText);
  });

  it.each(["black", "#000000", "white", "#ffffff", "transparent", "rgba(255, 0, 0, 0.25)"])(
    "preserves accepted colour %s including sentinel colours and alpha", color => {
      expect(fill([{ name: "color", attrs: { color } }, linkMark])).toBe(color);
    },
  );

  it("preserves drawing state while checking both valid and invalid declarations", () => {
    const gradient = ctx.createLinearGradient(0, 0, 10, 10);
    gradient.addColorStop(0, "red");
    gradient.addColorStop(1, "blue");
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.5;
    const alpha = ctx.globalAlpha;
    fill([colorMark, linkMark, { name: "color", attrs: { color: "invalid" } }]);
    expect(ctx.fillStyle).toBe(gradient);
    expect(ctx.globalAlpha).toBe(alpha);
    ctx.globalAlpha = 1;
  });
});

describe("the real StarterKit marks", () => {
  // The stubs above prove the resolver. This proves the extensions are wired
  // to it the way they claim: swap Link back to `decorateFill` and the first
  // case here goes blue.
  const decorators = new ExtensionManager([StarterKit]).buildMarkDecorators();

  const realFill = (marks: Array<{ name: string; attrs: Record<string, unknown> }>) =>
    resolveSpanFill(marks, decorators, rect, theme, ctx);

  it("paints a coloured link in the author's colour", () => {
    // Schema rank emits [color, link]; the old last-wins loop painted blue.
    expect(realFill([colorMark, linkMark])).toBe("#dc2626");
  });

  it("still paints an uncoloured link in the link colour", () => {
    expect(realFill([linkMark])).toBe(theme.link);
  });

  it("leaves text with neither mark alone", () => {
    expect(realFill([{ name: "bold", attrs: {} }])).toBe(theme.defaultText);
  });

  it("a link with an invalid colour does not inherit the previous span's ink", () => {
    ctx.fillStyle = "#ff0000";
    const chosen = realFill([
      { name: "color", attrs: { color: "notacolour" } }, linkMark,
    ]);
    expect(ctx.fillStyle).toBe("#ff0000"); // resolving does not paint
    ctx.fillStyle = chosen;
    expect(ctx.fillStyle).toBe(theme.link);
  });

  it.each([null, 42, {}])("ignores a non-string colour attribute %j", color => {
    expect(realFill([{ name: "color", attrs: { color } }, linkMark])).toBe(theme.link);
  });
});
