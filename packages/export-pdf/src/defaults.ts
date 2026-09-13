/**
 * Default PDF export handlers for the core schema.
 * These cover all built-in node and mark types. Extensions only need to
 * handle their own custom types — core schema is covered here.
 */

import type { PdfNodeHandler } from "./augmentation";
import type { PdfMarkHandler } from "@scrivr/core";

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
    const y = block.y + block.height / 2;
    ctx.draw.line({
      from: { x: block.x, y },
      to: { x: block.x + block.availableWidth, y },
      thicknessPx: 1.5,
      color: { r: 203, g: 213, b: 225 },
    });
  },
  image: (block, ctx) => {
    const src = block.node.attrs["src"];
    const box = { x: block.x, y: block.y, width: block.width, height: block.height };
    if (typeof src === "string") {
      ctx.draw.image({ ...box, image: { src } });
    } else {
      ctx.draw.imagePlaceholder(box);
    }
  },
};

/**
 * No built-in mark styling lives here. Each mark is declared by the extension
 * that defines it, so a kit without Highlight has no highlight to render and
 * nothing here pretending otherwise.
 */
export const defaultMarkHandlers: Record<string, PdfMarkHandler> = {};
