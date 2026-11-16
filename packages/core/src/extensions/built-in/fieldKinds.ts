import type { Node as PmNode } from "prosemirror-model";
import { z } from "zod";
import type { ResolvedTheme } from "../../model/theme";
import type { PdfNodeContext } from "../../exports/pdf";
import { safeDrawingUrl } from "../../model/safeUrl";

/** The control a field is: how it draws, whether it toggles, and what Word gets. */
export type FieldControl = "signatureLine" | "checkbox" | "date" | "dropdown" | "text";

/** A kind of field — Scrivr's built-ins, or one a host registers. */
export interface FieldKindSpec {
  /**
   * Shown on the empty box and as the control's name in Word. A checkbox's
   * box says what it is, so its label names it in Word and in host drawings
   * only. An empty label leaves a field unnamed — nothing on its box, no
   * name in Word.
   */
  label: string;
  /** The box an inserted field reserves, in CSS pixels. */
  size: { width: number; height: number };
  /** Defaults to `"text"`. A `"signatureLine"` field is its party signing. */
  control?: FieldControl;
  /**
   * Completed by drawing, as initials are: it takes a drawn image and keeps
   * its `size` on the baseline, as a picture does. Read on a `"text"`
   * control; a `"signatureLine"` is always drawn, any other control never.
   */
  drawn?: boolean;
  /** The word on its badge — what a signer does: "Initial". Else its control's ("Sign", "Fill"…), or "Draw" for a drawn text control. */
  verb?: string;
  /**
   * Shows when its party signed — the latest `signedAt` among their answered
   * signatures — and is never a value of its own: never pressed, never taken
   * from Word, never holding a signature back. A seal refuses a party with a
   * required one and no required signature. Read on a `"date"` or `"text"`
   * control; a checkbox or dropdown shows a tick or a choice.
   */
  datedWhenSigned?: boolean;
}

export const BUILT_IN_FIELD_KINDS = {
  signature: { label: "Signature", size: { width: 180, height: 44 }, control: "signatureLine" },
  initials: { label: "Initials", size: { width: 64, height: 36 }, drawn: true, verb: "Initial" },
  date: { label: "Date", size: { width: 110, height: 24 }, control: "date" },
  dateSigned: { label: "Date signed", size: { width: 110, height: 24 }, control: "date", datedWhenSigned: true },
  text: { label: "Text", size: { width: 160, height: 24 } },
  checkbox: { label: "Checkbox", size: { width: 16, height: 16 }, control: "checkbox" },
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

/**
 * What fills a field. `image` is a drawing for a drawn field — a signature,
 * initials — as an inline PNG or JPEG (`safeDrawingUrl`): printable, and
 * fixed once given. `choice` names a dropdown's choice by its `id`, so a
 * renamed label still answers the same choice. `signedAt` on a signature is
 * when it was given, from the host's own record — an ISO timestamp with `Z`
 * or the signer's offset, or an ISO day (`parseSignedAt`) — and its party's
 * date signed shows the day it names.
 */
export type FieldValue =
  | { kind: "text"; text: string; signedAt?: string }
  | { kind: "choice"; id: string }
  | { kind: "image"; src: string; signedAt?: string }
  | { kind: "checkbox"; checked: boolean };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A moment of signing as a date signed shows it unless `Field` is given
 * `formatSignedDate`: the day `signedAt` names, in the signer's own offset —
 * "14 November 2026" — so a record reads the day they signed, wherever it is
 * printed. Nothing for what is no moment.
 */
export function defaultSignedDate(signedAt: string): string {
  const moment = readSignedAt(signedAt);
  return moment ? `${moment.day} ${MONTHS[moment.month - 1]} ${moment.year}` : "";
}

/**
 * `YYYY-MM-DD`, then optionally a time with `Z` or an offset. A time with no
 * zone, or a date in some locale's words, would be read in whatever zone the
 * machine is in.
 */
const SIGNED_AT = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|([+-])(\d{2}):(\d{2})))?$/;

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysInMonth = (year: number, month: number): number => (month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31);

/**
 * The parts `signedAt` writes, each in range, and the moment they name — read
 * here rather than by `Date.parse`, which some engines let roll 30 February
 * over into March while others refuse it.
 */
function readSignedAt(signedAt: string): { year: number; month: number; day: number; at: number } | null {
  const parts = SIGNED_AT.exec(signedAt);
  if (!parts) return null;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, offsetHours = 0, offsetMinutes = 0] = [1, 2, 3, 4, 5, 6, 9, 10].map((i) =>
    Number(parts[i] ?? 0),
  );
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) return null;
  const millis = Number((parts[7] ?? "").padEnd(3, "0").slice(0, 3));
  const offset = (parts[8] === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute - offset, second, millis);
  return { year, month, day, at: utc.getTime() };
}

/**
 * When a signature was given, from its `signedAt`: an ISO timestamp with `Z`
 * or an offset, or an ISO day, naming a day that exists. Anything else would
 * read differently on another machine, and a record must read the same
 * everywhere, so it is no moment: `null`.
 */
export const parseSignedAt = (signedAt: string): number | null => readSignedAt(signedAt)?.at ?? null;

/** The `signedAt` a value carries when it names a moment (`parseSignedAt`); `null` otherwise. */
export function signedAtOf(value: FieldValue | undefined): string | null {
  if (!value || !("signedAt" in value) || value.signedAt === undefined) return null;
  return parseSignedAt(value.signedAt) === null ? null : value.signedAt;
}

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

/**
 * The words a value is set in: its text, or the label of a choice the field
 * still offers. Null when it holds none — blank text, or a choice since
 * withdrawn, leaves the field as empty as no value at all.
 */
export function valueText(value: FieldValue | undefined, choices: readonly FieldChoice[]): string | null {
  switch (value?.kind) {
    case "text":
      return value.text.trim() === "" ? null : value.text;
    case "choice":
      return choices.find((choice) => choice.id === value.id)?.label ?? null;
    case "image":
    case "checkbox":
    case undefined:
      return null;
  }
}

export interface FieldOptions {
  /**
   * Kinds added to the built-ins, by name. One under a built-in name refines
   * it: what it gives replaces what the built-in declares, the rest stays;
   * give it another control and it drops what belonged to the old one —
   * `drawn`, `verb`, `datedWhenSigned`.
   */
  kinds: Record<string, FieldKindSpec>;
  /**
   * Completed values by field id that the editor opens with; `setFieldValue`
   * gives one later. A signer's field is laid out, drawn and printed with a
   * value it can show — a tick on a checkbox, a choice on a dropdown, words,
   * a drawing on a drawn field as an inline PNG or JPEG; a date signed takes
   * none, and shows when its party signed. This is the executed document a
   * signing ends with. Values never enter the document, so its seal holds.
   */
  values: Record<string, FieldValue>;
  /**
   * How a date signed shows the moment its party signed, handed the latest
   * signature's own `signedAt` as the host recorded it — its offset kept, so
   * the day can read as the signer saw it. A format must give the same words
   * wherever the record is printed: one that reads the machine's zone or
   * language prints a different date on another. `defaultSignedDate` when
   * omitted.
   */
  formatSignedDate?: (signedAt: string) => string;
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
  box: FieldBox;
  /** The baseline of the line it stands in. */
  baselineY: number;
  kind: string;
  control: FieldControl;
  /** What the field is, as its kind names it: "Signature". */
  label: string;
  /** What a signer does to complete it — the word on its badge: "Sign". */
  verb: string;
  /** Who fills it; `null` for a field the author fills. */
  role: string | null;
  /** Its party's colour. */
  color: string;
  theme: ResolvedTheme;
  /** The value it shows, if any: a signer's field, with a value its control can show. */
  value?: FieldValue;
}

export type FieldKinds = Readonly<Record<string, FieldKindSpec>>;

/** Whether completing a field of `kind` is its party signing: its control is a signature line. */
export const isSigningKind = (kinds: FieldKinds, kind: string): boolean => kinds[kind]?.control === "signatureLine";

/**
 * Whether a field of `kind` shows the date its party signed: a date or text
 * control that declares `datedWhenSigned`. A checkbox or a dropdown shows a
 * tick or a choice, whatever it declares.
 */
export function isDatedWhenSigned(kinds: FieldKinds, kind: string): boolean {
  const control = controlOfKind(kinds, kind);
  return (control === "date" || control === "text") && kinds[kind]?.datedWhenSigned === true;
}

/** The control a kind declares; `"text"` when it declares none. */
export const controlOfKind = (kinds: FieldKinds, kind: string): FieldControl => kinds[kind]?.control ?? "text";

/** The control a field's kind declares. */
export const controlOf = (kinds: FieldKinds, node: PmNode): FieldControl => controlOfKind(kinds, String(node.attrs["kind"]));

/** The values each control shows besides a drawing, which `shownValue` decides by kind. */
const SHOWN_BY: Record<FieldControl, ReadonlySet<FieldValue["kind"]>> = {
  signatureLine: new Set(["text"]),
  text: new Set(["text"]),
  date: new Set(["text"]),
  dropdown: new Set(["choice"]),
  checkbox: new Set(["checkbox"]),
};

/**
 * The value a field of `kind` shows: one its control can show, or none. A
 * drawing belongs only to a kind that is drawn — a signature, initials — and
 * only as a drawing a record can print (`safeDrawingUrl`); anything else
 * shows nothing, so it is none.
 */
export function shownValue(kinds: FieldKinds, kind: string, value: FieldValue | undefined): FieldValue | undefined {
  if (value?.kind === "image") {
    const src = isDrawnKind(kinds, kind) ? safeDrawingUrl(value.src) : null;
    return src === null ? undefined : { ...value, src };
  }
  return value && SHOWN_BY[controlOfKind(kinds, kind)].has(value.kind) ? value : undefined;
}

/** What a field is, as its label says it: "Signature". */
export const fieldLabel = (kinds: FieldKinds, node: PmNode): string =>
  kinds[String(node.attrs["kind"])]?.label ?? String(node.attrs["kind"]);

/** A field's name with whose it is — what an empty field shows in print, and Word's name for its control. */
export function fieldCaption(kinds: FieldKinds, node: PmNode): string {
  const label = fieldLabel(kinds, node);
  const role = node.attrs["role"];
  return typeof role === "string" && label ? `${label} · ${role}` : label;
}

/** A field's box, in layout pixels. */
export interface FieldBox {
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

/** The size a value is set at when the text around it gives none. */
const DEFAULT_VALUE_PX = 14;

const fontSizePx = (font: string | undefined): number | null => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1]);
  return size > 0 ? size : null;
};

/**
 * Where a value typed into a field is set, on screen and in the PDF alike.
 * Once filled, a field reads as part of the document: on the line's baseline,
 * in the font of the text around it (`textFont`, a CSS font). Layout made the
 * box as wide as the value, so it fits as it is.
 */
export function fieldValueLayout(box: FieldBox, textFont?: string, baselineY = box.y + box.height) {
  const sizePx = fontSizePx(textFont) ?? DEFAULT_VALUE_PX;
  return { x: box.x + 2, baselineY, sizePx, font: textFont ?? `${sizePx}px sans-serif` };
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
 * Whether a field of `kind` is completed by drawing: a signature line, or a
 * text control that declares `drawn`. A checkbox, a date or a dropdown holds
 * a tick, a date or a choice, whatever it declares.
 */
export function isDrawnKind(kinds: FieldKinds, kind: string): boolean {
  const control = controlOfKind(kinds, kind);
  return control === "signatureLine" || (control === "text" && kinds[kind]?.drawn === true);
}

/**
 * Whether a field is set like text — as tall as the words around it, so its
 * line keeps its height, as a Word content control does — or like a picture,
 * at its own size on the baseline, as an inline image is: a drawn field. A
 * checkbox is a glyph.
 */
export function setsLike(kinds: FieldKinds, kind: string): "text" | "picture" | "glyph" {
  if (controlOfKind(kinds, kind) === "checkbox") return "glyph";
  return isDrawnKind(kinds, kind) ? "picture" : "text";
}

const VERBS: Record<FieldControl, string> = { signatureLine: "Sign", date: "Date", dropdown: "Choose", checkbox: "Tick", text: "Fill" };

/**
 * What a signer does to complete a field — the word on its badge: what its
 * kind declares, else its control's ("Sign", "Choose"…), or "Draw" for a
 * drawn text control.
 */
export function fieldVerb(kinds: FieldKinds, kind: string): string {
  const declared = kinds[kind]?.verb;
  if (declared) return declared;
  const control = controlOfKind(kinds, kind);
  return isDrawnKind(kinds, kind) && control !== "signatureLine" ? "Draw" : VERBS[control];
}

/** The size of a field's label text. */
const LABEL_PX = 12;
/** A sans-serif capital's height, in ems. */
const CAP_HEIGHT_EM = 0.72;

/**
 * Where an unfilled field's ink goes: standing on the text's baseline (the
 * bottom of a box that stands on it, unless told otherwise), a small icon
 * and the label saying what the field is, over a rule like an underline.
 */
export function fieldInk(box: FieldBox, baselineY = box.y + box.height) {
  const labelBaselineY = baselineY;
  const ruleY = labelBaselineY + 2;
  const labelSizePx = Math.min(LABEL_PX, (baselineY - box.y) * 0.85);
  // An icon in a line of text is set like a capital letter — as tall as the
  // label's capitals, standing on its baseline — so its middle is the text's.
  const iconSize = labelSizePx * CAP_HEIGHT_EM;
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
