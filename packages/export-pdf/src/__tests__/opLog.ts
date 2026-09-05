import { PDFPage } from "pdf-lib";

/**
 * Records every drawing call an export makes, in order, as data.
 *
 * A PDF's bytes are the wrong thing to compare: object ordering, ids, metadata
 * and compression all move without any pixel moving. What actually defines the
 * rendering is which primitives were drawn, with what values, in what order —
 * so that is what this records, at the boundary where the exporter meets
 * pdf-lib. Anything that reaches the page goes through one of these four
 * methods, including the paths that bypass handler dispatch.
 *
 * The log is the baseline every migration phase is gated on, so it has to have
 * the resolution to notice a reordered decoration or a dropped opacity. That is
 * not assumed — `opLog.mutation.test.ts` perturbs a real recorded stream and
 * requires the log to change.
 */

/** One recorded drawing call. Field names mirror pdf-lib's options. */
export interface DrawOp {
  op: "text" | "line" | "rect" | "image";
  /** Which page received it — ops are recorded across pages in call order. */
  page: number;
  [field: string]: unknown;
}

/**
 * Rounds away arithmetic noise while keeping every difference a reader could
 * see. Without it a baseline fills up with `41.9999999998` diffs from
 * reassociated float math, and a harness that cries wolf gets ignored — which
 * is the same as not having one.
 */
export function normalizeDrawNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round(value * 1e3) / 1e3;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const PAGE_METHODS = ["drawText", "drawLine", "drawRectangle", "drawImage"] as const;
const OP_NAMES: Record<(typeof PAGE_METHODS)[number], DrawOp["op"]> = {
  drawText: "text",
  drawLine: "line",
  drawRectangle: "rect",
  drawImage: "image",
};

/**
 * Runs `exportFn` with every page draw call recorded. Restores pdf-lib
 * afterwards, including when the export throws.
 */
export async function recordDrawOps(exportFn: () => Promise<unknown>): Promise<DrawOp[]> {
  const ops: DrawOp[] = [];
  const pages = new Map<object, number>();
  const images = new Map<object, string>();

  const pageIndex = (page: object): number => {
    const known = pages.get(page);
    if (known !== undefined) return known;
    const next = pages.size;
    pages.set(page, next);
    return next;
  };

  /** Values are recorded by what they mean, not by object identity. */
  const describe = (value: unknown): unknown => {
    if (typeof value === "number") return normalizeDrawNumber(value);
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(describe);
    if (typeof value !== "object") return value;

    const record = fields(value);
    // pdf-lib colours: { type: "RGB", red, green, blue } and friends.
    if (typeof record["type"] === "string" && "red" in record) {
      return `rgb(${describe(record["red"])}, ${describe(record["green"])}, ${describe(record["blue"])})`;
    }
    // A font is identified by its name; the object is a pdf-lib resource.
    if (typeof record["name"] === "string" && "widthOfTextAtSize" in record) {
      return `font(${record["name"]})`;
    }
    // An image is identified by first appearance, so the log stays readable
    // and stable across runs that embed the same bytes.
    if ("width" in record && "height" in record && "embedder" in record) {
      const seen = images.get(value);
      if (seen) return seen;
      const id = `image#${images.size}`;
      images.set(value, id);
      return id;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = describe(record[key]);
    return out;
  };

  const originals = PAGE_METHODS.map(
    (name) => [name, Reflect.get(PDFPage.prototype, name)] as const,
  );

  for (const [name, original] of originals) {
    const call = original;
    Reflect.set(PDFPage.prototype, name, function (this: PDFPage, ...args: unknown[]) {
      const [first, second] = args;
      // `drawText` and `drawImage` take their subject first and options second;
      // `drawLine` and `drawRectangle` take one options bag.
      const described =
        name === "drawText" || name === "drawImage"
          ? { value: describe(first), ...fields(describe(second) ?? {}) }
          : fields(describe(first) ?? {});

      ops.push({ op: OP_NAMES[name], page: pageIndex(this), ...described });
      return Reflect.apply(call, this, args);
    });
  }

  try {
    await exportFn();
  } finally {
    for (const [name, original] of originals) {
      Reflect.set(PDFPage.prototype, name, original);
    }
  }

  return ops;
}

/**
 * Reads an object's own fields. The one assertion in this file, contained: a
 * recorded pdf-lib option bag is a plain object, and every value it holds goes
 * back through `describe` before it reaches the log.
 */
function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
