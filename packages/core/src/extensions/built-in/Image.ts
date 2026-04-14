import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import type { InlineStrategy } from "../../layout/BlockRegistry";
import type { IEditor } from "../types";
import type { Node as PmNode } from "prosemirror-model";

// ── Image cache ───────────────────────────────────────────────────────────────

type CacheEntry = HTMLImageElement | "loading" | "error";
const imageCache = new Map<string, CacheEntry>();
const redrawCallbacks = new Set<() => void>();

function getCachedImage(src: string): HTMLImageElement | null {
  const entry = imageCache.get(src);
  if (entry instanceof HTMLImageElement) return entry;
  if (entry === "loading" || entry === "error") return null;

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

// ── Per-instance state ────────────────────────────────────────────────────────

interface InstanceState { cleanup: () => void }
const instanceState = new WeakMap<object, InstanceState>();

// ── Inline image strategy ─────────────────────────────────────────────────────

const PLACEHOLDER_BG     = "#f1f5f9";
const PLACEHOLDER_BORDER = "#e2e8f0";
const PLACEHOLDER_TEXT   = "#94a3b8";

function createInlineImageStrategy(): InlineStrategy {
  return {
    verticalAlign: "baseline" as const,
    render(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      node: PmNode,
    ): void {
      // Zero-size anchor spans for floating images — nothing to draw.
      if (width <= 0 || height <= 0) return;

      const src = node.attrs["src"] as string | undefined;
      const alt = node.attrs["alt"] as string | undefined ?? "";

      ctx.save();

      if (src) {
        const img = getCachedImage(src);
        if (img) {
          // Draw the image stretched to fill the exact box dimensions.
          // For inline images the box matches attrs.width × attrs.height.
          // For floats the box comes from FloatLayout (e.g. full content
          // width for break mode), so the image fills the full area.
          ctx.drawImage(img, x, y, width, height);
        } else {
          drawPlaceholder(ctx, x, y, width, height, alt || "Loading…");
        }
      } else {
        drawPlaceholder(ctx, x, y, width, height, "Image");
      }

      ctx.strokeStyle = PLACEHOLDER_BORDER;
      ctx.lineWidth   = 1;
      ctx.strokeRect(x, y, width, height);

      ctx.restore();
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

    // Insert inline at the current cursor position (inside the paragraph)
    const node = imageType.create({ src, alt: "" });
    const tr   = state.tr.replaceSelectionWith(node).scrollIntoView();
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
        inline: true,
        group: "inline",
        attrs: {
          src:    { default: "" },
          alt:    { default: "" },
          width:  { default: 200 },
          height: { default: 200 },
          nodeId: { default: null },
          /** Vertical alignment within the line box — matches InlineObjectVerticalAlign */
          verticalAlign: { default: "baseline" },
          /** Text wrapping mode: 'inline' | 'square-left' | 'square-right' | 'top-bottom' | 'behind' | 'front' */
          wrappingMode: { default: "inline" },
          /** Float offset relative to the anchor paragraph origin { x, y } in px */
          floatOffset: { default: { x: 0, y: 0 } },
        },
        parseDOM: [
          {
            tag: "img[src]",
            getAttrs(dom) {
              const el = dom as HTMLImageElement;
              return {
                src:    el.getAttribute("src") ?? "",
                alt:    el.getAttribute("alt") ?? "",
                width:  el.getAttribute("width")  ? parseInt(el.getAttribute("width")!)  : 200,
                height: el.getAttribute("height") ? parseInt(el.getAttribute("height")!) : 200,
              };
            },
          },
        ],
        toDOM(node) {
          const { src, alt, width, height } = node.attrs as {
            src: string; alt: string; width: number; height: number;
          };
          return ["img", { src, alt, width: String(width), height: String(height) }];
        },
      },
    };
  },

  addCommands() {
    return { insertImage: () => insertImage() };
  },

  addInlineHandlers() {
    return { image: createInlineImageStrategy() };
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
