import type { Node as PmNode } from "prosemirror-model";

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

export interface FieldOptions {
  /** Kinds added to — or replacing — the built-ins, by name. */
  kinds: Record<string, FieldKindSpec>;
  /**
   * Completed values by field id, printed in their fields when this editor
   * exports a PDF — the executed document a signing ends with. They never
   * enter the document. On screen, `FieldCompletion` shows values instead.
   */
  values: Record<string, FieldValue>;
}

export type FieldKinds = Readonly<Record<string, FieldKindSpec>>;

export const controlOf = (kinds: FieldKinds, node: PmNode): FieldControl =>
  kinds[String(node.attrs["kind"])]?.control ?? "text";

/** What an empty field shows: its kind's label, and whose it is. */
export function fieldCaption(kinds: FieldKinds, node: PmNode): string {
  const label = kinds[String(node.attrs["kind"])]?.label ?? String(node.attrs["kind"]);
  const role = node.attrs["role"];
  return typeof role === "string" && label ? `${label} · ${role}` : label;
}
