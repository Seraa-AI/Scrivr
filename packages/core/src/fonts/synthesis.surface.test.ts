/**
 * The font-synthesis surface, consumed the way a package outside core does.
 *
 * Imported from the barrel rather than by relative path, because a relative
 * import proves the module exists and nothing about whether anyone can reach
 * it. `@scrivr/export-pdf` reads these to draw the same stand-in the canvas
 * draws; drop one from the export list and this file stops compiling.
 */

import { describe, it, expect } from "vitest";
import {
  SYNTHETIC_ITALIC_SHEAR,
  emboldenWidth,
  drawBlock,
  type BlockRenderContext,
  type FontFamilyOption,
  type FontKey,
  type FontResolution,
  type FontResolutionId,
  type FontSynthesis,
  type RenderPageOptions,
} from "../index";

describe("what a consumer can reach", () => {
  it("names every type the synthesis surface is described in", () => {
    const gap: FontSynthesis = { weight: { from: 400, to: 700 } };
    const face: FontKey = { family: "Inter", weight: 400, style: "normal" };
    const option: FontFamilyOption = { family: "Inter", faces: [face], portable: true };
    const table: ReadonlyMap<FontResolutionId, FontResolution> = new Map();

    // The two option types that carry the table to a renderer.
    const page: Pick<RenderPageOptions, "fontResolutions"> = { fontResolutions: table };
    const block: Pick<BlockRenderContext, "fontResolutions"> = { fontResolutions: table };

    expect(emboldenWidth(gap, 16)).toBeGreaterThan(0);
    expect(SYNTHETIC_ITALIC_SHEAR).toBeGreaterThan(0);
    expect(option.faces).toHaveLength(1);
    expect(page.fontResolutions).toBe(block.fontResolutions);
  });

  it("lets a caller supply drawBlock's font table without reaching past the barrel", () => {
    // The tenth parameter is only useful if its type is nameable here.
    const table: ReadonlyMap<FontResolutionId, FontResolution> = new Map();
    const call: Parameters<typeof drawBlock>[9] = table;

    expect(call).toBe(table);
  });
});
