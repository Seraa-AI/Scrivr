/**
 * DOCX export contribution for the `image` node — lives next to Image.ts
 * because the extension owns its export shape.
 *
 * Uses LOCAL type stand-ins instead of importing from @scrivr/export-docx.
 * Keeping the dependency direction one-way (export-docx → core) avoids a
 * runtime cycle. The structural shapes below mirror DocxContext, XmlNode,
 * and DocxNodeHandler closely enough that the contract is honored when
 * export-docx invokes these handlers. The integration test in
 * @scrivr/export-docx asserts that contract.
 *
 * Pipeline:
 *   onBeforeExport — async — walks the doc, fetches unique image srcs,
 *     registers media + rels via the ctx registries, stores a Map<src,
 *     ImageRecord> under `ctx.shared.docx:images`.
 *   nodes.image — sync — reads the record and emits `<w:drawing>` with
 *     `<wp:inline>` (inline mode) or `<wp:anchor>` (the four float modes).
 *
 * Wrap-mode mapping (Scrivr → OOXML):
 *   inline      → <wp:inline> (no wrap — atom inside <w:r>)
 *   square      → <wp:anchor> + <wp:wrapSquare wrapText="bothSides"/>
 *   top-bottom  → <wp:anchor> + <wp:wrapTopAndBottom/>
 *   behind      → <wp:anchor behindDoc="1"> + <wp:wrapNone/>
 *   front       → <wp:anchor behindDoc="0"> + <wp:wrapNone/>
 *
 * Unit notes:
 *   1 inch  = 914400 EMU
 *   1 px @ 96 DPI = 9525 EMU   → pxToEmu(px) = round(px × 9525)
 */

import type { Node as PmNode } from "prosemirror-model";

// ── Local structural types — match @scrivr/export-docx at runtime ────────────

type XmlAttrs = Record<string, string>;

interface XmlNode {
  name: string;
  attributes?: XmlAttrs;
  children?: Array<XmlNode | string>;
}

type XmlChild = XmlNode | string;

interface DocxContextShape {
  editor: { getState(): { doc: PmNode } };
  rels: { addImage(mediaFilename: string): string };
  media: {
    add(input: { data: Uint8Array; contentType: string; ext: string }): string;
  };
  shared: {
    getOrInit<T>(key: string, init: () => T): T;
    get<T>(key: string): T | undefined;
  };
  diagnostics: {
    warn(d: { code: string; message: string; pos?: number; nodeType?: string }): void;
    error(d: { code: string; message: string; pos?: number; nodeType?: string }): void;
  };
}

type ImageNodeHandler = (
  node: PmNode,
  children: XmlNode[],
  ctx: DocxContextShape,
  meta: { inline: boolean },
) => XmlNode | XmlNode[];

// ── Unit + format helpers ────────────────────────────────────────────────────

const EMU_PER_PX = 9525;

function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

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

// ── Local XML builder (clone of xml() in @scrivr/export-docx) ───────────────

function el(name: string, attrs?: XmlAttrs, children?: XmlChild[]): XmlNode {
  const node: XmlNode = { name };
  if (attrs && Object.keys(attrs).length > 0) node.attributes = attrs;
  if (children && children.length > 0) node.children = children;
  return node;
}

// ── Image record stored in ctx.shared ────────────────────────────────────────

interface ImageRecord {
  src: string;
  relId: string;
  filename: string;
  width: number;
  height: number;
}

type ImageMap = Map<string, ImageRecord>;

const SHARED_KEY = "docx:images";

function getImageMap(ctx: DocxContextShape): ImageMap {
  return ctx.shared.getOrInit<ImageMap>(SHARED_KEY, () => new Map());
}

function readPositiveInt(raw: unknown, fallback: number): number {
  return typeof raw === "number" && raw > 0 ? Math.round(raw) : fallback;
}

function readString(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

// ── Document walk: collect unique image srcs ────────────────────────────────

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

// ── onBeforeExport hook ─────────────────────────────────────────────────────

async function imageOnBeforeExport(ctx: DocxContextShape): Promise<void> {
  const doc = ctx.editor.getState().doc;
  const srcs = collectImageSrcs(doc);
  if (srcs.length === 0) return;

  const map = getImageMap(ctx);

  // Default dimensions used when no image instance has explicit width/height.
  // Real handler-time emission reads the per-node attrs anyway — these only
  // exist so the recorded entry has *some* placeholder.
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
      map.set(src, {
        src,
        relId,
        filename,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      });
    }),
  );
}

// ── XML builders for the <pic:pic> / <wp:inline> / <wp:anchor> blocks ───────

const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";

let nextDocPrId = 1;
function nextId(): string {
  const id = nextDocPrId++;
  return String(id);
}

function buildPicGraphic(
  filename: string,
  relId: string,
  widthPx: number,
  heightPx: number,
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
  filename: string,
  relId: string,
  widthPx: number,
  heightPx: number,
): XmlNode {
  const cx = String(pxToEmu(widthPx));
  const cy = String(pxToEmu(heightPx));
  const id = nextId();
  return el("w:drawing", undefined, [
    el(
      "wp:inline",
      { "xmlns:wp": NS_WP, distT: "0", distB: "0", distL: "0", distR: "0" },
      [
        el("wp:extent", { cx, cy }),
        el("wp:effectExtent", { l: "0", t: "0", r: "0", b: "0" }),
        el("wp:docPr", { id, name: `Picture ${id}` }),
        el("wp:cNvGraphicFramePr", undefined, [
          el("a:graphicFrameLocks", { "xmlns:a": NS_A, noChangeAspect: "1" }),
        ]),
        buildPicGraphic(filename, relId, widthPx, heightPx),
      ],
    ),
  ]);
}

interface AnchorAttrs {
  wrapMode: string;
  xAlign: string;
  /** Custom x (px) — used when xAlign === "custom" or when a literal x is set. */
  xCustom?: number;
  yOffset: number;
  marginPx: number;
}

function buildAnchoredDrawing(
  filename: string,
  relId: string,
  widthPx: number,
  heightPx: number,
  anchor: AnchorAttrs,
): XmlNode {
  const cx = String(pxToEmu(widthPx));
  const cy = String(pxToEmu(heightPx));
  const id = nextId();
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
    if (anchor.wrapMode === "square") {
      return el("wp:wrapSquare", { wrapText: "bothSides" });
    }
    if (anchor.wrapMode === "top-bottom") {
      return el("wp:wrapTopAndBottom");
    }
    // behind, front
    return el("wp:wrapNone");
  })();

  return el("w:drawing", undefined, [
    el(
      "wp:anchor",
      {
        "xmlns:wp": NS_WP,
        distT: marginEmu,
        distB: marginEmu,
        distL: marginEmu,
        distR: marginEmu,
        simplePos: "0",
        relativeHeight: "0",
        behindDoc,
        locked: "0",
        layoutInCell: "1",
        allowOverlap: "1",
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

// ── Node handler ────────────────────────────────────────────────────────────

const imageNodeHandler: ImageNodeHandler = (node, _children, ctx) => {
  const src = readString(node.attrs["src"]);
  if (!src) {
    ctx.diagnostics.warn({
      code: "image-no-src",
      message: "Image node has no src — dropping",
      nodeType: "image",
    });
    return [];
  }

  const record = getImageMap(ctx).get(src);
  if (!record) {
    // onBeforeExport didn't register this src — usually because fetch failed.
    // Diagnostic was already recorded there; emit nothing here.
    return [];
  }

  const width = readPositiveInt(node.attrs["width"], record.width);
  const height = readPositiveInt(node.attrs["height"], record.height);
  const wrapMode = readString(node.attrs["wrapMode"]) ?? "inline";

  if (wrapMode === "inline") {
    // Inline images sit inside a run (paragraph's inline content).
    return el("w:r", undefined, [
      buildInlineDrawing(record.filename, record.relId, width, height),
    ]);
  }

  const xAlignRaw = readString(node.attrs["xAlign"]) ?? "left";
  const xRaw = node.attrs["x"];
  const yOffsetRaw = node.attrs["yOffset"];
  const marginRaw = node.attrs["margin"];

  const anchor: AnchorAttrs = {
    wrapMode,
    xAlign: xAlignRaw,
    yOffset: typeof yOffsetRaw === "number" ? yOffsetRaw : 0,
    marginPx: typeof marginRaw === "number" ? marginRaw : 12,
  };
  if (typeof xRaw === "number") anchor.xCustom = xRaw;

  // Anchored images attach to a paragraph. Word wants them inside a <w:r>
  // that sits inside a <w:p>. Returning the <w:r> here works because the
  // paragraph wrapper comes from the surrounding paragraph node.
  return el("w:r", undefined, [
    buildAnchoredDrawing(record.filename, record.relId, width, height, anchor),
  ]);
};

// ── Public contribution (consumed by Image.ts's addExports) ─────────────────

export const imageDocxContribution = {
  onBeforeExport: imageOnBeforeExport,
  nodes: {
    image: imageNodeHandler,
  },
};

// Re-exports for tests in @scrivr/export-docx that want to spot-check helpers.
export {
  pxToEmu,
  sniffImageContentType,
  collectImageSrcs,
  fetchImageBytes,
  SHARED_KEY as IMAGE_SHARED_KEY,
};
export type { ImageRecord, ImageMap };
