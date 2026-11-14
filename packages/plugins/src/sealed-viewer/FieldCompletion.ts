import {
  Extension,
  fieldDrawingAt,
  fieldKindsOf,
  fieldRoleColor,
  fieldValues,
  fieldVerb,
  isDatedWhenSigned,
  isFieldAnswered,
  isSigningKind,
  paintCheckbox,
  paintFieldInk,
  paintFieldTag,
  roleName,
  setFieldValue,
  unansweredBeforeSigning,
} from "@scrivr/core";
import type {
  FieldBox,
  FieldDrawing,
  FieldValue,
  HoverTarget,
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
   *
   * A field dated when signed (`dateSigned`) is asked for without a press,
   * the moment its party's signature is given: answer with the date, by your
   * clock and in your format, and record it with the signature.
   */
  onFieldRequest: (field: SignerFieldDescriptor, current?: FieldValue) => Promise<FieldValue | null>;
  /**
   * `onFieldRequest` failed — it threw or rejected. The field stays as it was;
   * tell the signer, and let them try again.
   */
  onFieldRequestError?: (field: SignerFieldDescriptor, error: unknown) => void;
  /**
   * The viewer went to sign while required fields of theirs are still
   * unanswered (`unansweredBeforeSigning`). The signature waits and focus
   * goes to the first of them; say why — "Choose payment terms before you
   * sign". The view checks only this viewer's fields: run
   * `unansweredBeforeSigning` over the whole role on your server when you
   * record the signature.
   */
  onSignatureBlocked?: (signature: SignerFieldDescriptor, missing: SignerFieldDescriptor[]) => void;
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
  /** Its value answers it — what the executed record would print. */
  answered: boolean;
  /** Dated when its party signs, never pressed. */
  datedWhenSigned: boolean;
}

interface FieldState {
  /** Ask the host for `id`'s value, scrolled into view; whether it opened. */
  request: (id: string) => boolean;
  /** Move keyboard focus to the viewer's next (`1`) or previous (`-1`) field. */
  moveFocus: (direction: 1 | -1) => string | null;
  /** Act on the field keyboard focus is on — open it, or go to what it waits on; whether there was one. */
  openFocused: () => boolean;
}

const fieldStates = new WeakMap<IBaseEditor, FieldState>();
/** Key handlers are handed the editor's navigator, not the editor. */
const byNavigator = new WeakMap<object, FieldState>();

/**
 * Open a field the viewer may complete, as if they had pressed it — scrolled
 * into view first. What a host's list of fields, or its "Next field" button,
 * calls. Returns whether it opened: not when this viewer may not complete it,
 * it is already open, or it is a signature still waiting on the viewer's
 * other required fields — focus goes to the first of those instead.
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
 * A signature comes last: until the viewer's other required fields are
 * answered, going to sign moves focus to the first of them. A date signed is
 * dated when its party signs, never by hand. Someone else's field says whose
 * it is; text the author filled says what it is.
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
    const { fields, completable, onFieldRequest, onFieldRequestError, onSignatureBlocked, accentColor, paint } = this.options;
    const kinds = fieldKindsOf(editor);
    const mayComplete = new Set(completable);
    const isDated = (f: SignerFieldDescriptor): boolean => isDatedWhenSigned(kinds, f.kind);
    // What the signer fills, by pressing or with Tab; a date signed is dated for them.
    const mine = fields.filter((f) => mayComplete.has(f.id) && !isDated(f));
    const datesSigned = fields.filter((f) => mayComplete.has(f.id) && isDated(f));
    const pending = new Set<string>();
    let hovered: string | null = null;
    let focused: string | null = null;
    let hoveredFilledText: HoverTarget | null = null;

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
    const focusOn = (id: string | null): void => {
      focused = id;
      if (id !== null) reveal(id);
      editor.redraw();
    };

    const ask = (field: SignerFieldDescriptor): void => {
      pending.add(field.id);
      editor.redraw();
      // Asked inside an executor, so a request that throws before returning a
      // promise fails like one that rejects.
      const current = fieldValues(editor.getState())[field.id];
      new Promise<FieldValue | null>((resolve) => resolve(onFieldRequest(field, current)))
        .then((value) => {
          if (!value) return;
          setFieldValue(editor, field.id, value);
          if (!isSigningKind(kinds, field.kind)) return;
          const partyDates = datesSigned.filter((date) => date.role === field.role);
          // Dated only by a signature that answers — not initials on the way,
          // not blank text — and a date never outlives its signature.
          if (!isFieldAnswered(field, value, kinds)) {
            for (const date of partyDates) setFieldValue(editor, date.id, null);
            return;
          }
          for (const date of partyDates) if (!pending.has(date.id)) ask(date);
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
        if (isSigningKind(kinds, field.kind)) {
          // Signed last, as on a paper form. The signature waits on what this
          // viewer still owes, and focus goes to it — never answering it for
          // them: pressing a checkbox ticks it. Fields someone else in the
          // role completes are the server's to wait on.
          const owed = unansweredBeforeSigning(mine, fieldValues(editor.getState()), field.role, kinds);
          const [first] = owed;
          if (first) {
            onSignatureBlocked?.(field, owed);
            focusOn(first.id);
            return false;
          }
        }
        reveal(id);
        focused = id;
        ask(field);
        return true;
      },
      moveFocus: (direction) => {
        const at = focused === null ? (direction > 0 ? -1 : mine.length) : mine.findIndex((f) => f.id === focused);
        // Past either end focus leaves, as Tab leaves a form: the key goes on
        // to the next control on the page instead of cycling here.
        focusOn(mine[at + direction]?.id ?? null);
        return focused;
      },
      // Consumed even when nothing opens — a held-back signature, a pending
      // field — so Enter never reaches the document.
      openFocused: () => {
        if (focused === null) return false;
        state.request(focused);
        return true;
      },
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

    const offHover = editor.on("hover", ({ point, targets }) => {
      const next = point ? (fields.find((f) => isOver(f, point))?.id ?? null) : null;
      const text = targets.find((t) => t.kind === "fieldRange") ?? null;
      if (next === hovered && text?.pos === hoveredFilledText?.pos && text?.end === hoveredFilledText?.end) return;
      hovered = next;
      hoveredFilledText = text;
      editor.redraw();
    });

    const offCursor = editor.addPointerCursor(({ objectPos }) => {
      const field = objectPos === null ? undefined : fieldAt(objectPos);
      if (!field) return null;
      return mine.includes(field) ? "pointer" : "default";
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
          // A date signed is never pressed, so it never lights up as if it could be.
          active: !isDated(field) && (field.id === hovered || field.id === focused),
          focused: field.id === focused,
          pending: pending.has(field.id),
          answered: isFieldAnswered(field, drawn.value, kinds),
          datedWhenSigned: isDated(field),
        };
        if (!paint?.(ctx, signing)) paintField(ctx, signing);
      }
      if (hoveredFilledText) {
        const { pos, end } = hoveredFilledText;
        paintFilledText(ctx, charMap.rangeRects(pos, end), pageNumber, promptAt(editor.getState().doc, pos), theme);
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
 * badge, everyone else's faded. An answer shows it can still be changed only
 * under the pointer or keyboard focus.
 */
function paintField(ctx: CanvasRenderingContext2D, f: SigningFieldDrawing): void {
  const { box, control } = f;
  const { x, y, width, height } = box;
  // A value that answers nothing — a withdrawn choice, blank text — draws as
  // empty, as `Field` lays it out.
  const filled = f.answered && control !== "checkbox";
  ctx.save();
  if (!filled) {
    // Cover the author's ink; the signing view draws the field its own way.
    ctx.fillStyle = f.theme.pageBg;
    ctx.fillRect(x - 1, y - 1, width + 2, height + 3);
  }
  if (f.own && f.active && control !== "checkbox") {
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = f.color;
    ctx.fillRect(x, y, width, height);
    ctx.globalAlpha = 1;
  }

  if (control === "checkbox") {
    paintCheckbox(ctx, box, {
      checked: f.value?.kind === "checkbox" && f.value.checked,
      color: f.own ? f.color : f.theme.imagePlaceholderBorder,
      pageBg: f.theme.pageBg,
      hover: f.own && f.active,
    });
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
    // Said once: a label that is already the verb needs no badge repeating it,
    // and a date signed asks nothing of the signer.
    if (verb !== f.label && !f.datedWhenSigned) paintBadge(ctx, box, verb, f.color, f.theme.pageBg);
  } else {
    paintFieldInk(ctx, box, { control, label: roleName(f.role), color: f.theme.imagePlaceholderBorder, faint: 0.8, baselineY: f.baselineY });
  }

  if (f.focused) {
    // A native control's focus ring: soft, rounded, and clear of the control.
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 3, y - 3, width + 6, height + 6, 4);
    ctx.stroke();
  }
  ctx.restore();
  if (!f.own && f.active) paintFieldTag(ctx, box, `For the ${roleName(f.role)}`, f.theme);
}

/** The prompt of the author's field whose text starts at `pos`. */
function promptAt(doc: PmNode, pos: number): string {
  const prompt = doc.nodeAt(pos)?.marks.find((m) => m.type.name === "fieldRange")?.attrs["prompt"];
  return typeof prompt === "string" ? prompt : "";
}

/**
 * Text the author filled, framed faintly with what it is — as Word frames a
 * content control under the pointer — so a reader can tell the words filled
 * in for this document from the template's own.
 */
function paintFilledText(ctx: CanvasRenderingContext2D, rects: ReadonlyArray<FieldBox & { page: number }>, page: number, prompt: string, theme: ResolvedTheme): void {
  ctx.save();
  ctx.strokeStyle = fieldRoleColor(null);
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  for (const r of rects) if (r.page === page) ctx.strokeRect(r.x - 1.5, r.y + 0.5, r.width + 3, r.height - 1);
  ctx.restore();
  const first = rects[0];
  if (first?.page === page && prompt) paintFieldTag(ctx, first, prompt, theme);
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
