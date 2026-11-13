import { NodeSelection, Plugin, type Command } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import { lift, wrapIn } from "prosemirror-commands";
import type { Node as PmNode } from "prosemirror-model";
import { Extension } from "../Extension";
import { KeymapPriority, type IEditor } from "../types";
import type { InlineStrategy } from "../../layout/BlockRegistry";
import type { PdfNodeHandler } from "../../exports/pdf";
import { compositeColor, parseCssColor, type Rgb } from "../../model/cssColor";
import type { ResolvedTheme } from "../../model/theme";
import {
  BUILT_IN_FIELD_KINDS,
  checkboxTick,
  controlOf,
  fieldCaption,
  fieldIconStrokes,
  fieldInk,
  fieldLabel,
  fieldRoleColor,
  fieldChoices,
  fieldValueLayout,
  setsLike,
  type FieldChoice,
  type FieldControl,
  type FieldKind,
  type FieldKinds,
  type FieldOptions,
  type FieldValue,
} from "./fieldKinds";
import { safeImageUrl } from "../../model/safeUrl";
import { COLLAB_SYNC_META } from "./UniqueId";
import {
  fieldBlockDocx,
  fieldBlockImport,
  fieldDocx,
  fieldImport,
  fieldRangeImport,
  fieldRangeWrapper,
} from "./fieldDocx";
import {
  exitFieldRange,
  fieldRangeDecorator,
  fieldRangePdf,
  fieldRangePlugin,
  insertFieldRange,
  type InsertFieldRangeOptions,
} from "./fieldRange";

const distinctChoices = (choices: readonly FieldChoice[]): boolean =>
  choices.length > 0 && new Set(choices.map((c) => c.id)).size === choices.length;

/** A dropdown's choices from pasted HTML, where they travel as JSON. */
function choicesFromHtml(json: string | null): FieldChoice[] {
  if (!json) return [];
  try {
    return fieldChoices(JSON.parse(json));
  } catch {
    return [];
  }
}

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
  /** The choices a dropdown offers, each with an id of its own. Required for one. */
  options?: FieldChoice[];
}

/** A field a signer completes, as the host needs it to assign people to roles. */
export interface SignerFieldDescriptor {
  id: string;
  role: string;
  kind: FieldKind;
  required: boolean;
  /** A dropdown's choices; empty for every other kind. */
  options: FieldChoice[];
}

/**
 * The signer fields in a document, in reading order — what a host assigns
 * people to before sealing. Works on any document, so a backend can validate a
 * template on `ServerEditor`.
 */
export function listSignerFields(doc: PmNode): SignerFieldDescriptor[] {
  const fields: SignerFieldDescriptor[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "field" || node.attrs["fill"] !== "signer") return true;
    const { nodeId, role, kind, required, options } = node.attrs;
    if (typeof nodeId === "string" && typeof role === "string" && typeof kind === "string") {
      fields.push({ id: nodeId, role, kind, required: required === true, options: fieldChoices(options) });
    }
    return false;
  });
  return fields;
}

function insertField(options: InsertFieldOptions, kinds: FieldKinds): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes["field"];
    const spec = kinds[options.kind];
    if (!type || !spec) return false;
    const { kind, fill, role, required = false, options: choices = [] } = options;
    const control = spec.control ?? "text";
    // A signer field nobody is named for could never be completed; an author
    // fills anything but a checkbox as ordinary text; a dropdown with nothing
    // to choose offers no choice, and one whose choices share an id cannot
    // record which was chosen.
    if (fill === "signer" && !role) return false;
    if (fill === "author" && control !== "checkbox") return false;
    if (control === "dropdown" && !distinctChoices(choices)) return false;
    const node = type.create({
      kind,
      fill,
      role: fill === "signer" ? role : null,
      required: fill === "signer" && required,
      width: options.width ?? spec.size.width,
      height: options.height ?? spec.size.height,
      options: control === "dropdown" ? choices : [],
    });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}

/** Check or uncheck the selected author checkbox. A signer's checkbox holds no state. */
const toggleFieldChecked =
  (kinds: FieldKinds): Command =>
  (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof NodeSelection)) return false;
    const { node, from } = selection;
    if (node.type.name !== "field") return false;
    if (controlOf(kinds, node) !== "checkbox" || node.attrs["fill"] !== "author") return false;
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(from, undefined, { ...node.attrs, checked: node.attrs["checked"] !== true }));
    }
    return true;
  };

/** Wrap the selected blocks in a block field — Word's block-level content control. */
function insertFieldBlock({ kind, prompt }: InsertFieldRangeOptions): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes["fieldBlock"];
    return type ? wrapIn(type, { kind, prompt })(state, dispatch) : false;
  };
}

/** Take the block field around the selection away, keeping its content. */
const unwrapFieldBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "fieldBlock") return lift(state, dispatch);
  }
  return false;
};

const isSigner = (node: PmNode) => node.attrs["fill"] === "signer";

/**
 * Backspace (`-1`) or Delete (`1`) beside a field selects it first, as Word
 * does a content control; the next press removes it. A signer's box is never
 * lost to one keystroke meant for the letter beside it.
 */
const selectFieldBeside =
  (side: -1 | 1): Command =>
  (state, dispatch) => {
    const { selection } = state;
    if (!selection.empty) return false;
    const $pos = selection.$from;
    const node = side < 0 ? $pos.nodeBefore : $pos.nodeAfter;
    if (node?.type.name !== "field") return false;
    if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, side < 0 ? $pos.pos - node.nodeSize : $pos.pos)));
    return true;
  };

/**
 * A selected field is not typed or pasted over, as a Word content control
 * whose contents are locked is not: a signer fills it, and typing over it
 * would silently delete it. Delete and Backspace still remove it.
 */
const fieldBoxPlugin = new Plugin({
  filterTransaction(tr, state) {
    const { selection } = state;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== "field") return true;
    if (tr.getMeta(COLLAB_SYNC_META)) return true;
    // Rewriting the field itself — toggling a checkbox — puts a field back.
    const typedOver = (step: unknown) =>
      step instanceof ReplaceStep &&
      step.from === selection.from &&
      step.to === selection.to &&
      step.slice.size > 0 &&
      step.slice.content.firstChild?.type !== selection.node.type;
    return !tr.steps.some(typedOver);
  },
});

/** The built-in kinds, with the host's added over them. */
const resolveKinds = (options: FieldOptions): FieldKinds => ({ ...BUILT_IN_FIELD_KINDS, ...options.kinds });

const fieldStrategy = (kinds: FieldKinds, values: Readonly<Record<string, FieldValue>>): InlineStrategy => ({
  verticalAlign: "baseline",
  // A field that holds text is as tall as the text around it; one that holds
  // a drawing keeps its authored size, as an inline image does. Measuring
  // also records the run's font on the span — the face a PDF prints a value in.
  measure: (node, font, measurer) => {
    // Fits what it holds, like a Word content control: the value it is
    // printed with, or else the widest choice a dropdown offers. Free text
    // still to be given keeps the space its author left for it.
    const textFieldWidth = (field: PmNode, authored: number, face: string, m: typeof measurer): number => {
      const value = valueOf(values, field);
      if (value?.kind === "text") return Math.ceil(m.measureWidth(value.text, face)) + 4;
      if (controlOf(kinds, field) !== "dropdown") return authored;
      const ink = fieldInk({ x: 0, y: 0, width: authored, height: 24 });
      const widest = Math.max(0, ...fieldChoices(field.attrs["options"]).map((c) => m.measureWidth(c.label, face)));
      const label = m.measureWidth(fieldLabel(kinds, field), `${ink.labelSizePx}px sans-serif`) + ink.labelX + 2;
      return Math.ceil(Math.max(widest + 4, label));
    };
    const width = Number(node.attrs["width"]);
    const height = Number(node.attrs["height"]);
    const { ascent } = measurer.getFontMetrics(font);
    switch (setsLike(String(node.attrs["kind"]), controlOf(kinds, node))) {
      case "picture":
        return { width, height };
      case "glyph": {
        const side = Math.round(ascent * 0.8);
        return { width: side, height: side };
      }
      case "text":
        return { width: textFieldWidth(node, width, font, measurer), height: Math.round(ascent) };
    }
  },
  // Quiet ink: no box, just a dotted rule in its party's colour along the
  // line, with what the field is standing faintly on it.
  render(ctx, x, y, width, height, node, theme: ResolvedTheme) {
    ctx.save();
    const color = fieldRoleColor(isSigner(node) ? String(node.attrs["role"] ?? "") : null);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    if (controlOf(kinds, node) === "checkbox") {
      ctx.strokeRect(x + 0.75, y + 0.75, width - 1.5, height - 1.5);
      ctx.setLineDash([]);
      if (node.attrs["checked"] === true) {
        ctx.strokeStyle = theme.defaultText;
        ctx.lineWidth = 1.5;
        const [a, b, c] = checkboxTick({ x, y, width, height });
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    } else {
      paintFieldInk(ctx, { x, y, width, height }, { control: controlOf(kinds, node), label: fieldLabel(kinds, node), color });
    }
    ctx.restore();
  },
});

/**
 * An unfilled field in quiet ink: a rule along its line in `color` — dotted
 * unless `solid` — and its icon and label standing faintly on it.
 */
export function paintFieldInk(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  ink: { control: FieldControl; label: string; color: string; solid?: boolean; faint?: number },
): void {
  const at = fieldInk(box);
  ctx.save();
  ctx.strokeStyle = ink.color;
  ctx.lineWidth = ink.solid ? 2.5 : 1.5;
  ctx.setLineDash(ink.solid ? [] : [2, 2]);
  ctx.beginPath();
  ctx.moveTo(at.rule.from.x, at.rule.from.y - ctx.lineWidth / 2);
  ctx.lineTo(at.rule.to.x, at.rule.to.y - ctx.lineWidth / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = ink.faint ?? 0.75;
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const strokes = fieldIconStrokes(ink.control, at.icon);
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
    ctx.stroke();
  }
  ctx.fillStyle = ink.color;
  ctx.font = `${at.labelSizePx}px sans-serif`;
  ctx.textBaseline = "alphabetic";
  const labelX = strokes.length > 0 ? at.labelX : at.icon.x;
  ctx.fillText(ink.label, labelX, at.labelBaselineY, Math.max(0, box.x + box.width - labelX - 2));
  ctx.restore();
}

/** A role as a reader names it: "client" → "Client". */
export const roleName = (role: string | null | undefined): string =>
  role ? role.charAt(0).toUpperCase() + role.slice(1).replace(/[-_]/g, " ") : "A signer";

/** A small label above a field's box — who fills it, on screen only. */
export function paintFieldTag(ctx: CanvasRenderingContext2D, box: { x: number; y: number }, text: string, theme: ResolvedTheme): void {
  ctx.save();
  ctx.font = "11px sans-serif";
  const width = ctx.measureText(text).width + 12;
  const height = 18;
  const x = box.x;
  const y = box.y - height - 4;
  ctx.fillStyle = theme.defaultText;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.pageBg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 6, y + height / 2);
  ctx.restore();
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const pdfColor = (css: string): Rgb => {
  const parsed = parseCssColor(css);
  return parsed ? compositeColor(parsed, WHITE) : BLACK;
};

const valueOf = (values: Readonly<Record<string, FieldValue>>, node: PmNode): FieldValue | undefined => {
  const id = node.attrs["nodeId"];
  return typeof id === "string" ? values[id] : undefined;
};

/**
 * The same box as on canvas; a PDF cannot dash, so a signer field is outlined
 * solid. A field given a value prints the value instead — the executed document.
 */
const fieldPdf =
  (kinds: FieldKinds, values: Readonly<Record<string, FieldValue>>): PdfNodeHandler =>
  (block, ctx) => {
    const { node, x, y, width, height } = block;
    const value = valueOf(values, node);
    const roleColor = pdfColor(fieldRoleColor(isSigner(node) ? String(node.attrs["role"] ?? "") : null));
    const border = { color: roleColor, widthPx: 1 };
    const ink = pdfColor(ctx.theme.defaultText);
    if (controlOf(kinds, node) === "checkbox") {
      ctx.draw.rect({ x, y, width, height, border });
      const checked = value?.kind === "checkbox" ? value.checked : node.attrs["checked"] === true;
      if (checked) {
        const [a, b, c] = checkboxTick({ x, y, width, height });
        ctx.draw.line({ from: a, to: b, thicknessPx: 1.5, color: ink });
        ctx.draw.line({ from: b, to: c, thicknessPx: 1.5, color: ink });
      }
      return;
    }
    if (value?.kind === "image") {
      const src = safeImageUrl(value.src);
      if (src) ctx.draw.image({ x, y, width, height, image: { src }, fit: "contain" });
      return;
    }
    if (value?.kind === "text") {
      if (!ctx.font) return;
      const set = fieldValueLayout(value.text, { x, y, width, height }, ctx.font.cssFont);
      ctx.draw.text({ text: value.text, x: set.x, baselineY: set.baselineY, sizePx: set.sizePx, font: ctx.font, color: ink });
      return;
    }
    // A blank on a printed form: its line, and what goes on it.
    const at = fieldInk({ x, y, width, height });
    ctx.draw.line({ ...at.rule, thicknessPx: 1, color: roleColor });
    const strokes = fieldIconStrokes(controlOf(kinds, node), at.icon);
    for (const stroke of strokes) {
      for (let i = 1; i < stroke.length; i++) {
        ctx.draw.line({ from: stroke[i - 1]!, to: stroke[i]!, thicknessPx: 1, color: roleColor, opacity: 0.75 });
      }
    }
    if (!ctx.font) return;
    ctx.draw.text({
      text: fieldLabel(kinds, node),
      x: strokes.length > 0 ? at.labelX : at.icon.x,
      baselineY: at.labelBaselineY,
      sizePx: at.labelSizePx,
      font: ctx.font,
      color: roleColor,
      opacity: 0.75,
    });
  };

/**
 * Fields, in three shapes: a box a signer completes after the seal, whose
 * value the document never holds (or an author's checkbox); text the author
 * fills, as a `fieldRange` mark; and a templated block of paragraphs, as a
 * `fieldBlock` node. Kept independent of any file format: DOCX maps a
 * signature to a Word signature line and the rest to content controls. Not in
 * StarterKit; add it where documents carry fields.
 */
export const Field = Extension.create<FieldOptions>({
  name: "field",

  defaultOptions: { kinds: {}, values: {} },

  addNodes() {
    const kinds = resolveKinds(this.options);
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
          options: { default: [] },
          width: { default: BUILT_IN_FIELD_KINDS.text.size.width },
          height: { default: BUILT_IN_FIELD_KINDS.text.size.height },
        },
        parseDOM: [
          {
            tag: "span[data-field]",
            getAttrs(dom) {
              if (!(dom instanceof Element)) return false;
              const kind = dom.getAttribute("data-field");
              const spec = kind === null ? undefined : kinds[kind];
              if (!spec) return false;
              const fill = dom.getAttribute("data-fill") === "author" ? "author" : "signer";
              const role = dom.getAttribute("data-role");
              if (fill === "signer" && !role) return false;
              return {
                kind,
                fill,
                role: fill === "signer" ? role : null,
                required: fill === "signer" && dom.hasAttribute("data-required"),
                checked: fill === "author" && dom.hasAttribute("data-checked"),
                options: choicesFromHtml(dom.getAttribute("data-options")),
                width: Number(dom.getAttribute("data-width")) || spec.size.width,
                height: Number(dom.getAttribute("data-height")) || spec.size.height,
              };
            },
          },
        ],
        toDOM(node) {
          const { kind, fill, role, required, checked, options, width, height } = node.attrs;
          return [
            "span",
            {
              "data-field": String(kind),
              "data-fill": String(fill),
              ...(typeof role === "string" ? { "data-role": role } : {}),
              ...(required === true ? { "data-required": "" } : {}),
              ...(checked === true ? { "data-checked": "" } : {}),
              ...(Array.isArray(options) && options.length > 0 ? { "data-options": JSON.stringify(options) } : {}),
              "data-width": String(width),
              "data-height": String(height),
            },
          ];
        },
      },
      fieldBlock: {
        content: "block+",
        group: "block",
        defining: true,
        // No box of its own, as Word shows a block control only on focus.
        layout: { kind: "transparent" },
        attrs: {
          nodeId: { default: null },
          kind: { default: "text" },
          prompt: { default: "" },
        },
        parseDOM: [
          {
            tag: "div[data-field-block]",
            getAttrs(dom) {
              if (!(dom instanceof Element)) return false;
              return {
                kind: dom.getAttribute("data-field-block") === "date" ? "date" : "text",
                prompt: dom.getAttribute("data-prompt") ?? "",
              };
            },
          },
        ],
        toDOM(node) {
          return [
            "div",
            { "data-field-block": String(node.attrs["kind"]), "data-prompt": String(node.attrs["prompt"]) },
            0,
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
    return type ? [fieldBoxPlugin, fieldRangePlugin(type)] : [fieldBoxPlugin];
  },

  // Backspace beside a field selects it before any other binding acts.
  keymapPriority: KeymapPriority.inlineObject,

  addKeymap() {
    return { ArrowRight: exitFieldRange, Backspace: selectFieldBeside(-1), Delete: selectFieldBeside(1) };
  },

  onViewReady(editor: IEditor) {
    // A box a click selects and nothing types into: an arrow, not a move
    // cursor, while authoring. A read-only viewer's own extensions decide.
    const offCursor = editor.addPointerCursor(({ objectPos }) => {
      if (editor.readOnly || objectPos === null) return null;
      return editor.getState().doc.nodeAt(objectPos)?.type.name === "field" ? "default" : null;
    });
    // A selected signer box says who fills it, so the author does not try to.
    const offTag = editor.addOverlayRenderHandler((ctx, pageNumber, _pageConfig, charMap, theme) => {
      const { selection } = editor.getState();
      if (editor.readOnly || !(selection instanceof NodeSelection) || !isSigner(selection.node)) return;
      const box = charMap.getObjectRect(selection.from);
      if (!box || box.page !== pageNumber) return;
      paintFieldTag(ctx, box, `${roleName(String(selection.node.attrs["role"] ?? ""))} fills this after sealing`, theme);
    });
    return () => {
      offCursor();
      offTag();
    };
  },

  addMarkDecorators() {
    return { fieldRange: fieldRangeDecorator };
  },

  addCommands() {
    return {
      insertField: (options: InsertFieldOptions) => insertField(options, resolveKinds(this.options)),
      toggleFieldChecked: () => toggleFieldChecked(resolveKinds(this.options)),
      insertFieldRange: (options: InsertFieldRangeOptions) => insertFieldRange(options),
      exitFieldRange: () => exitFieldRange,
      insertFieldBlock: (options: InsertFieldRangeOptions) => insertFieldBlock(options),
      unwrapFieldBlock: () => unwrapFieldBlock,
    };
  },

  addInlineHandlers() {
    return { field: fieldStrategy(resolveKinds(this.options), this.options.values) };
  },

  addExports() {
    const kinds = resolveKinds(this.options);
    return {
      pdf: {
        nodes: { field: fieldPdf(kinds, this.options.values) },
        marks: { fieldRange: fieldRangePdf },
        // A drawn signature's bytes are fetched before the pages are written.
        embeds: {
          field: (node: PmNode) => {
            const value = valueOf(this.options.values, node);
            return value?.kind === "image" ? safeImageUrl(value.src) : null;
          },
        },
      },
      semantic: { nodes: { fieldBlock: () => ({ type: "fieldBlock" }) } },
      docx: {
        nodes: { field: fieldDocx(kinds), fieldBlock: fieldBlockDocx },
        markWrappers: { fieldRange: fieldRangeWrapper },
      },
    };
  },

  addMarkdownSerializerRules() {
    // Markdown has no fields: a field reads as its caption, a text field as
    // its text, a block field as what it holds.
    const kinds = resolveKinds(this.options);
    return {
      nodes: {
        field(state, node) {
          if (controlOf(kinds, node) === "checkbox") {
            state.text(node.attrs["checked"] === true ? "☒" : "☐");
            return;
          }
          state.text("[", false);
          state.text(fieldCaption(kinds, node));
          state.text("]", false);
        },
        fieldBlock(state, node) {
          state.renderContent(node);
        },
      },
      marks: {
        fieldRange: { open: "", close: "", mixable: true },
      },
    };
  },

  addImports() {
    return {
      docx: {
        inlines: { sdt: fieldImport },
        marks: { sdt: fieldRangeImport },
        blocks: { sdt: fieldBlockImport },
      },
    };
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
      /** Wrap the selected blocks in a block field. */
      insertFieldBlock: (options: InsertFieldRangeOptions) => ReturnType;
      /** Take the block field around the selection away, keeping its content. */
      unwrapFieldBlock: () => ReturnType;
    };
  }
}
