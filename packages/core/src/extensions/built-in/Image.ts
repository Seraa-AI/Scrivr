import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import type { BlockStrategy, BlockRenderContext } from "../../layout/BlockRegistry";
import type { CharacterMap } from "../../layout/CharacterMap";
import type { LayoutBlock } from "../../layout/BlockLayout";
import type { IEditor } from "../types";

// ── Image cache ───────────────────────────────────────────────────────────────

type CacheEntry = HTMLImageElement | "loading" | "error";
const imageCache = new Map<string, CacheEntry>();
const redrawCallbacks = new Set<() => void>();

function getCachedImage(src: string): HTMLImageElement | null {
  const entry = imageCache.get(src);
  if (entry instanceof HTMLImageElement) return entry;
  if (entry === "loading" || entry === "error") return null;

  // Start loading
  imageCache.set(src, "loading");
  const img = new globalThis.Image();
  img.onload = () => {
    imageCache.set(src, img);
    redrawCallbacks.forEach((cb) => cb());
  };
  img.onerror = () => { imageCache.set(src, "error"); };
  img.crossOrigin = "anonymous";
  img.src = src;
  return null;
}

// ── Per-instance state (editor redraw hook) ───────────────────────────────────

interface InstanceState { cleanup: () => void }
const instanceState = new WeakMap<object, InstanceState>();

// ── ImageStrategy ─────────────────────────────────────────────────────────────

const PLACEHOLDER_BG     = "#f1f5f9";
const PLACEHOLDER_BORDER = "#e2e8f0";
const PLACEHOLDER_TEXT   = "#94a3b8";

function createImageStrategy(): BlockStrategy {
  return {
    render(block: LayoutBlock, renderCtx: BlockRenderContext, _map: CharacterMap): number {
      const { ctx } = renderCtx;
      const { x, y, availableWidth, height, node } = block;

      const src     = node.attrs["src"]   as string | undefined;
      const alt     = node.attrs["alt"]   as string | undefined ?? "";
      const attrW   = node.attrs["width"] as number | undefined;
      const drawW   = (attrW && attrW > 0) ? Math.min(attrW, availableWidth) : availableWidth;
      const drawH   = height;
      const drawX   = x + (availableWidth - drawW) / 2; // center if narrower than page

      ctx.save();

      if (src) {
        const img = getCachedImage(src);
        if (img) {
          // Draw image, maintaining aspect ratio via object-fit: contain
          const scale  = Math.min(drawW / img.naturalWidth, drawH / img.naturalHeight);
          const sw     = img.naturalWidth  * scale;
          const sh     = img.naturalHeight * scale;
          const sx     = drawX + (drawW - sw) / 2;
          const sy     = y    + (drawH - sh) / 2;
          ctx.drawImage(img, sx, sy, sw, sh);
        } else {
          // Loading / error placeholder
          drawPlaceholder(ctx, drawX, y, drawW, drawH, alt || "Loading…");
        }
      } else {
        // No src — empty placeholder
        drawPlaceholder(ctx, drawX, y, drawW, drawH, "Image");
      }

      // Thin border around the image area
      ctx.strokeStyle = PLACEHOLDER_BORDER;
      ctx.lineWidth   = 1;
      ctx.strokeRect(drawX, y, drawW, drawH);

      ctx.restore();

      // Charmap registration is handled by populateCharMap — nothing to do here.
      return renderCtx.lineIndexOffset + 1;
    },
  };
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
): void {
  ctx.fillStyle = PLACEHOLDER_BG;
  ctx.fillRect(x, y, w, h);

  // Mountain icon (simple triangle)
  const cx = x + w / 2;
  const cy = y + h / 2 - 10;
  const r  = Math.min(20, h / 6);
  ctx.fillStyle = PLACEHOLDER_TEXT;
  ctx.beginPath();
  ctx.arc(cx - r * 0.4, cy - r * 0.3, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.2, cy + r * 0.8);
  ctx.lineTo(cx, cy - r * 0.8);
  ctx.lineTo(cx + r * 1.2, cy + r * 0.8);
  ctx.closePath();
  ctx.fill();

  // Label
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 18, w - 16);
}

// ── Insert command ────────────────────────────────────────────────────────────

function insertImage(): Command {
  return (state, dispatch) => {
    const imageType = state.schema.nodes["image"];
    if (!imageType) return false;

    if (!dispatch) return true;

    const src = window.prompt("Image URL:", "https://");
    if (!src) return false;

    const { $head } = state.selection;
    const after = $head.after(1);
    const node  = imageType.create({ src, alt: "" }); // width and height use schema defaults (null → full width, 200px tall)
    const tr    = state.tr.insert(after, node).scrollIntoView();
    dispatch(tr);
    return true;
  };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const Image = Extension.create({
  name: "image",

  addNodes() {
    return {
      image: {
        group: "block",
        attrs: {
          src:    { default: "" },
          alt:    { default: "" },
          width:  { default: null },
          height: { default: 200 },
          nodeId: { default: null },
        },
        parseDOM: [
          {
            tag: "img[src]",
            getAttrs(dom) {
              const el = dom as HTMLImageElement;
              return {
                src:    el.getAttribute("src") ?? "",
                alt:    el.getAttribute("alt") ?? "",
                width:  el.getAttribute("width")  ? parseInt(el.getAttribute("width")!)  : null,
                height: el.getAttribute("height") ? parseInt(el.getAttribute("height")!) : 200,
              };
            },
          },
        ],
        toDOM(node) {
          const { src, alt, width, height } = node.attrs as {
            src: string; alt: string; width: number | null; height: number | null;
          };
          const attrs: Record<string, string> = { src, alt };
          if (width)  attrs["width"]  = String(width);
          if (height) attrs["height"] = String(height);
          return ["img", attrs];
        },
      },
    };
  },

  addCommands() {
    return { insertImage: () => insertImage() };
  },

  addBlockStyles() {
    return {
      image: {
        font: "16px sans-serif",
        spaceBefore: 8,
        spaceAfter:  8,
        align: "left" as const,
      },
    };
  },

  addLayoutHandlers() {
    return { image: createImageStrategy() };
  },

  onEditorReady(editor: IEditor) {
    const cb = () => editor.redraw();
    redrawCallbacks.add(cb);
    const state: InstanceState = { cleanup: () => redrawCallbacks.delete(cb) };
    instanceState.set(this.options, state);
    return () => state.cleanup();
  },

  addToolbarItems() {
    return [
      {
        command: "insertImage",
        label: "🖼",
        title: "Insert image",
        group: "insert",
        isActive: () => false,
      },
    ];
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        image(state, node) {
          const { src, alt } = node.attrs as { src: string; alt: string };
          state.write(`![${alt ?? ""}](${src})`);
          state.closeBlock(node);
        },
      },
    };
  },
});
