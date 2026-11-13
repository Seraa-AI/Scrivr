import {
  BUILT_IN_FIELD_KINDS,
  Extension,
  checkboxTick,
  fieldRoleColor,
  fieldValueLayout,
  fieldVerb,
  paintFieldInk,
  paintFieldTag,
  roleName,
  safeImageUrl,
} from "@scrivr/core";
import type {
  FieldKindSpec,
  FieldValue,
  IBaseEditor,
  IEditor,
  PagePoint,
  ResolvedTheme,
  SignerFieldDescriptor,
} from "@scrivr/core";

const BUILT_IN_KINDS: Readonly<Record<string, FieldKindSpec>> = BUILT_IN_FIELD_KINDS;
import type { Node as PmNode } from "@scrivr/core/pm";

export interface FieldCompletionOptions {
  /** The sealed snapshot's signer fields. */
  fields: SignerFieldDescriptor[];
  /** Ids of the fields this viewer may complete. */
  completable: string[];
  /** Values already completed, by field id — shown, and reopened with when pressed. */
  values: Record<string, FieldValue>;
  /**
   * The viewer pressed a field they may complete — `current` is its value when
   * they are changing one. The host captures the value however it must —
   * signature pad, consent, authentication — records its evidence, and
   * resolves with the value to show, or `null` to leave the field as it was.
   * Scrivr keeps nothing. Stop offering a field by leaving it out of
   * `completable`, once the viewer has finished.
   */
  onFieldRequest: (field: SignerFieldDescriptor, current?: FieldValue) => Promise<FieldValue | null>;
  /** Colour of the viewer's own fields. Defaults to their party's colour, as the author saw it. */
  accentColor?: string;
}

interface FieldState {
  values: Map<string, FieldValue>;
  repaint: () => void;
  /** Ask the host for `id`'s value, scrolled into view; false when this viewer may not. */
  request: (id: string) => boolean;
  /** Move keyboard focus to the viewer's next (`1`) or previous (`-1`) field. */
  moveFocus: (direction: 1 | -1) => string | null;
  /** Open the field keyboard focus is on. */
  openFocused: () => boolean;
}

const fieldStates = new WeakMap<IBaseEditor, FieldState>();
/** Key handlers are handed the editor's navigator, not the editor. */
const byNavigator = new WeakMap<object, FieldState>();

/** Show a value completed elsewhere — another participant signed. */
export function setFieldValue(editor: IBaseEditor, id: string, value: FieldValue): void {
  const state = fieldStates.get(editor);
  if (!state) return;
  state.values.set(id, value);
  state.repaint();
}

/**
 * Open a field the viewer may complete, as if they had pressed it — scrolled
 * into view first. What a host's list of fields, or its "Next field" button,
 * calls. Returns false when this viewer may not complete it.
 */
export function requestField(editor: IBaseEditor, id: string): boolean {
  return fieldStates.get(editor)?.request(id) ?? false;
}

/**
 * Move keyboard focus to the viewer's next (`1`) or previous (`-1`) field in
 * reading order, wrapping around, and scroll it into view: Tab and Shift+Tab.
 * Returns the focused field's id, or null when the viewer completes none.
 */
export function moveFieldFocus(editor: IBaseEditor, direction: 1 | -1): string | null {
  return fieldStates.get(editor)?.moveFocus(direction) ?? null;
}

/** Where each field node is in `doc`, by id. Read again only when the document is replaced. */
function fieldPositions(doc: PmNode): Map<string, number> {
  const positions = new Map<string, number>();
  doc.descendants((node, pos) => {
    const id = node.attrs["nodeId"];
    if (node.type.name === "field" && typeof id === "string") positions.set(id, pos);
    return node.isBlock;
  });
  return positions;
}

/**
 * Completing fields on a sealed revision. A value is painted inside its
 * field's box, wherever this editor laid that box out, and never written to
 * the document: the box's size was fixed when the field was authored, so a
 * value changes neither the document nor its layout, and the seal — and its
 * hash — hold from the first signer to the last.
 *
 * The viewer's own fields show a hand and highlight under the pointer; a
 * click, or Enter on the field Tab moved to, opens one — again to change it.
 * Someone else's field says whose it is.
 */
export const FieldCompletion = Extension.create<FieldCompletionOptions>({
  name: "fieldCompletion",

  defaultOptions: {
    fields: [],
    completable: [],
    values: {},
    onFieldRequest: async () => null,
  },

  addInputHandlers() {
    const on = (act: (state: FieldState) => boolean) => (nav: object) => {
      const state = byNavigator.get(nav);
      return state ? act(state) : false;
    };
    return {
      Tab: on((state) => state.moveFocus(1) !== null),
      "Shift-Tab": on((state) => state.moveFocus(-1) !== null),
      Enter: on((state) => state.openFocused()),
    };
  },

  onViewReady(editor: IEditor) {
    const { fields, completable, onFieldRequest, accentColor } = this.options;
    const mayComplete = new Set(completable);
    const mine = fields.filter((f) => mayComplete.has(f.id));
    const pending = new Set<string>();
    const images = new Map<string, HTMLImageElement>();
    let hovered: string | null = null;
    let focused: string | null = null;

    let positionsOf: { doc: PmNode; positions: Map<string, number> } | null = null;
    const positions = (): Map<string, number> => {
      const doc = editor.getState().doc;
      if (positionsOf?.doc !== doc) positionsOf = { doc, positions: fieldPositions(doc) };
      return positionsOf.positions;
    };
    const positionOf = (id: string): number | undefined => positions().get(id);
    const fieldAt = (pos: number): SignerFieldDescriptor | undefined => {
      for (const [id, at] of positions()) if (at === pos) return fields.find((f) => f.id === id);
      return undefined;
    };

    const imageFor = (src: string): HTMLImageElement | null => {
      const safe = safeImageUrl(src);
      if (!safe) return null;
      const cached = images.get(safe);
      if (cached) return cached.complete ? cached : null;
      const img = new Image();
      img.onload = () => editor.redraw();
      img.src = safe;
      images.set(safe, img);
      return null;
    };

    const reveal = (id: string): void => {
      const pos = positionOf(id);
      if (pos !== undefined) editor.scrollRangeIntoView(pos, pos + 1);
    };

    const ask = (field: SignerFieldDescriptor): void => {
      pending.add(field.id);
      editor.redraw();
      // Asked inside an executor, so a request that throws before returning a
      // promise fails like one that rejects.
      const current = state.values.get(field.id);
      new Promise<FieldValue | null>((resolve) => resolve(onFieldRequest(field, current)))
        .then((value) => {
          if (value) state.values.set(field.id, value);
        })
        .catch(() => {
          // The host's request failed; the field stays as it was. Declining
          // is answering `null`, which leaves it as it was too.
        })
        .finally(() => {
          pending.delete(field.id);
          editor.redraw();
        });
    };

    const state: FieldState = {
      values: new Map(Object.entries(this.options.values)),
      repaint: () => editor.redraw(),
      request: (id) => {
        const field = mine.find((f) => f.id === id);
        if (!field || pending.has(id)) return false;
        reveal(id);
        focused = id;
        ask(field);
        return true;
      },
      moveFocus: (direction) => {
        if (mine.length === 0) return null;
        const at = focused === null ? (direction > 0 ? -1 : 0) : mine.findIndex((f) => f.id === focused);
        const next = mine[(at + direction + mine.length) % mine.length]!;
        focused = next.id;
        reveal(next.id);
        editor.redraw();
        return next.id;
      },
      openFocused: () => focused !== null && state.request(focused),
    };
    fieldStates.set(editor, state);
    byNavigator.set(editor.selection, state);

    /** Whether the point is in the field's box — the same box the overlay paints. */
    const isOver = (field: SignerFieldDescriptor, at: PagePoint): boolean => {
      const pos = positionOf(field.id);
      const page = editor.getPageScreenPosition(at.page);
      if (pos === undefined || !page) return false;
      return editor.getNodeViewportRects(pos).some((rect) => {
        const x = rect.left - page.screenLeft;
        const y = rect.top - page.screenTop;
        return at.x >= x && at.x <= x + rect.width && at.y >= y && at.y <= y + rect.height;
      });
    };

    const offPress = editor.on("press", ({ point, clickCount }) => {
      if (clickCount !== 1) return;
      const field = mine.find((f) => isOver(f, point));
      if (field) state.request(field.id);
    });

    const offHover = editor.on("hover", ({ point }) => {
      const next = point ? (fields.find((f) => isOver(f, point))?.id ?? null) : null;
      if (next === hovered) return;
      hovered = next;
      editor.redraw();
    });

    const offCursor = editor.addPointerCursor(({ objectPos }) => {
      const field = objectPos === null ? undefined : fieldAt(objectPos);
      if (!field) return null;
      return mayComplete.has(field.id) ? "pointer" : "default";
    });

    const offPaint = editor.addOverlayRenderHandler((ctx, pageNumber, _pageConfig, charMap, theme) => {
      for (const field of fields) {
        const pos = positionOf(field.id);
        const box = pos === undefined ? undefined : charMap.getObjectRect(pos);
        if (!box || box.page !== pageNumber) continue;
        paintField(ctx, box, {
          field,
          value: state.values.get(field.id),
          own: mayComplete.has(field.id),
          active: field.id === hovered || field.id === focused,
          focused: field.id === focused,
          color: accentColor ?? fieldRoleColor(field.role),
          theme,
          imageFor,
        });
      }
    });

    return () => {
      offPress();
      offHover();
      offCursor();
      offPaint();
      fieldStates.delete(editor);
      byNavigator.delete(editor.selection);
    };
  },
});

interface FieldPaint {
  field: SignerFieldDescriptor;
  value: FieldValue | undefined;
  /** This viewer completes it. */
  own: boolean;
  /** Under the pointer, or keyboard focus. */
  active: boolean;
  focused: boolean;
  color: string;
  theme: ResolvedTheme;
  imageFor: (src: string) => HTMLImageElement | null;
}

type Box = { x: number; y: number; width: number; height: number; font?: string };

/**
 * One field as a signer sees it, over the author's ink. The viewer's own
 * empty fields are drawn solid in their colour with what to do on a badge;
 * everyone else's fade. A completed value is just text in the document, and
 * shows it can still be changed only under the pointer or keyboard focus.
 */
function paintField(ctx: CanvasRenderingContext2D, box: Box, f: FieldPaint): void {
  const { x, y, width, height } = box;
  const spec = BUILT_IN_KINDS[f.field.kind];
  const control = spec?.control ?? "text";
  ctx.save();
  // The author's ink goes: this view draws the field its own way.
  ctx.fillStyle = f.theme.pageBg;
  ctx.fillRect(x - 1, y - 1, width + 2, height + 3);
  if (f.own && f.active) {
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = f.color;
    ctx.fillRect(x, y, width, height);
    ctx.globalAlpha = 1;
  }

  if (control === "checkbox") {
    const ticked = f.value?.kind === "checkbox" && f.value.checked;
    ctx.strokeStyle = f.own ? f.color : f.theme.imagePlaceholderBorder;
    ctx.lineWidth = f.own ? 1.5 : 1;
    if (!f.own && !ticked) ctx.setLineDash([2, 2]);
    ctx.strokeRect(x + 0.75, y + 0.75, width - 1.5, height - 1.5);
    ctx.setLineDash([]);
    if (ticked) paintTick(ctx, box, f.theme.defaultText);
  } else if (f.value) {
    paintValue(ctx, box, f.value, f.theme.defaultText, f.imageFor);
    if (f.own && f.active) {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, y + height - 0.5);
      ctx.lineTo(x + width, y + height - 0.5);
      ctx.stroke();
    }
  } else if (f.own) {
    const label = spec?.label ?? f.field.kind;
    const verb = fieldVerb(f.field.kind, control);
    paintFieldInk(ctx, box, { control, label, color: f.color, solid: true, faint: 1 });
    // Said once: a label that is already the verb needs no badge repeating it.
    if (verb !== label) paintBadge(ctx, box, verb, f.color, f.theme.pageBg);
  } else {
    paintFieldInk(ctx, box, { control, label: roleName(f.field.role), color: f.theme.imagePlaceholderBorder, faint: 0.8 });
  }

  if (f.focused) {
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 2.5, y - 2.5, width + 5, height + 5);
  }
  ctx.restore();
  if (!f.own && f.active) paintFieldTag(ctx, box, `For the ${roleName(f.field.role)}`, f.theme);
}

/** What the signer does, on a small badge at the end of the field's line. */
function paintBadge(ctx: CanvasRenderingContext2D, box: Box, text: string, color: string, ink: string): void {
  ctx.font = "bold 9px sans-serif";
  const width = ctx.measureText(text).width + 10;
  const height = 13;
  const x = box.x + box.width - width;
  const y = box.y + box.height - height / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 5, y + height / 2 + 0.5);
}

function paintTick(ctx: CanvasRenderingContext2D, box: Box, ink: string): void {
  const [a, b, c] = checkboxTick(box);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
}

/** A completed value, as part of the document: text on the line, or the drawn signature. */
function paintValue(
  ctx: CanvasRenderingContext2D,
  box: Box,
  value: FieldValue,
  ink: string,
  imageFor: (src: string) => HTMLImageElement | null,
): void {
  const { x, y, width, height } = box;
  if (value.kind === "text") {
    const set = fieldValueLayout(value.text, box, box.font);
    const font = box.font ?? "sans-serif";
    ctx.font = /\d+(\.\d+)?px/.test(font) ? font.replace(/\d+(\.\d+)?px/, `${set.sizePx}px`) : `${set.sizePx}px ${font}`;
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(value.text, set.x, set.baselineY, width - 4);
  } else if (value.kind === "image") {
    const img = imageFor(value.src);
    if (!img) return;
    const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, x + (width - w) / 2, y + (height - h) / 2, w, h);
  }
}
