/**
 * Default PDF export handlers for the core schema.
 * These cover all built-in node and mark types. Extensions only need to
 * handle their own custom types — core schema is covered here.
 */

import { rgb } from "pdf-lib";
import type { PdfMarkHandler, PdfNodeHandler } from "./augmentation";
import type { PdfContext } from "./context";
import { PT_PER_PX, parseHexColor } from "./context";

export const defaultNodeHandlers: Record<string, PdfNodeHandler> = {
  paragraph: (block, ctx) => {
    ctx.draw.lines(block, ctx);
  },

  heading: (block, ctx) => {
    ctx.draw.lines(block, ctx);
  },

  bulletList: (block, ctx) => {
    ctx.draw.lines(block, ctx);
  },

  orderedList: (block, ctx) => {
    ctx.draw.lines(block, ctx);
  },

  listItem: (block, ctx) => {
    ctx.draw.lines(block, ctx);
  },

  codeBlock: (block, ctx) => {
    ctx.draw.lines(block, ctx);
  },

  horizontalRule: (block, ctx) => {
    const midY = block.y + block.height / 2;
    const x1 = block.x * PT_PER_PX;
    const x2 = (block.x + block.availableWidth) * PT_PER_PX;
    const pageHeightPt = ctx.layout.pageConfig.pageHeight * PT_PER_PX;
    const y = pageHeightPt - midY * PT_PER_PX;
    ctx.page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness: 1.5 * PT_PER_PX,
      color: rgb(0.796, 0.835, 0.882), // #cbd5e1
    });
  },

  image: (block, ctx) => {
    const src = block.node.attrs["src"] as string | undefined;
    const image = src ? ctx.images.get(src) ?? null : null;
    if (image) {
      ctx.draw.image(image, {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
      });
    } else {
      ctx.draw.imagePlaceholder({
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
      });
    }
  },
};

/**
 * Default mark handlers are not used for M2 — mark decoration logic stays in
 * draw.lines() for exact backward compatibility. Mark handlers will be wired
 * in when extensions need to contribute custom mark rendering. Exported empty
 * for forward compatibility.
 */
/**
 * What the built-in marks do to a span.
 *
 * These live here rather than on their extensions only until each one declares
 * its own lane; the shapes are what an extension would return.
 */
export const defaultMarkHandlers: Record<string, PdfMarkHandler> = {
  color: (mark) => {
    const value = mark.attrs["color"];
    return typeof value === "string" ? { color: value } : {};
  },

  // Blue because it is a link, not because anyone picked blue — so a colour
  // mark on the same span wins for the text. The underline stays link-blue
  // either way, which is what the canvas draws.
  link: (_mark, ctx) => ({
    defaultColor: ctx.theme.link,
    underline: true,
    underlineColor: ctx.theme.link,
  }),

  underline: () => ({ underline: true }),

  strikethrough: () => ({ strikethrough: true }),

  highlight: (mark) => ({
    backgroundColor: {
      color: typeof mark.attrs["color"] === "string" ? mark.attrs["color"] : "#fef08a",
      opacity: 0.4,
    },
  }),
};
