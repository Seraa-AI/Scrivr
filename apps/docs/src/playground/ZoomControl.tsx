import type { ChangeEvent } from "react";
import type { Editor, ZoomRequest } from "@scrivr/core";
import { useZoom } from "@scrivr/react";

const FACTORS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const FITS: { value: Exclude<ZoomRequest, number>; label: string }[] = [
  { value: "fit-width", label: "Fit width" },
  { value: "fit-page", label: "Fit page" },
];

const percent = (zoom: number): string => `${Math.round(zoom * 100)}%`;

/**
 * How large the page is shown: a preset factor, or a fit that follows the
 * window. The factor in effect is shown even when a gesture set one the list
 * does not hold.
 */
export function ZoomControl({ editor }: { editor: Editor | null }) {
  const zoom = useZoom(editor);
  const request = editor?.zoomRequest ?? 1;
  const selected = typeof request === "number" ? String(request) : request;

  const choose = (e: ChangeEvent<HTMLSelectElement>): void => {
    const fit = FITS.find((f) => f.value === e.target.value);
    editor?.setZoom(fit ? fit.value : Number(e.target.value));
  };

  return (
    <div className="flex shrink-0 items-center border-l px-1.5" style={{ borderColor: "var(--app-border)" }}>
      <select
        value={selected}
        onChange={choose}
        disabled={!editor}
        title="Zoom — Ctrl/Cmd + scroll or pinch to zoom about the pointer"
        aria-label={`Zoom, ${percent(zoom)}`}
        className="h-8 rounded-md border px-1.5 text-[12px] tabular-nums"
        style={{ background: "var(--app-surface)", borderColor: "var(--app-border)", color: "var(--app-text)" }}
      >
        {FITS.map((fit) => (
          <option key={fit.value} value={fit.value}>
            {fit.value === request ? `${fit.label} (${percent(zoom)})` : fit.label}
          </option>
        ))}
        {typeof request === "number" && !FACTORS.includes(request) && <option value={String(request)}>{percent(zoom)}</option>}
        {FACTORS.map((factor) => (
          <option key={factor} value={String(factor)}>
            {percent(factor)}
          </option>
        ))}
      </select>
    </div>
  );
}
