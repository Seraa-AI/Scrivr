import type { EditorState } from "prosemirror-state";
import type { GlyphEntry } from "../layout/CharacterMap";
import type { PagePoint } from "../layout/pagePoint";
import type { PointOwner } from "../layout/pointOwnership";
import type { HitTarget } from "../selection/types";
import { isMarkHoverResolver, type HoverResolver, type HoverTarget } from "./types";

export interface HoverResolveInput {
  point: PagePoint;
  /** State that owns the point, and its surface id. */
  state: EditorState;
  surfaceId: string;
  /** Who owns the point — text, an inline object or an anchored object. */
  owner: PointOwner;
  /** Strict glyph lookup — `CharacterMap.glyphAtPoint`. */
  glyphAt(x: number, y: number, page: number): GlyphEntry | null;
  /** Click routing's hit target for the point — `Editor.resolveHitTarget`. */
  hitTarget(): HitTarget | null;
  resolvers: readonly HoverResolver[];
  /** SelectionDescriptor kind for a node selection at `pos` ("image", …). */
  nodeKind(pos: number): string;
}

/**
 * What is under the pointer, innermost first.
 *
 *   1. Ownership — an image-like object owns the point → its target.
 *   2. Glyph     — the character painted under the point → one target per
 *                  claimed mark on it (link).
 *   3. Structure — ancestors of the point's position that a node resolver
 *                  claims (table-cell, table). The position comes from the
 *                  object or glyph, else from a hit tester (a cell's padding
 *                  has no glyph but is still inside the cell).
 *
 * Only the glyph step is held to the content box. An object or a cell claims a
 * point by its own rect, so an image hanging into the margin is still hovered
 * there; a glyph lookup has no rect of its own to say the margin is not text.
 */
export function resolveHoverTargets(input: HoverResolveInput): HoverTarget[] {
  const { point, state, surfaceId, owner, resolvers } = input;
  if (point.region === "gap" || point.region === "outside") return [];

  const { doc } = state;
  const targets: HoverTarget[] = [];
  let seed: number | null = null;

  if (owner.kind === "inlineObject" || owner.kind === "anchored") {
    const pos = owner.kind === "inlineObject" ? owner.rect.docPos : owner.object.docPos;
    const node = doc.nodeAt(pos);
    if (node) {
      targets.push({ kind: input.nodeKind(pos), surfaceId, pos, end: pos + node.nodeSize });
      seed = pos;
    }
  } else if (point.region === "content") {
    const glyph = input.glyphAt(point.x, point.y, point.page);
    if (glyph && doc.nodeAt(glyph.docPos)) {
      seed = glyph.docPos;
      for (const resolver of resolvers) {
        if (!isMarkHoverResolver(resolver)) continue;
        const range = resolver.range(doc, glyph.docPos);
        if (range) targets.push({ kind: resolver.mark, surfaceId, pos: range.from, end: range.to });
      }
    }
  }

  if (seed === null) seed = input.hitTarget()?.pos ?? null;
  if (seed === null || seed < 0 || seed > doc.content.size) return targets;

  const $pos = doc.resolve(seed);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    const pos = $pos.before(depth);
    for (const resolver of resolvers) {
      if (isMarkHoverResolver(resolver) || resolver.node !== node.type.name) continue;
      targets.push({ kind: resolver.kind, surfaceId, pos, end: pos + node.nodeSize });
    }
  }
  return targets;
}
