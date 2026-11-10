/**
 * Composite layout: one unit of a composite node (a table's row) laid out as
 * the side-by-side regions its extension places (`CompositeLayout.regions`).
 *
 * The extension says where each region sits; this lays out what each holds,
 * with the walk the page body and wrappers use (`collectChildItems` +
 * `layoutItem`), and the images anchored in it, as Word lays out a cell
 * (`layoutInCell`): each image placed in its region from its paragraph's top,
 * the region's text wrapping around it. A unit is as tall as its tallest
 * region, and every region fills that height.
 *
 * Position model (matches the line model so the measure cache can reuse a unit
 * at any page y): region `x` is absolute (horizontal position never changes
 * with pagination), but region `y` and its blocks' `y` are RELATIVE to the
 * unit's top. The renderer and CharacterMap add the unit's final `y`.
 */
import type { LayoutBlock, LaidRegion, RegionFloat } from "./BlockLayout";
import { ANCHORED_OBJECT_MARGIN, anchorsInLines, clearOfEarlier } from "./AnchoredObjects";
import { ExclusionManager } from "./ExclusionManager";
import type { LineSpaceProvider } from "./LineBreaker";
import type { TextMeasurerLike } from "./TextMeasurer";
import { defaultFontConfig, type FontConfig } from "./FontConfig";
import type { FontModifier } from "../extensions/types";
import type { InlineRegistry, RegionPlacement } from "./BlockRegistry";
import type { LayoutFontResolver } from "../fonts/layoutResolver";
import { collectChildItems, layoutItem } from "./layoutItems";

export interface RegionLayoutContext {
  /** Absolute x of the unit's left edge. */
  x: number;
  /** Page this unit sits on. */
  page: number;
  measurer: TextMeasurerLike;
  fontConfig?: FontConfig;
  fontModifiers?: Map<string, FontModifier>;
  inlineRegistry?: InlineRegistry;
  /** Region text is document text: it resolves its faces like any other block. */
  fonts?: LayoutFontResolver;
}

/** Lay out a unit's regions. Returns them (with `y` relative to the unit top) and the unit's height. */
export function layoutRegions(
  placements: readonly RegionPlacement[],
  ctx: RegionLayoutContext,
): { regions: LaidRegion[]; height: number } {
  const regions: LaidRegion[] = placements.map((declared) => {
    const placement = sizedPlacement(declared);
    const { inset } = placement;
    const x = ctx.x + placement.x;
    const box: RegionBox = {
      pos: placement.pos,
      contentX: x + inset.left,
      contentWidth: Math.max(0, placement.width - inset.left - inset.right),
      top: inset.top,
    };
    const { blocks, contentBottom, floats } = layoutRegionContent(placement, box, ctx);
    const height = Math.max(contentBottom, ...floats.filter(wrapsText).map((f) => f.y + f.height)) + inset.bottom;
    return {
      pos: placement.pos,
      x,
      y: 0, // a region's top aligns with the unit's top
      width: placement.width,
      height,
      inset,
      blocks,
      ...(floats.length > 0 ? { floats } : {}),
      ...(placement.data !== undefined ? { data: placement.data } : {}),
    };
  });

  const height = regions.reduce((max, r) => Math.max(max, r.height), 0);
  // Every region fills the unit height (top-aligned content).
  for (const region of regions) region.height = height;

  return { regions, height };
}

/** A size an extension declared, or none: a region is never sized NaN or negative. */
const sizeOf = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/** A placement whose position, width and inset are numbers layout can use. */
function sizedPlacement(placement: RegionPlacement): RegionPlacement {
  const { inset } = placement;
  return {
    ...placement,
    x: Number.isFinite(placement.x) ? placement.x : 0,
    width: sizeOf(placement.width),
    inset: { top: sizeOf(inset.top), right: sizeOf(inset.right), bottom: sizeOf(inset.bottom), left: sizeOf(inset.left) },
  };
}

interface RegionBox {
  pos: number;
  contentX: number;
  contentWidth: number;
  /** Where content starts, relative to the unit's top. */
  top: number;
}

/** Text in a region wraps around square and top-and-bottom images; behind and front wrap nothing. */
function wrapsText(f: RegionFloat): boolean {
  return f.wrapMode === "square" || f.wrapMode === "top-bottom";
}

/**
 * Passes allowed for a region whose images move their own anchors: an image
 * placed from its paragraph can wrap the text above that paragraph and so
 * move it. Word re-places until it settles; a region keeps the last placement.
 */
const MAX_REGION_PASSES = 3;

/**
 * Lay out a region's blocks and the images anchored in them: each image is
 * placed in the region from its paragraph's top and the region's text wraps
 * around it. Every `y` is relative to the unit's top.
 */
function layoutRegionContent(
  placement: RegionPlacement,
  box: RegionBox,
  ctx: RegionLayoutContext,
): { blocks: LayoutBlock[]; contentBottom: number; floats: RegionFloat[] } {
  let laid = layoutRegionBlocks(placement, box, ctx);
  let floats = placeRegionFloats(laid.blocks, box);
  // The images the laid-out text wraps around. Returned with it, so text and
  // image never disagree: an image that keeps moving its own anchor stays
  // where the text last wrapped it, as the body locks one.
  let wrapped = floats;
  for (let pass = 0; pass < MAX_REGION_PASSES && floats.some(wrapsText); pass++) {
    laid = layoutRegionBlocks(placement, box, ctx, wrapAround(floats, box));
    wrapped = floats;
    const replaced = placeRegionFloats(laid.blocks, box);
    const settled = replaced.every((f, i) => f.x === floats[i]?.x && f.y === floats[i]?.y);
    floats = replaced;
    if (settled) break;
  }
  return { ...laid, floats: wrapped };
}

function layoutRegionBlocks(
  placement: RegionPlacement,
  box: RegionBox,
  ctx: RegionLayoutContext,
  lineSpaceIn?: (x: number, width: number) => LineSpaceProvider,
): { blocks: LayoutBlock[]; contentBottom: number } {
  // Each block is resolved as the page body resolves it. A boundary (a page
  // or section break) has no meaning inside a region.
  const blocks: LayoutBlock[] = [];
  let relY = box.top;
  for (const item of collectChildItems(placement.node, placement.pos + 1)) {
    if (item.boundary) continue;
    const childBlock = layoutItem(item, { x: box.contentX, width: box.contentWidth }, {
      y: relY,
      page: ctx.page,
      measurer: ctx.measurer,
      // No `map`: the CharacterMap is populated at paint time, matching the
      // convention for cached, position-independent layouts.
      fontConfig: ctx.fontConfig ?? defaultFontConfig,
      ...(ctx.fontModifiers ? { fontModifiers: ctx.fontModifiers } : {}),
      ...(ctx.inlineRegistry ? { inlineRegistry: ctx.inlineRegistry } : {}),
      ...(ctx.fonts ? { fonts: ctx.fonts } : {}),
    }, lineSpaceIn);
    blocks.push(childBlock);
    relY += childBlock.spaceBefore + childBlock.height + childBlock.spaceAfter;
  }
  return { blocks, contentBottom: relY };
}

/**
 * Place each image anchored in the region's blocks: `yOffset` from its
 * paragraph's top, never above the region's content top, and kept inside the
 * region horizontally. A square image that would overlap one placed before it
 * moves clear of it, as in the body.
 */
function placeRegionFloats(blocks: readonly LayoutBlock[], box: RegionBox): RegionFloat[] {
  const floats: RegionFloat[] = [];
  for (const block of blocks) {
    for (const anchor of anchorsInLines(block.lines)) {
      const { attrs } = anchor;
      // An image wider than its region is scaled down whole, never squashed.
      const scale = Math.min(1, box.contentWidth / attrs.width);
      const width = attrs.width * scale;
      const height = attrs.height * scale;
      const maxX = box.contentX + box.contentWidth - width;
      const x = attrs.xAlign === "custom"
        ? Math.min(Math.max(box.contentX + (attrs.x ?? 0), box.contentX), maxX)
        : attrs.xAlign === "center" ? box.contentX + (box.contentWidth - width) / 2
        : attrs.xAlign === "right" ? maxX
        : box.contentX;
      const atOffset = Math.max(box.top, block.y + attrs.yOffset);
      const float: RegionFloat = {
        docPos: anchor.docPos,
        node: anchor.node,
        x,
        y: atOffset,
        width,
        height,
        wrapMode: attrs.wrapMode,
        zIndex: attrs.zIndex,
        margin: attrs.margin,
        anchorY: block.y,
        ...(atOffset !== block.y + attrs.yOffset ? { clamped: true } : {}),
      };
      if (wrapsText(float)) {
        // A top-and-bottom image takes the whole width, so it can only move below.
        const contentRight = box.contentX + box.contentWidth;
        const reach = (f: RegionFloat) => f.wrapMode === "top-bottom" ? { ...f, x: box.contentX, width: box.contentWidth } : f;
        const spot = clearOfEarlier(reach(float), floats.filter(wrapsText).map(reach), box.contentX, contentRight, ANCHORED_OBJECT_MARGIN);
        if (float.wrapMode === "square") float.x = spot.x;
        if (spot.y > float.y) float.stackOffset = spot.y - float.y;
        float.y = spot.y;
      }
      floats.push(float);
    }
  }
  return floats;
}

/**
 * The region's lines asked against its wrapping images, answered for the box a
 * block lays its text in (an indented block's is narrower than the region).
 */
function wrapAround(floats: readonly RegionFloat[], box: RegionBox): (x: number, width: number) => LineSpaceProvider {
  const exclusions = new ExclusionManager();
  for (const f of floats) {
    // As in the body, the margin band never reaches above the image's own
    // paragraph: the blocks above fix where that paragraph starts, so letting
    // the band move them makes the image chase its own anchor.
    const top = Math.max(box.top, f.y - f.margin, Math.min(f.y, f.anchorY));
    const bottom = f.y + f.height + f.margin;
    if (f.wrapMode === "square") {
      exclusions.addRect({ page: 1, x: f.x - f.margin, right: f.x + f.width + f.margin, y: top, bottom, side: "left", docPos: f.docPos });
    } else if (f.wrapMode === "top-bottom") {
      exclusions.addFullWidthRect({ page: 1, y: top, bottom, contentX: box.contentX, contentWidth: box.contentWidth, docPos: f.docPos });
    }
  }
  return (x, width) => (lineY, lineHeight = 1) => {
    const space = exclusions.getAvailableSegments(1, lineY, lineHeight, x, width);
    const segments = space.segments.map((seg) => ({ x: seg.x - x, width: seg.width }));
    if (segments.length === 0 && space.skipToY === undefined) {
      return { segments, skipToY: exclusions.getNextFreeY(1, lineY, lineHeight, x, width) };
    }
    return space.skipToY !== undefined ? { segments, skipToY: space.skipToY } : { segments };
  };
}
