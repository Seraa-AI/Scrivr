import { NodeSelection, Plugin, PluginKey, type Command, type EditorState } from "prosemirror-state";
import { isHistoryTransaction } from "prosemirror-history";
import { ReplaceStep } from "prosemirror-transform";
import { lift, wrapIn } from "prosemirror-commands";
import type { Node as PmNode } from "prosemirror-model";
import { Extension } from "../Extension";
import { KeymapPriority, type IBaseEditor, type IEditor } from "../types";
import type { InlineLine, InlineStrategy } from "../../layout/BlockRegistry";
import type { PdfNodeHandler } from "../../exports/pdf";
import { compositeColor, parseCssColor, type Rgb } from "../../model/cssColor";
import type { ResolvedTheme } from "../../model/theme";
import type { HoverResolver } from "../../hover/types";
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
  valueText,
  type FieldBox,
  type FieldChoice,
  type FieldControl,
  type FieldDrawing,
  type FieldKind,
  type FieldKinds,
  type FieldOptions,
  type FieldValue,
} from "./fieldKinds";
import { safeImageUrl } from "../../model/safeUrl";
import { COLLAB_SYNC_META } from "./UniqueId";
import { getCachedImage, onImageLoad } from "./Image";
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
  fieldRangeAt,
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
    // A collaborator's edit, or undo putting back what the field replaced.
    if (tr.getMeta(COLLAB_SYNC_META) || isHistoryTransaction(tr)) return true;
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

type FieldValues = Readonly<Record<string, FieldValue>>;

/**
 * Completed values, held by the editor beside its document rather than in
 * it: changing one is no edit, so a sealed document takes it and its hash
 * holds. Undo never sees one.
 */
const fieldValuesKey = new PluginKey<FieldValues>("fieldValues");

const fieldValuesPlugin = (initial: FieldValues) =>
  new Plugin<FieldValues>({
    key: fieldValuesKey,
    state: {
      init: () => initial,
      apply(tr, values) {
        const given: { id: string; value: FieldValue | null } | undefined = tr.getMeta(fieldValuesKey);
        if (!given) return values;
        const { [given.id]: _replaced, ...rest } = values;
        return given.value ? { ...rest, [given.id]: given.value } : rest;
      },
    },
  });

/** The values fields hold in `state`, by field id. */
export const fieldValues = (state: EditorState): FieldValues => fieldValuesKey.getState(state) ?? {};

/**
 * Give field `id` a value — `null` empties it. The field is laid out, drawn
 * and printed with it; the document is untouched. Returns false when the
 * editor has no `Field`.
 */
export function setFieldValue(editor: IBaseEditor, id: string, value: FieldValue | null): boolean {
  const state = editor.getState();
  if (!fieldValuesKey.get(state)) return false;
  return editor.applyTransaction(state.tr.setMeta(fieldValuesKey, { id, value }).setMeta("addToHistory", false));
}

interface FieldSetup {
  kinds: FieldKinds;
  options: FieldOptions;
  editor: IBaseEditor;
}

/**
 * Each editor's `Field`, by the context its contributions were resolved in —
 * how layout and export, which are handed no editor, read that editor's values.
 */
const setupByContext = new WeakMap<object, FieldSetup>();
const setupByEditor = new WeakMap<IBaseEditor, FieldSetup>();

/** The values a contribution resolved in `context` lays out and prints with. */
const valuesIn = (context: object, options: FieldOptions): FieldValues => {
  const setup = setupByContext.get(context);
  return setup ? fieldValues(setup.editor.getState()) : options.values;
};

/**
 * The field at `pos` as `editor`'s `Field` would hand it to a host's drawing —
 * its kind, label, party colour and value — or null when there is none.
 */
export function fieldDrawingAt(
  editor: IBaseEditor,
  pos: number,
  at: { box: FieldBox; baselineY: number; theme: ResolvedTheme },
): FieldDrawing | null {
  const setup = setupByEditor.get(editor);
  const node = editor.getState().doc.nodeAt(pos);
  if (!setup || node?.type.name !== "field") return null;
  return drawingOf(setup.kinds, setup.options, fieldValues(editor.getState()), node, at);
}

/** A field as a host's own drawing is handed it. */
const drawingOf = (
  kinds: FieldKinds,
  options: FieldOptions,
  values: FieldValues,
  node: PmNode,
  at: { box: FieldBox; baselineY: number; theme: ResolvedTheme },
): FieldDrawing => {
  const role = isSigner(node) && typeof node.attrs["role"] === "string" ? node.attrs["role"] : null;
  const value = valueOf(values, node);
  return {
    node,
    ...at,
    kind: String(node.attrs["kind"]),
    control: controlOf(kinds, node),
    label: fieldLabel(kinds, node),
    role,
    color: fieldRoleColor(role, options.roleColors),
    ...(value ? { value } : {}),
  };
};

/**
 * How wide a field set like text is. It fits what it holds, like a Word
 * content control: its value, or else the widest choice a dropdown offers.
 * Free text still to be given keeps the space its author left for it.
 */
function textFieldWidth(
  kinds: FieldKinds,
  field: PmNode,
  text: string | null,
  line: { font: string; height: number },
  measurer: { measureWidth(text: string, font: string): number },
): number {
  if (text !== null) return Math.ceil(measurer.measureWidth(text, line.font)) + 4;
  const authored = Number(field.attrs["width"]);
  if (controlOf(kinds, field) !== "dropdown") return authored;
  const ink = fieldInk({ x: 0, y: 0, width: authored, height: line.height });
  const widest = Math.max(0, ...fieldChoices(field.attrs["options"]).map((c) => measurer.measureWidth(c.label, line.font)));
  const label = measurer.measureWidth(fieldLabel(kinds, field), `${ink.labelSizePx}px sans-serif`) + ink.labelX + 2;
  return Math.ceil(Math.max(widest + 4, label));
}

const fieldStrategy = (kinds: FieldKinds, options: FieldOptions, values: () => FieldValues): InlineStrategy => ({
  verticalAlign: "baseline",
  // A field that holds text is as tall as the text around it; one that holds
  // a drawing keeps its authored size, as an inline image does. Measuring
  // also records the run's font on the span — the face its value is set in.
  measure: (node, font, measurer) => {
    const text = valueText(valueOf(values(), node), node);
    const { ascent, descent } = measurer.getFontMetrics(font);
    const height = Math.round(ascent + descent);
    // Typed text is set as text, whatever the field: a typed signature too.
    const like = text !== null ? "text" : setsLike(String(node.attrs["kind"]), controlOf(kinds, node));
    switch (like) {
      case "picture":
        return { width: Number(node.attrs["width"]), height: Number(node.attrs["height"]) };
      case "glyph": {
        const side = Math.round(ascent * 0.8);
        return { width: side, height: side };
      }
      case "text":
        // The whole text line, as a word fills it: above the baseline and below.
        return { width: textFieldWidth(kinds, node, text, { font, height }, measurer), height, verticalAlign: "text-bottom" };
    }
  },
  render(ctx, x, y, width, height, node, theme: ResolvedTheme, line: InlineLine) {
    const box = { x, y, width, height };
    const drawing = drawingOf(kinds, options, values(), node, { box, baselineY: line.baselineY, theme });
    if (options.paint?.(ctx, drawing)) return;
    const text = valueText(drawing.value, node);
    if (drawing.control !== "checkbox" && (text !== null || drawing.value?.kind === "image")) {
      paintFieldValue(ctx, box, { text, value: drawing.value }, { ...line, ink: theme.defaultText });
      return;
    }
    if (drawing.control !== "checkbox") {
      // Quiet ink: a dotted rule in its party's colour along the line, with
      // what the field is standing faintly on it.
      paintFieldInk(ctx, box, { control: drawing.control, label: drawing.label, color: drawing.color, baselineY: line.baselineY });
      return;
    }
    paintCheckbox(ctx, box, { checked: isChecked(drawing), color: drawing.color, pageBg: theme.pageBg });
  },
});

/** A checkbox's tick: the signer's answer, or else the author's. */
const isChecked = (field: FieldDrawing): boolean =>
  field.value?.kind === "checkbox" ? field.value.checked : field.node.attrs["checked"] === true;

/**
 * A checkbox as a native control draws one: a rounded box in its colour,
 * filled with it and a white tick once checked. `hover` tints an empty box
 * that can be ticked.
 */
export function paintCheckbox(
  ctx: CanvasRenderingContext2D,
  box: FieldBox,
  look: { checked: boolean; color: string; pageBg: string; hover?: boolean },
): void {
  const { x, y, width, height } = box;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x + 0.75, y + 0.75, width - 1.5, height - 1.5, Math.min(3, width / 5));
  ctx.fillStyle = look.checked ? look.color : look.pageBg;
  ctx.fill();
  if (!look.checked) {
    if (look.hover) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = look.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = look.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    const [a, b, c] = checkboxTick(box);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, width * 0.13);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A completed value, as part of the document: text on the line in the font
 * around it, or the drawn signature fitted to its box.
 */
function paintFieldValue(
  ctx: CanvasRenderingContext2D,
  box: FieldBox,
  { text, value }: { text: string | null; value: FieldValue | undefined },
  line: InlineLine & { ink: string },
): void {
  ctx.save();
  if (text !== null) {
    const set = fieldValueLayout(box, line.font, line.baselineY);
    ctx.font = set.font;
    ctx.fillStyle = line.ink;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, set.x, set.baselineY);
  } else if (value?.kind === "image") {
    const src = safeImageUrl(value.src);
    const img = src ? getCachedImage(src) : null;
    if (img) {
      const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, box.x + (box.width - w) / 2, box.y + (box.height - h) / 2, w, h);
    }
  }
  ctx.restore();
}

/**
 * An unfilled field in quiet ink: a rule along its line in `color` — dotted
 * unless `solid` — and its icon and label standing faintly on it.
 */
export function paintFieldInk(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  ink: { control: FieldControl; label: string; color: string; solid?: boolean; faint?: number; baselineY?: number },
): void {
  const at = fieldInk(box, ink.baselineY);
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
  // The page's own colours, light or dark: a note on the page, not a chip over it.
  ctx.fillStyle = theme.pageBg;
  ctx.strokeStyle = theme.imagePlaceholderBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, width, height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = theme.imagePlaceholderText;
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

const valueOf = (values: FieldValues, node: PmNode): FieldValue | undefined => {
  const id = node.attrs["nodeId"];
  return typeof id === "string" ? values[id] : undefined;
};

/**
 * The same blank as on canvas, but a PDF cannot dash, so its rule prints
 * solid, and it names whose it is — a printed page may have no colour. A
 * field with a value prints the value instead: the executed document.
 */
const fieldPdf =
  (kinds: FieldKinds, options: FieldOptions, values: () => FieldValues): PdfNodeHandler =>
  (block, ctx) => {
    const { node, x, y, width, height } = block;
    const drawing = drawingOf(kinds, options, values(), node, { box: { x, y, width, height }, baselineY: ctx.baselineY ?? y + height, theme: ctx.theme });
    if (options.print?.(ctx, drawing)) return;
    const value = drawing.value;
    const roleColor = pdfColor(drawing.color);
    const border = { color: roleColor, widthPx: 1 };
    const ink = pdfColor(ctx.theme.defaultText);
    if (controlOf(kinds, node) === "checkbox") {
      ctx.draw.rect({ x, y, width, height, border });
      if (isChecked(drawing)) {
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
    const text = valueText(value, node);
    if (text !== null) {
      if (!ctx.font) return;
      const set = fieldValueLayout({ x, y, width, height }, ctx.font.cssFont, ctx.baselineY);
      ctx.draw.text({ text, x: set.x, baselineY: set.baselineY, sizePx: set.sizePx, font: ctx.font, color: ink });
      return;
    }
    // A blank on a printed form: its line, and what goes on it.
    const at = fieldInk({ x, y, width, height }, ctx.baselineY);
    ctx.draw.line({ ...at.rule, thicknessPx: 1, color: roleColor });
    const strokes = fieldIconStrokes(controlOf(kinds, node), at.icon);
    for (const stroke of strokes) {
      for (let i = 1; i < stroke.length; i++) {
        ctx.draw.line({ from: stroke[i - 1]!, to: stroke[i]!, thicknessPx: 1, color: roleColor, opacity: 0.75 });
      }
    }
    if (!ctx.font) return;
    ctx.draw.text({
      text: fieldCaption(kinds, node),
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

  addHoverResolvers(): HoverResolver[] {
    // An author's filled text reads as the document's own; under the pointer
    // it can show which words were filled in, as Word frames a content control.
    return [
      {
        mark: "fieldRange",
        range: (doc, pos) => {
          const type = doc.type.schema.marks["fieldRange"];
          return type ? fieldRangeAt(doc, pos, type) : null;
        },
      },
    ];
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
    const plugins = [fieldBoxPlugin, fieldValuesPlugin(this.options.values)];
    return type ? [...plugins, fieldRangePlugin(type)] : plugins;
  },

  onEditorReady(editor: IBaseEditor) {
    const setup = { kinds: resolveKinds(this.options), options: this.options, editor };
    setupByContext.set(this, setup);
    setupByEditor.set(editor, setup);
    return () => {
      setupByContext.delete(this);
      setupByEditor.delete(editor);
    };
  },

  // Backspace beside a field selects it before any other binding acts.
  keymapPriority: KeymapPriority.inlineObject,

  addKeymap() {
    return { ArrowRight: exitFieldRange, Backspace: selectFieldBeside(-1), Delete: selectFieldBeside(1) };
  },

  onViewReady(editor: IEditor) {
    // A field fits its value, so a new value is measured again.
    let values = fieldValues(editor.getState());
    const offValues = editor.on("update", () => {
      const next = fieldValues(editor.getState());
      if (next === values) return;
      values = next;
      editor.invalidateLayout({ remeasure: true });
    });
    const offImages = onImageLoad(() => editor.redraw());
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
      offValues();
      offImages();
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
    return { field: fieldStrategy(resolveKinds(this.options), this.options, () => valuesIn(this, this.options)) };
  },

  addExports() {
    const kinds = resolveKinds(this.options);
    return {
      pdf: {
        nodes: { field: fieldPdf(kinds, this.options, () => valuesIn(this, this.options)) },
        marks: { fieldRange: fieldRangePdf },
        // A drawn signature's bytes are fetched before the pages are written.
        embeds: {
          field: (node: PmNode) => {
            const value = valueOf(valuesIn(this, this.options), node);
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
        inlines: { sdt: fieldImport(resolveKinds(this.options)) },
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
