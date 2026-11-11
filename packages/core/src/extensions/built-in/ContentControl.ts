import { NodeSelection, type Command } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import { Extension } from "../Extension";
import type { InlineStrategy } from "../../layout/BlockRegistry";
import type { PdfNodeHandler } from "../../exports/pdf";
import { compositeColor, parseCssColor, type Rgb } from "../../model/cssColor";
import type { ResolvedTheme } from "../../model/theme";

export type ContentControlKind = "signature" | "initials" | "date" | "text" | "checkbox";

/** Who fills a control: the author while drafting, or a signer after the seal. */
export type ContentControlFill = "author" | "signer";

export interface InsertContentControlOptions {
  kind: ContentControlKind;
  fill: ContentControlFill;
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
  kind: ContentControlKind;
  required: boolean;
}

const KINDS: readonly ContentControlKind[] = ["signature", "initials", "date", "text", "checkbox"];

const isKind = (value: unknown): value is ContentControlKind =>
  typeof value === "string" && KINDS.some((kind) => kind === value);

const SIZES: Record<ContentControlKind, { width: number; height: number }> = {
  signature: { width: 180, height: 44 },
  initials: { width: 64, height: 36 },
  date: { width: 110, height: 24 },
  text: { width: 160, height: 24 },
  checkbox: { width: 16, height: 16 },
};

const LABELS: Record<ContentControlKind, string> = {
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
    if (node.type.name !== "contentControl" || node.attrs["fill"] !== "signer") return true;
    const { nodeId, role, kind, required } = node.attrs;
    if (typeof nodeId === "string" && typeof role === "string" && isKind(kind)) {
      fields.push({ id: nodeId, role, kind, required: required === true });
    }
    return false;
  });
  return fields;
}

function insertContentControl(options: InsertContentControlOptions): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes["contentControl"];
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
const toggleContentControlChecked: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return false;
  const { node, from } = selection;
  if (node.type.name !== "contentControl") return false;
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

const contentControlStrategy: InlineStrategy = {
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
const contentControlPdf: PdfNodeHandler = (block, ctx) => {
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
 * Content controls — Word's `<w:sdt>`. This is the inline control: a field a
 * signer completes after the seal, whose value the document never holds, or
 * an author's checkbox. Not in StarterKit; add it where documents carry fields.
 */
export const ContentControl = Extension.create({
  name: "contentControl",

  addNodes() {
    return {
      contentControl: {
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
            tag: "span[data-content-control]",
            getAttrs(dom) {
              if (!(dom instanceof Element)) return false;
              const kind = dom.getAttribute("data-content-control");
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
              "data-content-control": String(kind),
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

  addCommands() {
    return {
      insertContentControl: (options: InsertContentControlOptions) => insertContentControl(options),
      toggleContentControlChecked: () => toggleContentControlChecked,
    };
  },

  addInlineHandlers() {
    return { contentControl: contentControlStrategy };
  },

  addExports() {
    return { pdf: { nodes: { contentControl: contentControlPdf } } };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    contentControl: {
      /** Insert an inline content control at the selection. */
      insertContentControl: (options: InsertContentControlOptions) => ReturnType;
      /** Check or uncheck the selected author checkbox. */
      toggleContentControlChecked: () => ReturnType;
    };
  }
}
