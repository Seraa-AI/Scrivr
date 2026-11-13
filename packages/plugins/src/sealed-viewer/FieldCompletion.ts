import {
  Extension,
  fieldDrawingAt,
  fieldValues,
  fieldVerb,
  paintCheckboxTick,
  paintFieldInk,
  paintFieldTag,
  roleName,
  setFieldValue,
} from "@scrivr/core";
import type {
  FieldBox,
  FieldDrawing,
  FieldValue,
  IBaseEditor,
  IEditor,
  PagePoint,
  ResolvedTheme,
  SignerFieldDescriptor,
} from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";

export interface FieldCompletionOptions {
  /** The sealed snapshot's signer fields. */
  fields: SignerFieldDescriptor[];
  /** Ids of the fields this viewer may complete, read when the editor mounts. */
  completable: string[];
  /**
   * The viewer pressed a field they may complete — `current` is its value when
   * they are changing one. The host captures the value however it must —
   * signature pad, consent, authentication — records its evidence, and
   * resolves with the value the field takes, or `null` to leave it as it was.
   * Scrivr keeps the value only beside the document, as `setFieldValue` does.
   */
  onFieldRequest: (field: SignerFieldDescriptor, current?: FieldValue) => Promise<FieldValue | null>;
  /**
   * `onFieldRequest` failed — it threw or rejected. The field stays as it was;
   * tell the signer, and let them try again.
   */
  onFieldRequestError?: (field: SignerFieldDescriptor, error: unknown) => void;
  /** Colour of the viewer's own fields. Defaults to their party's colour, as the author saw it. */
  accentColor?: string;
  /**
   * Draw a field yourself, as a signer sees it. Return `true` when you drew
   * it; `false` leaves Scrivr's look for that field.
   */
  paint?: (ctx: CanvasRenderingContext2D, field: SigningFieldDrawing) => boolean;
}

/** A field as a signer sees it — what a host's own drawing gets. */
export interface SigningFieldDrawing extends FieldDrawing {
  /** This viewer completes it. */
  own: boolean;
  /** Under the pointer, or keyboard focus. */
  active: boolean;
  focused: boolean;
  /** The host is capturing its value. */
  pending: boolean;
}

interface FieldState {
  /** Ask the host for `id`'s value, scrolled into view; false when this viewer may not, or it is open. */
  request: (id: string) => boolean;
  /** Move keyboard focus to the viewer's next (`1`) or previous (`-1`) field. */
  moveFocus: (direction: 1 | -1) => string | null;
  /** Open the field keyboard focus is on. */
  openFocused: () => boolean;
}

const fieldStates = new WeakMap<IBaseEditor, FieldState>();
/** Key handlers are handed the editor's navigator, not the editor. */
const byNavigator = new WeakMap<object, FieldState>();

/**
 * Open a field the viewer may complete, as if they had pressed it — scrolled
 * into view first. What a host's list of fields, or its "Next field" button,
 * calls. Returns false when this viewer may not complete it, or it is already open.
 */
export function requestField(editor: IBaseEditor, id: string): boolean {
  return fieldStates.get(editor)?.request(id) ?? false;
}

/**
 * Move keyboard focus to the viewer's next (`1`) or previous (`-1`) field in
 * reading order and scroll it into view: Tab and Shift+Tab. Returns the
 * focused field's id, or null once focus has left past either end — Tab then
 * goes on to the page's next control.
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
 * Completing fields on a sealed revision. A value is given to `Field`, which
 * holds it beside the document, never in it: the field fits its value and
 * the text closes up around it, as on the executed PDF, while the seal — and
 * its hash — hold from the first signer to the last. Kinds and party colours
 * are `Field`'s own, as the author saw them.
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
    const { fields, completable, onFieldRequest, onFieldRequestError, accentColor, paint } = this.options;
    const mayComplete = new Set(completable);
    const mine = fields.filter((f) => mayComplete.has(f.id));
    const pending = new Set<string>();
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

    const reveal = (id: string): void => {
      const pos = positionOf(id);
      if (pos !== undefined) editor.scrollRangeIntoView(pos, pos + 1);
    };

    const ask = (field: SignerFieldDescriptor): void => {
      pending.add(field.id);
      editor.redraw();
      // Asked inside an executor, so a request that throws before returning a
      // promise fails like one that rejects.
      const current = fieldValues(editor.getState())[field.id];
      new Promise<FieldValue | null>((resolve) => resolve(onFieldRequest(field, current)))
        .then((value) => {
          if (value) setFieldValue(editor, field.id, value);
        })
        .catch((error: unknown) => {
          // The field stays as it was. Declining is answering `null`, which
          // leaves it as it was too, and is no failure.
          onFieldRequestError?.(field, error);
        })
        .finally(() => {
          pending.delete(field.id);
          editor.redraw();
        });
    };

    const state: FieldState = {
      request: (id) => {
        const field = mine.find((f) => f.id === id);
        if (!field || pending.has(id)) return false;
        reveal(id);
        focused = id;
        ask(field);
        return true;
      },
      moveFocus: (direction) => {
        const at = focused === null ? (direction > 0 ? -1 : mine.length) : mine.findIndex((f) => f.id === focused);
        // Past either end focus leaves, as Tab leaves a form: the key goes on
        // to the next control on the page instead of cycling here.
        const next = mine[at + direction];
        focused = next?.id ?? null;
        if (next) reveal(next.id);
        editor.redraw();
        return focused;
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
      else if (focused !== null) {
        // Pressing elsewhere moves the reader on, as clicking off a form control does.
        focused = null;
        editor.redraw();
      }
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
        if (pos === undefined || !box || box.page !== pageNumber) continue;
        const at = { x: box.x, y: box.y, width: box.width, height: box.height };
        const drawn = fieldDrawingAt(editor, pos, { box: at, baselineY: box.baseline ?? box.y + box.height, theme });
        if (!drawn) continue;
        const own = mayComplete.has(field.id);
        const signing: SigningFieldDrawing = {
          ...drawn,
          color: (own ? accentColor : undefined) ?? drawn.color,
          own,
          active: field.id === hovered || field.id === focused,
          focused: field.id === focused,
          pending: pending.has(field.id),
        };
        if (!paint?.(ctx, signing)) paintField(ctx, signing);
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

/**
 * One field as a signer sees it. `Field` has drawn it already — the author's
 * ink, or the value it holds as part of the document. An empty field is
 * drawn over: the viewer's own solid in their colour with what to do on a
 * badge, everyone else's faded. A value shows it can still be changed only
 * under the pointer or keyboard focus.
 */
function paintField(ctx: CanvasRenderingContext2D, f: SigningFieldDrawing): void {
  const { box, control } = f;
  const { x, y, width, height } = box;
  const filled = f.value !== undefined && control !== "checkbox";
  ctx.save();
  if (!filled) {
    // Cover the author's ink; the signing view draws the field its own way.
    ctx.fillStyle = f.theme.pageBg;
    ctx.fillRect(x - 1, y - 1, width + 2, height + 3);
  }
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
    if (ticked) paintCheckboxTick(ctx, box, f.theme.defaultText);
  } else if (filled) {
    if (f.own && f.active) {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, f.baselineY + 2);
      ctx.lineTo(x + width, f.baselineY + 2);
      ctx.stroke();
    }
  } else if (f.own) {
    const verb = fieldVerb(f.kind, control);
    paintFieldInk(ctx, box, { control, label: f.label, color: f.color, solid: true, faint: 1, baselineY: f.baselineY });
    // Said once: a label that is already the verb needs no badge repeating it.
    if (verb !== f.label) paintBadge(ctx, box, verb, f.color, f.theme.pageBg);
  } else {
    paintFieldInk(ctx, box, { control, label: roleName(f.role), color: f.theme.imagePlaceholderBorder, faint: 0.8, baselineY: f.baselineY });
  }

  if (f.focused) {
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 2.5, y - 2.5, width + 5, height + 5);
  }
  ctx.restore();
  if (!f.own && f.active) paintFieldTag(ctx, box, `For the ${roleName(f.role)}`, f.theme);
}

/** What the signer does, on a small badge at the end of the field's line. */
function paintBadge(ctx: CanvasRenderingContext2D, box: FieldBox, text: string, color: string, ink: string): void {
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
