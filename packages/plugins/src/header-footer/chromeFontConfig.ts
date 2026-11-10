/**
 * Font config for chrome bands (headers/footers): the editor's block styles,
 * with a paragraph's spacing dropped. Measured with in resolveChrome and
 * carried on its payload, so a band re-laid out while it is edited is styled
 * as it was measured.
 */

import type { FontConfig } from "@scrivr/core";

export function chromeFontConfigOf(config: FontConfig): FontConfig {
  const paragraph = config["paragraph"];
  return {
    ...config,
    ...(paragraph ? { paragraph: { ...paragraph, spaceBefore: 0, spaceAfter: 0 } } : {}),
  };
}
