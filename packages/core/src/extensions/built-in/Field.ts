import { NodeSelection, type Command } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import { Extension } from "../Extension";
import type { InlineStrategy } from "../../layout/BlockRegistry";
import type { PdfNodeHandler } from "../../exports/pdf";
import { compositeColor, parseCssColor, type Rgb } from "../../model/cssColor";
import type { ResolvedTheme } from "../../model/theme";
import {
  exitFieldRange,
  fieldRangeDecorator,
  fieldRangePdf,
  fieldRangePlugin,
  insertFieldRange,
  type InsertFieldRangeOptions,
} from "./fieldRange";

export type FieldKind = "signature" | "initials" | "date" | "text" | "checkbox";

/** Who fills a control: the author while drafting, or a signer after the seal. */
export type FieldFill = "author" | "signer";

export interface InsertFieldOptions {
  kind: FieldKind;
  fill: FieldFill;
  /** Who completes a signer field, by role (`client-authorized-signatory`). Required for `fill: "signer"`. */
  role?: string;
  required?: boolean;
  width?: number;
  height?: number;
}

/** A field a signer completes, as the host needs it to assign people to roles. */
export interface SignerFieldDescriptor {
  id: string;
  role: string;
  kind: FieldKind;
  required: boolean;
}

const KINDS: readonly FieldKind[] = ["signature", "initials", "date", "text", "checkbox"];

const isKind = (value: unknown): value is FieldKind =>
  typeof value === "string" && KINDS.some((kind) => kind === value);

const SIZES: Record<FieldKind, { width: number; height: number }> = {
  signature: { width: 180, height: 44 },
  initials: { width: 64, height: 36 },
  date: { width: 110, height: 24 },
  text: { width: 160, height: 24 },
  checkbox: { width: 16, height: 16 },
};

const LABELS: Record<FieldKind, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  text: "Text",
  checkbox: "",
};

/**
 * The signer fields in a document, in reading order — what a host assigns
 * people to before sealing. Works on any document, so a backend can validate a
 * template on `ServerEditor`.
 */
export function listSignerFields(doc: PmNode): SignerFieldDescriptor[] {
  const fields: SignerFieldDescriptor[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "field" || node.attrs["fill"] !== "signer") return true;
    const { nodeId, role, kind, required } = node.attrs;
    if (typeof nodeId === "string" && typeof role === "string" && isKind(kind)) {
      fields.push({ id: nodeId, role, kind, required: required === true });
    }
    return false;
  });
  return fields;
}

function insertField(options: InsertFieldOptions): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes["field"];
    if (!type) return false;
    const { kind, fill, role, required = false } = options;
    // A signer field nobody is named for could never be completed; an author
    // fills anything but a checkbox as ordinary text.
    if (fill === "signer" && !role) return false;
    if (fill === "author" && kind !== "checkbox") return false;
    const size = SIZES[kind];
    const node = type.create({
      kind,
      fill,
      role: fill === "signer" ? role : null,
      required: fill === "signer" && required,
      width: options.width ?? size.width,
      height: options.height ?? size.height,
    });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}

/** Check or uncheck the selected author checkbox. A signer's checkbox holds no state. */
const toggleFieldChecked: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return false;
  const { node, from } = selection;
  if (node.type.name !== "field") return false;
  if (node.attrs["kind"] !== "checkbox" || node.attrs["fill"] !== "author") return false;
  if (dispatch) {
    dispatch(state.tr.setNodeMarkup(from, undefined, { ...node.attrs, checked: node.attrs["checked"] !== true }));
  }
  return true;
};

const isSigner = (node: PmNode) => node.attrs["fill"] === "signer";

function caption(node: PmNode): string {
  const kind = isKind(node.attrs["kind"]) ? node.attrs["kind"] : "text";
  const role = node.attrs["role"];
  return typeof role === "string" && LABELS[kind] ? `${LABELS[kind]} · ${role}` : LABELS[kind];
}

const fieldStrategy: InlineStrategy = {
  verticalAlign: "baseline",
  render(ctx, x, y, width, height, node, theme: ResolvedTheme) {
    ctx.save();
    ctx.strokeStyle = theme.imagePlaceholderBorder;
    ctx.lineWidth = 1;
    if (node.attrs["kind"] === "checkbox") {
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      if (node.attrs["checked"] === true) {
        ctx.strokeStyle = theme.defaultText;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + width * 0.2, y + height * 0.55);
        ctx.lineTo(x + width * 0.42, y + height * 0.78);
        ctx.lineTo(x + width * 0.8, y + height * 0.25);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = theme.imagePlaceholderBg;
      ctx.fillRect(x, y, width, height);
      if (isSigner(node)) ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      ctx.fillStyle = theme.imagePlaceholderText;
      ctx.font = `${Math.min(12, height * 0.5)}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(caption(node), x + 4, y + height / 2, width - 8);
    }
    ctx.restore();
  },
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const pdfColor = (css: string): Rgb => {
  const parsed = parseCssColor(css);
  return parsed ? compositeColor(parsed, WHITE) : BLACK;
};

/** The same box as on canvas; a PDF cannot dash, so a signer field is outlined solid. */
const fieldPdf: PdfNodeHandler = (block, ctx) => {
  const { node, x, y, width, height } = block;
  const border = { color: pdfColor(ctx.theme.imagePlaceholderBorder), widthPx: 1 };
  if (node.attrs["kind"] === "checkbox") {
    ctx.draw.rect({ x, y, width, height, border });
    if (node.attrs["checked"] === true) {
      const color = pdfColor(ctx.theme.defaultText);
      const a = { x: x + width * 0.2, y: y + height * 0.55 };
      const b = { x: x + width * 0.42, y: y + height * 0.78 };
      const c = { x: x + width * 0.8, y: y + height * 0.25 };
      ctx.draw.line({ from: a, to: b, thicknessPx: 1.5, color });
      ctx.draw.line({ from: b, to: c, thicknessPx: 1.5, color });
    }
    return;
  }
  ctx.draw.rect({ x, y, width, height, color: pdfColor(ctx.theme.imagePlaceholderBg), border });
  if (!ctx.font) return;
  const sizePx = Math.min(12, height * 0.5);
  ctx.draw.text({
    text: caption(node),
    x: x + 4,
    baselineY: y + height / 2 + sizePx * 0.35,
    sizePx,
    font: ctx.font,
    color: pdfColor(ctx.theme.imagePlaceholderText),
  });
};

/**
 * Fields, kept independent of any file format: DOCX maps a signature to a
 * Word signature line and the other kinds to content controls. This is the
 * inline field: one a signer completes after the seal, whose value the
 * document never holds, or an author's checkbox. Not in StarterKit; add it
 * where documents carry fields.
 */
export const Field = Extension.create({
  name: "field",

  addNodes() {
    return {
      field: {
        inline: true,
        group: "inline",
        atom: true,
        selectable: true,
        attrs: {
          nodeId: { default: null },
          kind: { default: "text" },
          fill: { default: "signer" },
          role: { default: null },
          required: { default: false },
          checked: { default: false },
          width: { default: SIZES.text.width },
          height: { default: SIZES.text.height },
        },
        parseDOM: [
          {
            tag: "span[data-field]",
            getAttrs(dom) {
              if (!(dom instanceof Element)) return false;
              const kind = dom.getAttribute("data-field");
              if (!isKind(kind)) return false;
              const fill = dom.getAttribute("data-fill") === "author" ? "author" : "signer";
              const role = dom.getAttribute("data-role");
              if (fill === "signer" && !role) return false;
              return {
                kind,
                fill,
                role: fill === "signer" ? role : null,
                required: fill === "signer" && dom.hasAttribute("data-required"),
                checked: fill === "author" && dom.hasAttribute("data-checked"),
                width: Number(dom.getAttribute("data-width")) || SIZES[kind].width,
                height: Number(dom.getAttribute("data-height")) || SIZES[kind].height,
              };
            },
          },
        ],
        toDOM(node) {
          const { kind, fill, role, required, checked, width, height } = node.attrs;
          return [
            "span",
            {
              "data-field": String(kind),
              "data-fill": String(fill),
              ...(typeof role === "string" ? { "data-role": role } : {}),
              ...(required === true ? { "data-required": "" } : {}),
              ...(checked === true ? { "data-checked": "" } : {}),
              "data-width": String(width),
              "data-height": String(height),
            },
          ];
        },
      },
    };
  },

  addMarks() {
    return {
      fieldRange: {
        attrs: {
          nodeId: { default: null },
          kind: { default: "text" },
          prompt: { default: "" },
          placeholder: { default: false },
        },
        // Typing at the end stays inside, as in Word; ArrowRight steps out.
        inclusive: true,
        parseDOM: [
          {
            tag: "span[data-field-range]",
            getAttrs(dom) {
              if (!(dom instanceof Element)) return false;
              const kind = dom.getAttribute("data-field-range") === "date" ? "date" : "text";
              return {
                kind,
                prompt: dom.getAttribute("data-prompt") ?? "",
                placeholder: dom.hasAttribute("data-placeholder"),
              };
            },
          },
        ],
        toDOM(mark) {
          const { kind, prompt, placeholder } = mark.attrs;
          return [
            "span",
            {
              "data-field-range": String(kind),
              "data-prompt": String(prompt),
              ...(placeholder === true ? { "data-placeholder": "" } : {}),
            },
            0,
          ];
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const type = this.schema?.marks["fieldRange"];
    return type ? [fieldRangePlugin(type)] : [];
  },

  addKeymap() {
    return { ArrowRight: exitFieldRange };
  },

  addMarkDecorators() {
    return { fieldRange: fieldRangeDecorator };
  },

  addCommands() {
    return {
      insertField: (options: InsertFieldOptions) => insertField(options),
      toggleFieldChecked: () => toggleFieldChecked,
      insertFieldRange: (options: InsertFieldRangeOptions) => insertFieldRange(options),
      exitFieldRange: () => exitFieldRange,
    };
  },

  addInlineHandlers() {
    return { field: fieldStrategy };
  },

  addExports() {
    return { pdf: { nodes: { field: fieldPdf }, marks: { fieldRange: fieldRangePdf } } };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    field: {
      /** Insert an inline field at the selection. */
      insertField: (options: InsertFieldOptions) => ReturnType;
      /** Check or uncheck the selected author checkbox. */
      toggleFieldChecked: () => ReturnType;
      /** Insert a text field's placeholder at the caret, or make the selection a filled field. */
      insertFieldRange: (options: InsertFieldRangeOptions) => ReturnType;
      /** Step out of a text field at its end, so what follows is plain text. */
      exitFieldRange: () => ReturnType;
    };
  }
}
