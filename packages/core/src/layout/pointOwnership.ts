import type { AnchoredObjectPlacement } from "./AnchoredObjects";
import { compareAnchoredObjectHitOrder } from "./AnchoredObjects";
import type { ObjectRectEntry } from "./CharacterMap";

/**
 * Who owns a point on the page?
 *
 * A DOM editor never asks: the browser keeps a hit tree, walks it in reverse
 * paint order, and routes the event. Canvas keeps pixels. Once a page is
 * painted there is no record of who drew what, so every question the
 * compositor used to answer is code we write — and it only knows what we
 * remembered to tell it.
 *
 * Paint order and hit order are the same fact. `PageRenderer` splits floats
 * into behind/front before drawing (`compareAnchoredObjectPaintOrder`); this
 * resolves the same objects back to front (`compareAnchoredObjectHitOrder`).
 * The two comparators are a pair and live together in `AnchoredObjects` for
 * that reason: if one changes without the other, the editor paints one thing
 * and clicks another.
 *
 * Ownership is deliberately *not* the same question as "where is this node on
 * screen". `CharacterMap.objectRects` answers that one — resize handles and
 * `getNodeViewportRect` need every object's rectangle, anchored included — and
 * answering both from one lookup is what let a `behind` float that correctly
 * declined a click get re-claimed one branch later by the inline-object path.
 */
export type PointOwner =
  | { kind: "anchored"; object: AnchoredObjectPlacement }
  | { kind: "inlineObject"; rect: ObjectRectEntry }
  | { kind: "text" };

/**
 * The page geometry ownership is resolved against. Deliberately not the editor:
 * the rule is pure, so it is testable without a document, a canvas, or a DOM.
 */
export interface PointOwnershipInput {
  /** Anchored objects placed on this page. Order does not matter. */
  anchoredObjects: readonly AnchoredObjectPlacement[];
  /** Is a line of text painted at this point? */
  hasTextAt(x: number, y: number, page: number): boolean;
  /** The object rectangle registered at this point, if any. */
  objectRectAt(x: number, y: number, page: number): ObjectRectEntry | undefined;
}

function contains(object: AnchoredObjectPlacement, x: number, y: number): boolean {
  return (
    x >= object.x &&
    x <= object.x + object.width &&
    y >= object.y &&
    y <= object.y + object.height
  );
}

/**
 * Does this anchored object take a point that also has text painted on it?
 *
 * `behind` paints under the body, so text wins wherever text is; the image
 * stays reachable through the gaps between lines and past short ones. `front`
 * paints over the body and takes the point — that is what the mode means.
 * `square` and `top-bottom` push text out of their space, so a point that has
 * both is a boundary pixel and the object may as well take it.
 */
function takesPointOverText(object: AnchoredObjectPlacement): boolean {
  return object.wrapMode !== "behind";
}

/**
 * Resolve who owns `(x, y)` on `page` — the single answer every surface uses,
 * so click routing, hover cursors and drags cannot disagree about it.
 *
 * The caller decides what "no page here" means; this assumes the point is on
 * one, and falls back to `text` because a click anywhere on a page places a
 * caret.
 */
export function resolvePointOwner(
  x: number,
  y: number,
  page: number,
  input: PointOwnershipInput,
): PointOwner {
  const onPage = input.anchoredObjects
    .filter((object) => object.page === page)
    .sort(compareAnchoredObjectHitOrder);

  const hasText = input.hasTextAt(x, y, page);

  for (const object of onPage) {
    if (!contains(object, x, y)) continue;
    if (hasText && !takesPointOverText(object)) continue;
    return { kind: "anchored", object };
  }

  const rect = input.objectRectAt(x, y, page);
  if (rect) {
    // Anchored objects are registered here too, for geometry. They were just
    // considered above with the z-order rule, so a rect belonging to one is
    // already decided — treating it as an inline object here would silently
    // overturn that decision.
    const isAnchored = onPage.some((object) => object.docPos === rect.docPos);
    if (!isAnchored) return { kind: "inlineObject", rect };
  }

  return { kind: "text" };
}
