/**
 * Whether an inline object floats, and where, belongs to its extension. This
 * one is written only against `@scrivr/core`'s public surface: a badge that
 * declares `anchored` and is placed, wrapped around and hit like an image,
 * with no engine change.
 */
import { describe, expect, it } from "vitest";
import {
  Extension,
  ExtensionManager,
  StarterKit,
  anchoredOf,
  defaultPageConfig,
  runPipeline,
  type AnchoredPlacement,
} from "../index";
import { createMeasurer } from "../test-utils";

const BADGE = 60;

const badgePlacement = (wrapMode: AnchoredPlacement["wrapMode"]): AnchoredPlacement => ({
  width: BADGE, height: BADGE, wrapMode, positionMode: "move-with-text",
  xAlign: "right", x: null, yOffset: 0, zIndex: 0, margin: 8,
});

const Badges = Extension.create({
  name: "badges",
  addNodes() {
    return {
      badge: {
        group: "inline",
        inline: true,
        atom: true,
        attrs: { floating: { default: true } },
        anchored: (node) => badgePlacement(node.attrs["floating"] === true ? "square" : "inline"),
        toDOM: () => ["span", { class: "badge" }],
      },
    };
  },
  addInlineHandlers() {
    return { badge: { render: (ctx, x, y, width, height) => ctx.fillRect(x, y, width, height) } };
  },
});

const manager = new ExtensionManager([StarterKit, Badges]);
const words = "word ".repeat(40).trim();

const layoutOf = (floating: boolean) =>
  runPipeline(manager.schema.nodeFromJSON({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "badge", attrs: { floating } }, { type: "text", text: words }] },
  ] }), { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles(), inlineRegistry: manager.buildInlineRegistry() });

describe("a floating object from outside core", () => {
  it("reads its placement from its spec", () => {
    const badge = manager.schema.nodes["badge"]?.create({ floating: true });
    expect(badge && anchoredOf(badge)).toEqual(badgePlacement("square"));
    expect(anchoredOf(manager.schema.text("x"))).toBeNull();
  });

  it("is placed where it declares, against the right margin, and the text wraps beside it", () => {
    const layout = layoutOf(true);
    const placed = layout.anchoredObjects?.[0];
    const contentRight = defaultPageConfig.pageWidth - defaultPageConfig.margins.right;
    expect(placed).toMatchObject({ width: BADGE, height: BADGE });
    expect((placed?.x ?? 0) + BADGE).toBeCloseTo(contentRight, 0);
    const firstLine = layout.pages[0]?.blocks[0]?.lines[0];
    expect(firstLine?.width).toBeLessThan(contentRight - defaultPageConfig.margins.left - BADGE);
  });

  it("sits in the line when it declares an inline placement", () => {
    expect(layoutOf(false).anchoredObjects ?? []).toEqual([]);
  });
});
