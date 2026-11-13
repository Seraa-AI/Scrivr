import type { Node as PmNode } from "prosemirror-model";
import { z } from "zod";
import type { ResolvedTheme } from "../../model/theme";
import type { PdfNodeContext } from "../../exports/pdf";

/** The control a field is: how it draws, whether it toggles, and what Word gets. */
export type FieldControl = "signatureLine" | "checkbox" | "date" | "dropdown" | "text";

/** A kind of field — Scrivr's built-ins, or one a host registers. */
export interface FieldKindSpec {
  /** Shown on the empty box and as the control's name in Word. */
  label: string;
  /** The box an inserted field reserves, in CSS pixels. */
  size: { width: number; height: number };
  /** Defaults to `"text"`. */
  control?: FieldControl;
}

export const BUILT_IN_FIELD_KINDS = {
  signature: { label: "Signature", size: { width: 180, height: 44 }, control: "signatureLine" },
  initials: { label: "Initials", size: { width: 64, height: 36 } },
  date: { label: "Date", size: { width: 110, height: 24 }, control: "date" },
  text: { label: "Text", size: { width: 160, height: 24 } },
  checkbox: { label: "", size: { width: 16, height: 16 }, control: "checkbox" },
  name: { label: "Name", size: { width: 160, height: 24 } },
  email: { label: "Email", size: { width: 180, height: 24 } },
  title: { label: "Title", size: { width: 140, height: 24 } },
  company: { label: "Company", size: { width: 160, height: 24 } },
  number: { label: "Number", size: { width: 100, height: 24 } },
  dropdown: { label: "Choose", size: { width: 140, height: 24 }, control: "dropdown" },
} satisfies Record<string, FieldKindSpec>;

export type BuiltInFieldKind = keyof typeof BUILT_IN_FIELD_KINDS;

/** A built-in kind's name, or the name a host registered a kind under. */
export type FieldKind = BuiltInFieldKind | (string & {});

/** What fills a field. `image` is a raster drawn signature; `data:` URLs allowed, SVG not. */
export type FieldValue =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string }
  | { kind: "checkbox"; checked: boolean };

/** One choice a dropdown offers: `id` is what is stored and exported, `label` what a person reads. */
export const FieldChoiceSchema = z.object({ id: z.string(), label: z.string() });
export type FieldChoice = z.infer<typeof FieldChoiceSchema>;

/** The choices a field's `options` attr holds, leaving out anything that is not one. */
export const fieldChoices = (options: unknown): FieldChoice[] =>
  Array.isArray(options)
    ? options.flatMap((option) => {
        const parsed = FieldChoiceSchema.safeParse(option);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

export interface FieldOptions {
  /** Kinds added to — or replacing — the built-ins, by name. */
  kinds: Record<string, FieldKindSpec>;
  /**
   * Completed values by field id, printed in their fields when this editor
   * exports a PDF — the executed document a signing ends with. They never
   * enter the document. On screen, `FieldCompletion` shows values instead.
   */
  values: Record<string, FieldValue>;
  /** A colour per role, by role name. A role left out takes one from Scrivr's palette. */
  roleColors?: Readonly<Record<string, string>>;
  /**
   * Draw a field yourself, on screen. Return `true` when you drew it; `false`
   * leaves Scrivr's look for that field.
   */
  paint?: (ctx: CanvasRenderingContext2D, field: FieldDrawing) => boolean;
  /** Draw a field yourself in the PDF, as `paint` does on screen. */
  print?: (pdf: PdfNodeContext, field: FieldDrawing) => boolean;
}

/** Everything Scrivr knows about a field it is about to draw — what a host's own drawing gets. */
export interface FieldDrawing {
  node: PmNode;
  /** The box the layout reserved for it. */
  box: { x: number; y: number; width: number; height: number };
  /** The baseline of the line it stands in. */
  baselineY: number;
  kind: string;
  control: FieldControl;
  /** What the field is, as its kind names it: "Signature". */
  label: string;
  /** Who fills it; `null` for a field the author fills. */
  role: string | null;
  /** Its party's colour. */
  color: string;
  theme: ResolvedTheme;
  /** The value it is printed with, in the executed document. */
  value?: FieldValue;
}

export type FieldKinds = Readonly<Record<string, FieldKindSpec>>;

export const controlOf = (kinds: FieldKinds, node: PmNode): FieldControl =>
  kinds[String(node.attrs["kind"])]?.control ?? "text";

/** What an empty field shows: its kind's label, and whose it is. */
/** What a field is, as its label says it: "Signature". */
export const fieldLabel = (kinds: FieldKinds, node: PmNode): string =>
  kinds[String(node.attrs["kind"])]?.label ?? String(node.attrs["kind"]);

export function fieldCaption(kinds: FieldKinds, node: PmNode): string {
  const label = kinds[String(node.attrs["kind"])]?.label ?? String(node.attrs["kind"]);
  const role = node.attrs["role"];
  return typeof role === "string" && label ? `${label} · ${role}` : label;
}

interface FieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The three points of the tick in a checked box, on screen and in the PDF alike. */
export const checkboxTick = ({ x, y, width, height }: FieldBox) =>
  [
    { x: x + width * 0.2, y: y + height * 0.55 },
    { x: x + width * 0.42, y: y + height * 0.78 },
    { x: x + width * 0.8, y: y + height * 0.25 },
  ] as const;

/** A sans-serif glyph's average advance, in ems — enough to size a value to its box. */
const AVERAGE_ADVANCE_EM = 0.55;
/** The size a value is set at when the text around it gives none. */
const DEFAULT_VALUE_PX = 14;

const fontSizePx = (font: string | undefined): number | null => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1]);
  return size > 0 ? size : null;
};

/**
 * Where a value typed into a field is set, on screen and in the PDF alike.
 * Once filled, a field reads as part of the document: on the line's baseline,
 * where a field's box stands, in the size of the text around it (`textFont`,
 * a CSS font) — smaller only when too long to fit across the box.
 */
export function fieldValueLayout(text: string, box: FieldBox, textFont?: string, baselineY = box.y + box.height) {
  const across = (box.width - 4) / (Math.max(1, text.length) * AVERAGE_ADVANCE_EM);
  const sizePx = Math.min(fontSizePx(textFont) ?? DEFAULT_VALUE_PX, across);
  return { x: box.x + 2, baselineY, sizePx };
}

/**
 * One colour per party, the same wherever their fields are — how a reader
 * sees who signs where. Chosen from the role's name, so every client, the
 * PDF and the next session agree without a table. A field the author fills
 * belongs to no party, and takes the neutral grey.
 */
const ROLE_COLORS = ["#0e93b0", "#d6457f", "#c47a14", "#13946b", "#7a4fd6", "#3a6fd8"] as const;
const NO_ROLE_COLOR = "#8a8f98";

export function fieldRoleColor(role: string | null | undefined, overrides?: Readonly<Record<string, string>>): string {
  if (!role) return NO_ROLE_COLOR;
  const chosen = overrides?.[role];
  if (chosen) return chosen;
  let hash = 0;
  for (const char of role) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ROLE_COLORS[hash % ROLE_COLORS.length]!;
}

/**
 * Whether a field is set like text — as tall as the words around it, so its
 * line keeps its height, as a Word content control does — or like a picture,
 * at its own size on the baseline, as an inline image and a signature line
 * are. A field filled with a drawing is a picture; a checkbox is a glyph.
 */
export const setsLike = (kind: string, control: FieldControl): "text" | "picture" | "glyph" =>
  control === "checkbox" ? "glyph" : control === "signatureLine" || kind === "initials" ? "picture" : "text";

/** What a signer does to complete a field — the word on its badge. */
export function fieldVerb(kind: string, control: FieldControl): string {
  if (kind === "initials") return "Initial";
  const verbs: Record<FieldControl, string> = { signatureLine: "Sign", date: "Date", dropdown: "Choose", checkbox: "Tick", text: "Fill" };
  return verbs[control];
}

/** The size of a field's label text. */
const LABEL_PX = 12;
const ICON_PX = 11;

/**
 * Where an unfilled field's ink goes: standing on the text's baseline (the
 * bottom of a box that stands on it, unless told otherwise), a small icon
 * and the label saying what the field is, over a rule like an underline.
 */
export function fieldInk(box: FieldBox, baselineY = box.y + box.height) {
  // A field stands on the text's baseline: its label sits on it like a word,
  // its rule just under it like an underline.
  const labelBaselineY = baselineY;
  const ruleY = labelBaselineY + 2;
  const labelSizePx = Math.min(LABEL_PX, (baselineY - box.y) * 0.85);
  const iconSize = Math.min(ICON_PX, labelSizePx);
  const icon = { x: box.x + 2, y: labelBaselineY - iconSize, size: iconSize };
  return {
    rule: { from: { x: box.x, y: ruleY }, to: { x: box.x + box.width, y: ruleY } },
    icon,
    labelX: icon.x + iconSize + 4,
    labelBaselineY,
    labelSizePx,
  };
}

type Point = { x: number; y: number };

/**
 * A field's icon as strokes inside a square — a pen to sign, a calendar to
 * date, a chevron to choose — drawn alike by canvas and the PDF. A text
 * field has none: its label says enough.
 */
export function fieldIconStrokes(control: FieldControl, at: { x: number; y: number; size: number }): Point[][] {
  const p = (u: number, v: number): Point => ({ x: at.x + u * at.size, y: at.y + v * at.size });
  switch (control) {
    case "signatureLine":
      return [
        [p(0.65, 0.1), p(0.9, 0.35), p(0.35, 0.9), p(0.1, 0.9), p(0.1, 0.65), p(0.65, 0.1)],
        [p(0.55, 0.2), p(0.8, 0.45)],
      ];
    case "date":
      return [
        [p(0.1, 0.2), p(0.9, 0.2), p(0.9, 0.95), p(0.1, 0.95), p(0.1, 0.2)],
        [p(0.1, 0.42), p(0.9, 0.42)],
        [p(0.32, 0.05), p(0.32, 0.3)],
        [p(0.68, 0.05), p(0.68, 0.3)],
      ];
    case "dropdown":
      return [[p(0.2, 0.38), p(0.5, 0.68), p(0.8, 0.38)]];
    case "checkbox":
    case "text":
      return [];
  }
}
