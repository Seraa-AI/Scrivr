import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import type { InlineStrategy } from "../../layout/BlockRegistry";
import type { IEditor } from "../types";
import type { Node as PmNode } from "prosemirror-model";
import type { ResolvedTheme } from "../../model/theme";
import { safeUrl } from "../../model/safeUrl";
import { getNodeAttrs } from "../../model/getNodeAttrs";
import {
  el,
  pxToEmu,
  type DocxContextShape,
  type DocxNodeHandlerShape,
  type XmlNode,
} from "./exports/docx-shared";

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

// ── DOCX export ───────────────────────────────────────────────────────────────
//
// Pipeline:
//   onBeforeExport — async — walks the doc, fetches unique image srcs,
//     registers media + rels via ctx, stores Map<src, ImageRecord> under
//     `ctx.shared["docx:images"]`.
//   nodes.image — sync — reads the record and emits <w:drawing> with
//     <wp:inline> (inline mode) or <wp:anchor> (the four float modes).
//
// Wrap-mode mapping (Scrivr → OOXML):
//   inline      → <wp:inline> (atom inside <w:r>)
//   square      → <wp:anchor> + <wp:wrapSquare wrapText="bothSides"/>
//   top-bottom  → <wp:anchor> + <wp:wrapTopAndBottom/>
//   behind      → <wp:anchor behindDoc="1"> + <wp:wrapNone/>
//   front       → <wp:anchor behindDoc="0"> + <wp:wrapNone/>

interface SniffedFormat {
  contentType: string;
  ext: string;
}

function sniffImageContentType(bytes: Uint8Array): SniffedFormat {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { contentType: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { contentType: "image/gif", ext: "gif" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", ext: "webp" };
  }
  return { contentType: "image/png", ext: "png" };
}

async function fetchImageBytes(src: string): Promise<Uint8Array | null> {
  try {
    if (src.startsWith("data:")) {
      const idx = src.indexOf(",");
      if (idx < 0) return null;
      const meta = src.slice(0, idx);
      const payload = src.slice(idx + 1);
      if (meta.endsWith(";base64")) {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      return new TextEncoder().encode(decodeURIComponent(payload));
    }
    const res = await fetch(src);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

interface DocxImageRecord {
  src: string;
  relId: string;
  filename: string;
  width: number;
  height: number;
}

type DocxImageMap = Map<string, DocxImageRecord>;
const DOCX_IMAGES_KEY = "docx:images";

function readPositiveInt(raw: unknown, fallback: number): number {
  return typeof raw === "number" && raw > 0 ? Math.round(raw) : fallback;
}

function readString(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function collectImageSrcs(doc: PmNode): string[] {
  const seen = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "image") {
      const src = readString(node.attrs["src"]);
      if (src) seen.add(src);
    }
  });
  return Array.from(seen);
}

async function imageOnBeforeDocxExport(ctx: DocxContextShape): Promise<void> {
  const doc = ctx.editor.getState().doc;
  const srcs = collectImageSrcs(doc);
  if (srcs.length === 0) return;

  const map = ctx.shared.getOrInit<DocxImageMap>(DOCX_IMAGES_KEY, () => new Map());
  const DEFAULT_WIDTH = 200;
  const DEFAULT_HEIGHT = 200;

  await Promise.all(
    srcs.map(async (src) => {
      if (map.has(src)) return;
      const bytes = await fetchImageBytes(src);
      if (!bytes) {
        ctx.diagnostics.warn({
          code: "image-fetch-failed",
          message: `Could not fetch image: ${src}`,
          nodeType: "image",
        });
        return;
      }
      const { contentType, ext } = sniffImageContentType(bytes);
      const filename = ctx.media.add({ data: bytes, contentType, ext });
      const relId = ctx.rels.addImage(filename);
      map.set(src, { src, relId, filename, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
    }),
  );
}

const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";

let nextDocPrId = 1;
function nextDocxPicId(): string {
  return String(nextDocPrId++);
}

function buildPicGraphic(
  filename: string, relId: string, widthPx: number, heightPx: number,
): XmlNode {
  const cx = String(pxToEmu(widthPx));
  const cy = String(pxToEmu(heightPx));
  return el("a:graphic", { "xmlns:a": NS_A }, [
    el("a:graphicData", { uri: NS_PIC }, [
      el("pic:pic", { "xmlns:pic": NS_PIC }, [
        el("pic:nvPicPr", undefined, [
          el("pic:cNvPr", { id: "0", name: filename }),
          el("pic:cNvPicPr"),
        ]),
        el("pic:blipFill", undefined, [
          el("a:blip", { "r:embed": relId }),
          el("a:stretch", undefined, [el("a:fillRect")]),
        ]),
        el("pic:spPr", undefined, [
          el("a:xfrm", undefined, [
            el("a:off", { x: "0", y: "0" }),
            el("a:ext", { cx, cy }),
          ]),
          el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
        ]),
      ]),
    ]),
  ]);
}

function buildInlineDrawing(
  filename: string, relId: string, widthPx: number, heightPx: number,
): XmlNode {
  const cx = String(pxToEmu(widthPx));
  const cy = String(pxToEmu(heightPx));
  const id = nextDocxPicId();
  return el("w:drawing", undefined, [
    el("wp:inline", { "xmlns:wp": NS_WP, distT: "0", distB: "0", distL: "0", distR: "0" }, [
      el("wp:extent", { cx, cy }),
      el("wp:effectExtent", { l: "0", t: "0", r: "0", b: "0" }),
      el("wp:docPr", { id, name: `Picture ${id}` }),
      el("wp:cNvGraphicFramePr", undefined, [
        el("a:graphicFrameLocks", { "xmlns:a": NS_A, noChangeAspect: "1" }),
      ]),
      buildPicGraphic(filename, relId, widthPx, heightPx),
    ]),
  ]);
}

interface AnchorAttrs {
  wrapMode: string;
  xAlign: string;
  xCustom?: number;
  yOffset: number;
  marginPx: number;
}

function buildAnchoredDrawing(
  filename: string, relId: string, widthPx: number, heightPx: number, anchor: AnchorAttrs,
): XmlNode {
  const cx = String(pxToEmu(widthPx));
  const cy = String(pxToEmu(heightPx));
  const id = nextDocxPicId();
  const marginEmu = String(pxToEmu(anchor.marginPx));
  const behindDoc = anchor.wrapMode === "behind" ? "1" : "0";

  const positionH = ((): XmlNode => {
    if (typeof anchor.xCustom === "number") {
      return el("wp:positionH", { relativeFrom: "column" }, [
        el("wp:posOffset", undefined, [String(pxToEmu(anchor.xCustom))]),
      ]);
    }
    const align =
      anchor.xAlign === "center" ? "center" :
      anchor.xAlign === "right"  ? "right"  :
      "left";
    return el("wp:positionH", { relativeFrom: "column" }, [
      el("wp:align", undefined, [align]),
    ]);
  })();

  const positionV = el("wp:positionV", { relativeFrom: "paragraph" }, [
    el("wp:posOffset", undefined, [String(pxToEmu(anchor.yOffset))]),
  ]);

  const wrapEl = ((): XmlNode => {
    if (anchor.wrapMode === "square") return el("wp:wrapSquare", { wrapText: "bothSides" });
    if (anchor.wrapMode === "top-bottom") return el("wp:wrapTopAndBottom");
    return el("wp:wrapNone");
  })();

  return el("w:drawing", undefined, [
    el(
      "wp:anchor",
      {
        "xmlns:wp": NS_WP,
        distT: marginEmu, distB: marginEmu, distL: marginEmu, distR: marginEmu,
        simplePos: "0", relativeHeight: "0", behindDoc,
        locked: "0", layoutInCell: "1", allowOverlap: "1",
      },
      [
        el("wp:simplePos", { x: "0", y: "0" }),
        positionH,
        positionV,
        el("wp:extent", { cx, cy }),
        el("wp:effectExtent", { l: "0", t: "0", r: "0", b: "0" }),
        wrapEl,
        el("wp:docPr", { id, name: `Picture ${id}` }),
        el("wp:cNvGraphicFramePr", undefined, [
          el("a:graphicFrameLocks", { "xmlns:a": NS_A, noChangeAspect: "1" }),
        ]),
        buildPicGraphic(filename, relId, widthPx, heightPx),
      ],
    ),
  ]);
}

const imageDocxHandler: DocxNodeHandlerShape = (node, _children, ctx) => {
  const src = readString(node.attrs["src"]);
  if (!src) {
    ctx.diagnostics.warn({
      code: "image-no-src",
      message: "Image node has no src — dropping",
      nodeType: "image",
    });
    return [];
  }

  const map = ctx.shared.get<DocxImageMap>(DOCX_IMAGES_KEY);
  const record = map?.get(src);
  if (!record) return []; // fetch already recorded its own diagnostic

  const width = readPositiveInt(node.attrs["width"], record.width);
  const height = readPositiveInt(node.attrs["height"], record.height);
  const wrapMode = readString(node.attrs["wrapMode"]) ?? "inline";

  if (wrapMode === "inline") {
    return el("w:r", undefined, [
      buildInlineDrawing(record.filename, record.relId, width, height),
    ]);
  }

  const anchor: AnchorAttrs = {
    wrapMode,
    xAlign: readString(node.attrs["xAlign"]) ?? "left",
    yOffset: typeof node.attrs["yOffset"] === "number" ? node.attrs["yOffset"] : 0,
    marginPx: typeof node.attrs["margin"] === "number" ? node.attrs["margin"] : 12,
  };
  if (typeof node.attrs["x"] === "number") anchor.xCustom = node.attrs["x"];

  return el("w:r", undefined, [
    buildAnchoredDrawing(record.filename, record.relId, width, height, anchor),
  ]);
};

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
    return {
      docx: {
        onBeforeExport: imageOnBeforeDocxExport,
        nodes: { image: imageDocxHandler },
      },
    };
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
