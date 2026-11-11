import { Extension, safeImageUrl } from "@scrivr/core";
import type { IBaseEditor, IEditor, PagePoint } from "@scrivr/core";

export type SealedFieldKind = "signature" | "initials" | "date" | "text" | "checkbox";

/**
 * A field as the seal recorded it. Its place on the page was computed once,
 * when the revision was sealed, so every surface shows it in the same spot —
 * never re-derived from layout, whose fonts differ between browser and server.
 */
export interface SealedField {
  id: string;
  /** Who completes it, by role — the host maps roles to people. */
  role: string;
  kind: SealedFieldKind;
  required: boolean;
  /** 1-based page number. */
  page: number;
  /** Page-local, in CSS pixels. */
  rect: { x: number; y: number; width: number; height: number };
}

/** What fills a field. `image` is a raster drawn signature; `data:` URLs allowed, SVG not. */
export type FieldValue =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string }
  | { kind: "checkbox"; checked: boolean };

export interface FieldCompletionOptions {
  /** The sealed field manifest. */
  fields: SealedField[];
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
  onFieldRequest: (field: SealedField) => Promise<FieldValue | null>;
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

const LABELS: Record<SealedFieldKind, string> = {
  signature: "Sign here",
  initials: "Initial",
  date: "Date",
  text: "Fill in",
  checkbox: "Check",
};

const contains = (field: SealedField, at: PagePoint): boolean =>
  field.page === at.page &&
  at.x >= field.rect.x &&
  at.x <= field.rect.x + field.rect.width &&
  at.y >= field.rect.y &&
  at.y <= field.rect.y + field.rect.height;

/**
 * Completing fields on a sealed revision. Values are painted over the page and
 * never written to the document, so the seal — and its hash — hold from the
 * first signer to the last.
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

    const offPress = editor.on("press", ({ point, clickCount }) => {
      if (clickCount !== 1) return;
      const field = fields.find(
        (f) => mayComplete.has(f.id) && !state.values.has(f.id) && !pending.has(f.id) && contains(f, point),
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

    const offPaint = editor.addOverlayRenderHandler((ctx, pageNumber) => {
      for (const field of fields) {
        if (field.page !== pageNumber) continue;
        const { x, y, width, height } = field.rect;
        const value = state.values.get(field.id);
        ctx.save();
        if (value) {
          paintValue(ctx, field, value, imageFor);
        } else {
          const own = mayComplete.has(field.id);
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = own ? 1.5 : 1;
          const tone = own ? accentColor : "#000000";
          ctx.fillStyle = tone;
          ctx.globalAlpha = own ? 0.06 : 0.02;
          ctx.fillRect(x, y, width, height);
          ctx.globalAlpha = own ? 1 : 0.3;
          ctx.strokeStyle = tone;
          ctx.strokeRect(x, y, width, height);
          ctx.globalAlpha = 1;
          if (own) {
            ctx.fillStyle = accentColor;
            ctx.font = `${Math.min(14, height * 0.4)}px sans-serif`;
            ctx.textBaseline = "middle";
            ctx.fillText(LABELS[field.kind], x + 6, y + height / 2, width - 12);
          }
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
  field: SealedField,
  value: FieldValue,
  imageFor: (src: string) => HTMLImageElement | null,
): void {
  const { x, y, width, height } = field.rect;
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
