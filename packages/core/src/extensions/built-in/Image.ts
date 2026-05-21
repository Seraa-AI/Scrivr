import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import type { InlineStrategy } from "../../layout/BlockRegistry";
import type { IEditor } from "../types";
import type { Node as PmNode } from "prosemirror-model";
import type { ResolvedTheme } from "../../model/theme";
import { safeUrl } from "../../model/safeUrl";
import { getNodeAttrs } from "../../model/getNodeAttrs";
import { imageDocxContribution } from "./Image.docx";

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
  img.onerror = () => {
    imageCache.set(src, "error");
  };
  img.crossOrigin = "anonymous";
  img.src = src;
  return null;
}

// ── Per-instance state ────────────────────────────────────────────────────────

interface InstanceState {
  cleanup: () => void;
}
const instanceState = new WeakMap<object, InstanceState>();

// ── Inline image strategy ─────────────────────────────────────────────────────

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
      theme: ResolvedTheme,
    ): void {
      // Zero-size anchor spans for floating images — nothing to draw.
      if (width <= 0 || height <= 0) return;

      const src = node.attrs["src"] as string | undefined;
      const alt = (node.attrs["alt"] as string | undefined) ?? "";

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
          drawPlaceholder(ctx, x, y, width, height, alt || "Loading…", theme);
        }
      } else {
        drawPlaceholder(ctx, x, y, width, height, "Image", theme);
      }

      ctx.strokeStyle = theme.imagePlaceholderBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, width, height);

      ctx.restore();
    },
  };
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  theme: ResolvedTheme,
): void {
  ctx.fillStyle = theme.imagePlaceholderBg;
  ctx.fillRect(x, y, w, h);

  const cx = x + w / 2;
  const cy = y + h / 2 - 10;
  const r = Math.min(20, h / 6);
  ctx.fillStyle = theme.imagePlaceholderText;
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

    const raw = window.prompt("Image URL:", "https://");
    // Ingestion-time URL validation — see model/safeUrl.ts. Rejects
    // javascript:, data:, vbscript:, file:, and any non-allowlisted
    // scheme before the node lands in the document.
    const src = safeUrl(raw);
    if (src === null) return false;

    // Insert inline at the current cursor position (inside the paragraph)
    const node = imageType.create({ src, alt: "" });
    const tr = state.tr.replaceSelectionWith(node).scrollIntoView();
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
          src: { default: "" },
          alt: { default: "" },
          width: { default: 200 },
          height: { default: 200 },
          nodeId: { default: null },
          /** Vertical alignment within the line box — matches InlineObjectVerticalAlign */
          verticalAlign: { default: "baseline" },
          // ── Anchored-object attrs (current model) ─────────────────────────
          // See docs/anchored-objects/00-model.md.
          /** `inline | square | top-bottom | behind | front` */
          wrapMode: { default: "inline" },
          /** v1 supports `move-with-text` only */
          positionMode: { default: "move-with-text" },
          /** `left | center | right | custom` */
          xAlign: { default: "left" },
          /** Custom horizontal X (content-area-relative px); used when xAlign === "custom" */
          x: { default: null },
          /** Vertical placement delta from anchor's globalY (px). Painted top = anchor.globalY + yOffset. */
          yOffset: { default: 0 },
          /** Paint/hit-test stacking order among anchored objects. */
          zIndex: { default: 0 },
          /** Wrap-zone breathing room in px (Word's ~0.13" Square default). */
          margin: { default: 12 },
          // ── Legacy attrs (read-side compat — see normalizeImageAttrs) ────
          /** @deprecated — replaced by `wrapMode` + `xAlign`. Mapped on read. */
          wrappingMode: { default: "inline" },
          /** @deprecated — `floatOffset.y` is read-side mapped to `yOffset` by normalizeImageAttrs. */
          floatOffset: { default: { x: 0, y: 0 } },
        },
        parseDOM: [
          {
            tag: "img[src]",
            getAttrs(dom) {
              // dom is typed as `Node | string` from ProseMirror; narrow via
              // `instanceof Element` so we can call getAttribute without a cast.
              if (!(dom instanceof Element)) return false;
              // Ingestion-time URL validation — see model/safeUrl.ts.
              // Reject the entire image node on unsafe src (returning false
              // from getAttrs drops the matched element) rather than store
              // a node that paints nothing or, worse, navigates somewhere
              // dangerous when a future DOM mirror renders it.
              const src = safeUrl(dom.getAttribute("src"));
              if (src === null) return false;
              return {
                src,
                alt: dom.getAttribute("alt") ?? "",
                width: dom.getAttribute("width")
                  ? parseInt(dom.getAttribute("width")!)
                  : 200,
                height: dom.getAttribute("height")
                  ? parseInt(dom.getAttribute("height")!)
                  : 200,
              };
            },
          },
        ],
        toDOM(node) {
          const { src, alt, width, height } = getNodeAttrs(node, "image");
          return [
            "img",
            { src, alt, width: String(width), height: String(height) },
          ];
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

  onViewReady(editor: IEditor) {
    // View-only: when an `<img>` load fires, request a repaint so the
    // image swaps in. Headless editors don't run this hook at all.
    const cb = () => editor.redraw();
    redrawCallbacks.add(cb);
    const state: InstanceState = { cleanup: () => redrawCallbacks.delete(cb) };
    instanceState.set(this.options, state);
    return () => state.cleanup();
  },

  addToolbarItems() {
    // When the wrap-mode picker (Square / Top-Bottom / Behind / Front / Inline)
    // lands here, the Square entry's tooltip must read:
    //   "Text wraps around the image's exclusion rectangle. Current line layout uses one side at a time."
    // Spec: docs/anchored-objects/04-edit-ux.md § Wrap-segment hint (Square only).
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

  addExports() {
    // DOCX contribution lives next to the extension — see Image.docx.ts.
    // Other formats register their handlers here too as they come online.
    return { docx: imageDocxContribution };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        image(state, node) {
          const { src, alt } = getNodeAttrs(node, "image");
          state.write(`![${alt ?? ""}](${src})`);
          state.closeBlock(node);
        },
      },
    };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    image: {
      /** Open the system file picker and insert an image at the cursor. */
      insertImage: () => ReturnType;
    };
  }
  interface NodeAttributes {
    image: {
      src: string;
      alt: string;
      width: number;
      height: number;
      nodeId: string | null;
      verticalAlign: string;
      wrapMode: string;
      positionMode: string;
      xAlign: string;
      x: number | null;
      yOffset: number;
      zIndex: number;
      margin: number;
      /** @deprecated read-side compat — mapped by normalizeImageAttrs */
      wrappingMode: string;
      /** @deprecated read-side compat — mapped by normalizeImageAttrs */
      floatOffset: { x: number; y: number };
    };
  }
}
