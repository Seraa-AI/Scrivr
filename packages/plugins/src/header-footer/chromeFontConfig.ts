/**
 * Font config for chrome bands (headers/footers) — zero paragraph spacing.
 * Shared by resolveChrome (measure) and drawPageChrome (paint).
 */

import { defaultFontConfig, type FontConfig } from "@scrivr/core";

const baseParagraph = defaultFontConfig["paragraph"];

export const chromeFontConfig: FontConfig = {
  ...defaultFontConfig,
  ...(baseParagraph ? {
    paragraph: {
      font: baseParagraph.font,
      align: baseParagraph.align,
      spaceBefore: 0,
      spaceAfter: 0,
    },
  } : {}),
};
