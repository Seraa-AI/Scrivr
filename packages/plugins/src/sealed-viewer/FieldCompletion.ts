import { Extension, safeImageUrl } from "@scrivr/core";
import type { IBaseEditor, IEditor, PagePoint, SignerFieldDescriptor } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";

/** What fills a field. `image` is a raster drawn signature; `data:` URLs allowed, SVG not. */
export type FieldValue =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string }
  | { kind: "checkbox"; checked: boolean };

export interface FieldCompletionOptions {
  /** The sealed snapshot's signer fields. */
  fields: SignerFieldDescriptor[];
  /** Ids of the fields this viewer may complete. */
  completable: string[];
  /** Values already completed, by field id — shown, never requested again. */
  values: Record<string, FieldValue>;
  /**
   * The viewer pressed a field they may complete. The host captures the value
   * however it must — signature pad, consent, authentication — records its
   * evidence, and resolves with the value to show, or `null` to leave the
   * field open. Scrivr keeps nothing.
   */
  onFieldRequest: (field: SignerFieldDescriptor) => Promise<FieldValue | null>;
  /** Outline of a field this viewer may complete. */
  accentColor: string;
}

interface FieldState {
  values: Map<string, FieldValue>;
  repaint: () => void;
}

const fieldStates = new WeakMap<IBaseEditor, FieldState>();

/** Show a value completed elsewhere — another participant signed. */
export function setFieldValue(editor: IBaseEditor, id: string, value: FieldValue): void {
  const state = fieldStates.get(editor);
  if (!state) return;
  state.values.set(id, value);
  state.repaint();
}

/** Where each field node is in `doc`, by id. A sealed document never changes, so this is read once. */
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
 */
export const FieldCompletion = Extension.create<FieldCompletionOptions>({
  name: "fieldCompletion",

  defaultOptions: {
    fields: [],
    completable: [],
    values: {},
    onFieldRequest: async () => null,
    accentColor: "#2563eb",
  },

  onViewReady(editor: IEditor) {
    const { fields, completable, onFieldRequest, accentColor } = this.options;
    const mayComplete = new Set(completable);
    const pending = new Set<string>();
    const images = new Map<string, HTMLImageElement>();
    const state: FieldState = {
      values: new Map(Object.entries(this.options.values)),
      repaint: () => editor.redraw(),
    };
    fieldStates.set(editor, state);

    let positionsOf: { doc: PmNode; positions: Map<string, number> } | null = null;
    const positionOf = (id: string): number | undefined => {
      const doc = editor.getState().doc;
      if (positionsOf?.doc !== doc) positionsOf = { doc, positions: fieldPositions(doc) };
      return positionsOf.positions.get(id);
    };

    const imageFor = (src: string): HTMLImageElement | null => {
      const safe = safeImageUrl(src);
      if (!safe) return null;
      const cached = images.get(safe);
      if (cached) return cached.complete ? cached : null;
      const img = new Image();
      img.onload = state.repaint;
      img.src = safe;
      images.set(safe, img);
      return null;
    };

    /** Whether the press landed in the field's box — the same box the overlay paints. */
    const pressedOn = (field: SignerFieldDescriptor, at: PagePoint): boolean => {
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
      const field = fields.find(
        (f) => mayComplete.has(f.id) && !state.values.has(f.id) && !pending.has(f.id) && pressedOn(f, point),
      );
      if (!field) return;
      pending.add(field.id);
      onFieldRequest(field)
        .then((value) => {
          if (value) state.values.set(field.id, value);
        })
        .catch(() => {
          // The host declined or failed; the field stays open.
        })
        .finally(() => {
          pending.delete(field.id);
          state.repaint();
        });
    });

    const offPaint = editor.addOverlayRenderHandler((ctx, pageNumber, _pageConfig, charMap, theme) => {
      for (const field of fields) {
        const pos = positionOf(field.id);
        const box = pos === undefined ? undefined : charMap.getObjectRect(pos);
        if (!box || box.page !== pageNumber) continue;
        const value = state.values.get(field.id);
        if (!value && !mayComplete.has(field.id)) continue;
        const { x, y, width, height } = box;
        ctx.save();
        // Whatever is drawn stays in the box the field reserved.
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        if (value) {
          // The empty field's caption is underneath; the value replaces it.
          ctx.fillStyle = theme.pageBg;
          ctx.fillRect(x, y, width, height);
          paintValue(ctx, { x, y, width, height }, value, imageFor);
        } else if (!pending.has(field.id)) {
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
        }
        ctx.restore();
      }
    });

    return () => {
      offPress();
      offPaint();
      fieldStates.delete(editor);
    };
  },
});

function paintValue(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  value: FieldValue,
  imageFor: (src: string) => HTMLImageElement | null,
): void {
  const { x, y, width, height } = box;
  ctx.fillStyle = "#111827";
  ctx.textBaseline = "middle";
  if (value.kind === "text") {
    ctx.font = `${Math.min(18, height * 0.6)}px sans-serif`;
    ctx.fillText(value.text, x + 4, y + height / 2, width - 8);
  } else if (value.kind === "image") {
    const img = imageFor(value.src);
    if (!img) return;
    const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, x + (width - w) / 2, y + (height - h) / 2, w, h);
  } else if (value.checked) {
    ctx.font = `${height * 0.8}px sans-serif`;
    ctx.fillText("✓", x + width / 2 - height * 0.3, y + height / 2);
  }
}
