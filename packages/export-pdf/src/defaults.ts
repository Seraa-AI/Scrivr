/**
 * Default PDF export handlers for the core schema.
 * These cover all built-in node and mark types. Extensions only need to
 * handle their own custom types — core schema is covered here.
 */

import { rgb } from "pdf-lib";
import type { PdfNodeHandler } from "./augmentation";
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
export const defaultMarkHandlers: Record<string, never> = {};
