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
  placementAttrs,
  defaultPageConfig,
  runPipeline,
  type AnchoredPlacement,
} from "../index";
import { createMeasurer } from "../test-utils";

const BADGE = 60;

const badgePlacement = (wrapMode: AnchoredPlacement["wrapMode"], x: number | null = null, yOffset = 0): AnchoredPlacement => ({
  width: BADGE, height: BADGE, wrapMode, positionMode: "move-with-text",
  xAlign: x === null ? "right" : "custom", x, yOffset, zIndex: 0, margin: 8,
});

const Badges = Extension.create({
  name: "badges",
  addNodes() {
    return {
      badge: {
        group: "inline",
        inline: true,
        atom: true,
        attrs: { floating: { default: true }, left: { default: null }, drop: { default: 0 } },
        anchored: {
          read: (node) => {
            const left = node.attrs["left"];
            const drop = node.attrs["drop"];
            return badgePlacement(
              node.attrs["floating"] === true ? "square" : "inline",
              typeof left === "number" ? left : null,
              typeof drop === "number" ? drop : 0,
            );
          },
          write: (patch) => ({
            ...(patch.wrapMode !== undefined ? { floating: patch.wrapMode !== "inline" } : {}),
            ...(patch.x !== undefined ? { left: patch.x } : {}),
            ...(patch.yOffset !== undefined ? { drop: patch.yOffset } : {}),
          }),
        },
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

  it("sits in the line, at the size it declares, when it declares an inline placement", () => {
    const layout = layoutOf(false);
    expect(layout.anchoredObjects ?? []).toEqual([]);
    const span = layout.pages[0]?.blocks[0]?.lines[0]?.spans[0];
    expect(span && [span.width, span.kind === "object" ? span.height : 0]).toEqual([BADGE, BADGE]);
  });

  it("stores a placement a gesture writes in its own attrs", () => {
    const badge = manager.schema.nodes["badge"]?.create({ floating: true });
    if (!badge) throw new Error("no badge");
    const attrs = placementAttrs(badge, { xAlign: "custom", x: 40, yOffset: 12 });
    expect(attrs).toEqual({ left: 40, drop: 12 });
    expect(anchoredOf(badge.type.create({ ...badge.attrs, ...attrs }))).toEqual(badgePlacement("square", 40, 12));
    expect(placementAttrs(manager.schema.text("x"), { x: 1 })).toBeNull();
  });
});
