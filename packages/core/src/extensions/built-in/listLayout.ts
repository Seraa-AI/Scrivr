/**
 * How `List` lays out and paints: the wrappers that indent and number its
 * items, and the painters that draw its markers on canvas and in PDF.
 */
import type { WrapperLayout } from "../../layout/BlockRegistry";
import type { BlockMarker, MarkerPainter, PlacedMarker } from "../../layout/markers";
import type { PdfDrawSurface } from "../../exports/pdf";
import { compositeColor, parseCssColor, type Rgb } from "../../model/cssColor";
import { listKind, type ListKind } from "../../model/lists";
import {
  bulletBox,
  bulletShape,
  itemLevel,
  levelCounter,
  LIST_MARKER_HANGING,
  listLevel,
  listMarker,
  listStart,
  nestedListLevel,
  type BulletShape,
} from "./listLevels";

/** The key List's markers are painted under. */
export const LIST_MARKER_PAINTER = "list";

/** What a list hands down to its items. */
class ListFrame {
  constructor(
    readonly level: number,
    readonly kind: ListKind,
    /** The next number at a depth, counted as Word counts. */
    readonly count: (depth: number) => number,
    /** How far in the item holding this list sits its text; 0 for a top-level list. */
    readonly at: number,
  ) {}
}

/** What an item hands down to its blocks and the lists nested in it. */
class ItemFrame {
  constructor(
    /** The level of the list the item is in, which a list nested in it counts from. */
    readonly listLevel: number,
    /** How far in its text sits. */
    readonly at: number,
    /** How much further in that is than its list. */
    readonly indent: number,
    readonly marker: BlockMarker,
  ) {}
}

/** A bullet or number hung a quarter inch before its item's text. */
function listBlockMarker(text: string): BlockMarker {
  const shape = bulletShape(text);
  return {
    painter: LIST_MARKER_PAINTER,
    data: text,
    hanging: LIST_MARKER_HANGING,
    width: (face, measurer) => (shape ? bulletBox(face.size).size : measurer.measureWidth(text, face.font)),
  };
}

/** A list numbers its items and nests one level below the item holding it. */
export const listWrap: WrapperLayout = {
  enter(node, outer) {
    const kind = listKind(node) ?? "bullet";
    const holder = outer["listItem"];
    const level = nestedListLevel(holder instanceof ItemFrame ? holder.listLevel : null);
    const count = levelCounter(level, kind === "ordered" ? listStart(node) : 1);
    return { ...outer, list: new ListFrame(level, kind, count, holder instanceof ItemFrame ? holder.at : 0) };
  },
  place: () => ({ indent: 0 }),
};

/**
 * Every block of an item sits at its level's text indent, and the item's
 * first block carries its marker. A paragraph takes the list's spacing; a
 * heading or code block keeps its own.
 */
export const listItemWrap: WrapperLayout = {
  enter(node, outer) {
    const list = outer["list"];
    if (!(list instanceof ListFrame)) return outer;
    const depth = itemLevel(node, list.level);
    const at = listLevel(depth).textIndent;
    const marker = listBlockMarker(listMarker(list.kind, depth, list.count(depth)));
    return { ...outer, listItem: new ItemFrame(list.level, at, at - list.at, marker) };
  },
  place(block, index, scope) {
    const item = scope["listItem"];
    if (!(item instanceof ItemFrame)) return { indent: 0 };
    return {
      indent: item.indent,
      ...(index === 0 ? { marker: item.marker } : {}),
      ...(block.type.name === "paragraph" ? { styleKey: "list_item" } : {}),
    };
  },
};

type CanvasBullet = (ctx: CanvasRenderingContext2D, left: number, centerY: number, fontSize: number) => void;

const CANVAS_BULLETS: Record<BulletShape, CanvasBullet> = {
  disc: (ctx, left, centerY, fontSize) => {
    const radius = bulletBox(fontSize).size / 2;
    ctx.beginPath();
    ctx.arc(left + radius, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  },
  circle: (ctx, left, centerY, fontSize) => {
    const { size, stroke } = bulletBox(fontSize);
    const radius = size / 2;
    ctx.beginPath();
    ctx.lineWidth = stroke;
    ctx.arc(left + radius, centerY, radius - stroke / 2, 0, Math.PI * 2);
    ctx.stroke();
  },
  square: (ctx, left, centerY, fontSize) => {
    const { size } = bulletBox(fontSize);
    ctx.fillRect(left, centerY - size / 2, size, size);
  },
};

type PdfBullet = (draw: PdfDrawSurface, left: number, centerY: number, fontSize: number, color: Rgb) => void;

/** The canvas's shapes, in PDF: a standard PDF font cannot encode `◦` or `▪`. */
const PDF_BULLETS: Record<BulletShape, PdfBullet> = {
  disc: (draw, left, centerY, fontSize, color) => {
    const radius = bulletBox(fontSize).size / 2;
    draw.ellipse({ center: { x: left + radius, y: centerY }, radiusX: radius, radiusY: radius, color });
  },
  circle: (draw, left, centerY, fontSize, color) => {
    const { size, stroke } = bulletBox(fontSize);
    const ring = size / 2 - stroke / 2;
    draw.ellipse({ center: { x: left + size / 2, y: centerY }, radiusX: ring, radiusY: ring, border: { color, widthPx: stroke } });
  },
  square: (draw, left, centerY, fontSize, color) => {
    const { size } = bulletBox(fontSize);
    draw.rect({ x: left, y: centerY - size / 2, width: size, height: size, color });
  },
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** A CSS colour as the PDF paints it: composited over the white page, black when unreadable. */
function pdfColor(css: string): Rgb {
  const parsed = parseCssColor(css);
  return parsed ? compositeColor(parsed, WHITE) : BLACK;
}

const centerOf = (marker: PlacedMarker): number => marker.baseline - bulletBox(marker.size).centerAboveBaseline;

/**
 * Draws a bullet as its shape and a number as text, with its left edge at the
 * marker's `x` on its baseline, in each surface's own theme `marker` colour.
 */
export const listMarkerPainter: MarkerPainter = {
  canvas(ctx, marker, theme) {
    if (typeof marker.data !== "string") return;
    ctx.fillStyle = theme.marker;
    ctx.strokeStyle = theme.marker;
    const shape = bulletShape(marker.data);
    if (shape) {
      CANVAS_BULLETS[shape](ctx, marker.x, centerOf(marker), marker.size);
      return;
    }
    ctx.font = marker.font;
    ctx.textAlign = "left";
    ctx.fillText(marker.data, marker.x, marker.baseline);
  },
  pdf(marker, ctx) {
    if (typeof marker.data !== "string") return;
    const fill = pdfColor(ctx.theme.marker);
    const shape = bulletShape(marker.data);
    if (shape) {
      PDF_BULLETS[shape](ctx.draw, marker.x, centerOf(marker), marker.size, fill);
      return;
    }
    ctx.draw.text({
      text: marker.data,
      x: marker.x,
      baselineY: marker.baseline,
      sizePx: marker.size,
      font: { cssFont: marker.font, ...(marker.resolution !== undefined ? { resolution: marker.resolution } : {}) },
      color: fill,
    });
  },
};
