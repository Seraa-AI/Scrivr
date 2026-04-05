/**
 * renderAiSuggestionOps.ts
 *
 * Canvas rendering helpers for AI suggestion overlays:
 *   - renderDeleteHighlight — bottom-border underline (inactive) or light fill + border (active)
 *   - renderInsertMarker    — thin colored vertical bar at insertion point
 *   - buildOpRenderInstructions — maps AiOps to typed render instructions
 *   - renderInstructions    — executes render instructions on a canvas context
 *
 * Active = the block currently under the cursor or hovered in the sidebar.
 * Inactive = all other blocks; rendered subtly to reduce visual noise.
 */

import type { CharacterMap, GlyphEntry } from "@scrivr/core";
import type { AiOp } from "./types";

// ── Render instruction types ──────────────────────────────────────────────────

export interface InsertRenderInstruction {
  type:     "insert";
  x:        number;
  y:        number;
  height:   number;
  color:    string;
  page:     number;
}

export interface DeleteRenderInstruction {
  type:  "delete";
  from:  number;
  to:    number;
  color: string;
  page:  number;
}

export type RenderInstruction = InsertRenderInstruction | DeleteRenderInstruction;

// ── Delete highlight ──────────────────────────────────────────────────────────

/**
 * Inactive: a single red underline per glyph — low visual weight.
 * Active:   light pink fill + stronger underline to draw the eye.
 */
export function renderDeleteHighlight(
  ctx: CanvasRenderingContext2D,
  glyphs: GlyphEntry[],
  isActive: boolean,
): void {
  if (glyphs.length === 0) return;

  ctx.save();
  ctx.setLineDash([3, 2]);
  ctx.strokeStyle = isActive
    ? "rgba(239, 68, 68, 0.65)"  // stronger when active
    : "rgba(239, 68, 68, 0.25)"; // faint when inactive
  ctx.lineWidth = isActive ? 1.5 : 1;

  for (const g of glyphs) {
    ctx.beginPath();
    ctx.moveTo(g.x, g.y + g.height - 0.5);
    ctx.lineTo(g.x + g.width, g.y + g.height - 0.5);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

// ── Insert marker ─────────────────────────────────────────────────────────────

/**
 * Inactive: very faint 1px bar.
 * Active:   solid 2px bar — signals "something is being inserted here".
 */
export function renderInsertMarker(
  ctx: CanvasRenderingContext2D,
  inst: InsertRenderInstruction,
  isActive: boolean,
): void {
  const { x, y, height, color } = inst;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";

  if (isActive) {
    // Bar with top cap
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x, y + height - 3);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 3);
    ctx.lineTo(x + 3, y + 3);
    ctx.stroke();
  } else {
    // Faint 1px bar, no cap
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x, y + height - 3);
    ctx.stroke();
  }

  ctx.restore();
}

// ── Instruction builder ───────────────────────────────────────────────────────

export function buildOpRenderInstructions(
  ops: AiOp[],
  map: import("../track-changes/lib/acceptedTextMap").PosMapEntry[],
  charMap: CharacterMap,
  pageNumber: number,
): RenderInstruction[] {
  const INSERT_COLOR = "#6366f1"; // indigo-500
  const DELETE_COLOR = "#dc2626"; // red-600

  const instructions: RenderInstruction[] = [];
  let acceptedOffset = 0;

  for (const op of ops) {
    const tokenLen = op.text.length;

    if (op.type === "keep") {
      acceptedOffset += tokenLen;
      continue;
    }

    if (op.type === "delete") {
      const startEntry = map[acceptedOffset];
      const endEntry   = map[Math.min(acceptedOffset + tokenLen - 1, map.length - 1)];
      if (startEntry && endEntry) {
        instructions.push({
          type:  "delete",
          from:  startEntry.docPos,
          to:    endEntry.docPos + 1,
          color: DELETE_COLOR,
          page:  pageNumber,
        });
      }
      acceptedOffset += tokenLen;
    } else if (op.type === "insert") {
      const insertAtEntry = map[acceptedOffset];
      if (insertAtEntry) {
        const coords = charMap.coordsAtPos(insertAtEntry.docPos);
        if (coords && coords.page === pageNumber) {
          instructions.push({
            type:   "insert",
            x:      coords.x,
            y:      coords.y,
            height: coords.height,
            color:  INSERT_COLOR,
            page:   pageNumber,
          });
        }
      }
      // acceptedOffset does NOT advance for inserts
    }
  }

  return instructions;
}

// ── Instruction renderer ──────────────────────────────────────────────────────

/**
 * Execute render instructions. isActive controls highlight intensity.
 */
export function renderInstructions(
  ctx: CanvasRenderingContext2D,
  instructions: RenderInstruction[],
  charMap: CharacterMap,
  isActive: boolean,
): void {
  for (const inst of instructions) {
    if (inst.type === "delete") {
      const glyphs = charMap.glyphsInRange(inst.from, inst.to)
        .filter((g) => g.page === inst.page);
      renderDeleteHighlight(ctx, glyphs, isActive);
    }
    // insert markers intentionally not rendered — card panel conveys inserts
  }
}
