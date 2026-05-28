/**
 * PointerController drag-UX **routing** tests — pin the hardening fixes from
 * `docs/anchored-objects/04-edit-ux.md` § Dragging:
 *
 *   1. Handle precedence — pointer well inside an image's rect resolves to
 *      body drag, NOT a resize handle hit.
 *   2. Clamp-no-move — a horizontal drag whose clamped target X equals the
 *      source X dispatches no PM transaction.
 *   3. Gap drop — a drop in the inter-page gap is treated as a no-op.
 *   4. Cross-page resolve — when `posAtCoords` returns 0 on a virtualized
 *      destination page, the layout-page block scan resolves the target
 *      docPos so vertical drag never collapses to docPos 0.
 *   5. Single source of truth — `hitHandleAt` reads through
 *      `editor.getNodeRect`, not stale `charMap` rects.
 *
 * Scope: which Editor API does PointerController dispatch to for a given
 * drag gesture? Geometry / hit-testing details belong in `CharacterMap.test.ts`;
 * document mutation belongs in Editor mutation tests. We drive a real
 * `Editor` via `makePointerControllerSetup`, stub the geometry seams that
 * would otherwise require painful doc construction (layout `anchoredObjects`,
 * `getNodeRect`, `getState` with a NodeSelection), and spy on the Editor
 * methods being routed to.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import {
  makePointerControllerSetup,
  overrideLayout,
} from "../test-utils";
import type { PointerControllerSetup } from "../test-utils";
import type { AnchoredObjectPlacement } from "../layout/AnchoredObjects";

// ── Local test fixtures ──────────────────────────────────────────────────────

interface ImageRect {
  docPos: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutBlockFixture {
  nodePos: number;
  y: number;
  height: number;
}

const SQUARE_RECT: ImageRect = {
  docPos: 5,
  page: 1,
  x: 100,
  y: 50,
  width: 80,
  height: 60,
};

function makePlacement(
  setup: PointerControllerSetup,
  overrides: Partial<ImageRect> = {},
): AnchoredObjectPlacement {
  return {
    ...SQUARE_RECT,
    ...overrides,
    wrapMode: "square",
    node: setup.editor.schema.nodes["image"]!.create({
      src: "x",
      width: overrides.width ?? SQUARE_RECT.width,
      height: overrides.height ?? SQUARE_RECT.height,
      wrapMode: "square",
    }),
    anchorGlobalY: overrides.y ?? SQUARE_RECT.y,
    anchorPage: overrides.page ?? SQUARE_RECT.page,
    globalY: overrides.y ?? SQUARE_RECT.y,
    zIndex: 0,
  };
}

/**
 * Spy on `editor.getState` to return a real `EditorState` whose selection is
 * a `NodeSelection` on a real `image` node at `selDocPos`. PointerController
 * reads `state.selection` (to decide resize-handle vs body drag) and
 * `state.doc.nodeAt(docPos)` (to read attrs on the dragged image); both are
 * satisfied by a tiny purpose-built doc.
 */
function stubImageSelection(
  setup: PointerControllerSetup,
  selDocPos: number,
): void {
  const { schema } = setup.editor;
  const image = schema.nodes["image"]!.create({
    src: "x", width: 80, height: 60, wrapMode: "square", xAlign: "left",
  });
  // Pos 1 = inside paragraph open token. Pad with `selDocPos - 1` chars of
  // text so the image lands at exactly `selDocPos`.
  const padding = selDocPos > 1 ? [schema.text("a".repeat(selDocPos - 1))] : [];
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [...padding, image]),
  ]);
  const state = EditorState.create({
    doc,
    schema,
    selection: NodeSelection.create(doc, selDocPos),
  });
  vi.spyOn(setup.editor, "getState").mockReturnValue(state);
}

// ── Pointer event helpers ────────────────────────────────────────────────────

function pointerEvent(
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {},
): PointerEvent {
  const EventCtor = globalThis.PointerEvent ?? MouseEvent;
  const event = new EventCtor(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: "mouse",
    ...init,
  }) as PointerEvent;
  if (!("pointerId" in event)) {
    Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  }
  if (!("pointerType" in event)) {
    Object.defineProperty(event, "pointerType", { value: init.pointerType ?? "mouse" });
  }
  return event;
}

function mousedown(container: HTMLDivElement, x: number, y: number): void {
  container.dispatchEvent(
    pointerEvent("pointerdown", x, y),
  );
}

function mousemove(x: number, y: number): void {
  document.dispatchEvent(
    pointerEvent("pointermove", x, y),
  );
}

function mouseup(x = 0, y = 0): void {
  document.dispatchEvent(
    pointerEvent("pointerup", x, y),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PointerController — drag UX", () => {
  let setup: PointerControllerSetup;

  afterEach(() => {
    setup?.cleanup();
  });

  describe("Step 2 — handle vs body precedence", () => {
    it("pointerdown 50px inside the rect resolves to body drag, not a resize handle", () => {
      setup = makePointerControllerSetup({ isPageless: true });
      overrideLayout(setup.editor, { anchoredObjects: [makePlacement(setup)] });
      stubImageSelection(setup, 5);
      vi.spyOn(setup.editor, "getNodeRect").mockReturnValue({ ...SQUARE_RECT });

      // 50px from the left edge of an 80px-wide rect = inner body, well past
      // EDGE_BAND_PX (12).
      mousedown(setup.container, SQUARE_RECT.x + 40, SQUARE_RECT.y + 30);

      expect(setup.controller.pendingResize).toBeNull();
      expect(setup.controller.pendingAnchoredDrag).not.toBeNull();
      expect(setup.controller.pendingAnchoredDrag?.sourcePage).toBe(1);
    });

    it("pointerdown on the rect edge still resolves to a resize handle", () => {
      setup = makePointerControllerSetup({ isPageless: true });
      overrideLayout(setup.editor, { anchoredObjects: [makePlacement(setup)] });
      stubImageSelection(setup, 5);
      vi.spyOn(setup.editor, "getNodeRect").mockReturnValue({ ...SQUARE_RECT });

      mousedown(setup.container, SQUARE_RECT.x, SQUARE_RECT.y);

      expect(setup.controller.pendingResize).not.toBeNull();
      expect(setup.controller.pendingResize?.handle).toBe("TL");
      expect(setup.controller.pendingAnchoredDrag).toBeNull();
    });
  });

  describe("Step 3 — clamp-no-move", () => {
    it("dragging a page-left-edge image further left dispatches no PM transaction", () => {
      // Image already painted at the page-left edge (x = 0). Clamp permits
      // images to extend into the margins, so the no-move boundary is the
      // page edge. Dragging further left clamps newX to 0 — equal to
      // startImageX — and the commit guard must skip the setNodeAttrs that
      // would otherwise flip xAlign to "custom" with no visual change.
      setup = makePointerControllerSetup({ isPageless: true });
      overrideLayout(setup.editor, { anchoredObjects: [makePlacement(setup, { x: 0 })] });
      vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(5);
      const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
      const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
      const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);

      const grabX = 30;
      const grabY = SQUARE_RECT.y + 30;
      mousedown(setup.container, grabX, grabY);
      mousemove(grabX - 200, grabY); // pure horizontal off the page edge
      mouseup(grabX - 200, grabY);

      expect(setNodeAttrs).not.toHaveBeenCalled();
      expect(moveNode).not.toHaveBeenCalled();
      expect(moveAndUpdateNode).not.toHaveBeenCalled();
    });
  });

  describe("Step 4 — gap-as-invalid drop zone", () => {
    it("drop in the inter-page gap dispatches no PM transaction", () => {
      setup = makePointerControllerSetup({
        isPageless: false,
        tileHeight: 1200,
        slotHeight: 1224, // 1200 + 24px gap
      });
      overrideLayout(setup.editor, { anchoredObjects: [makePlacement(setup)] });
      const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
      const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
      const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);

      mousedown(setup.container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      // Drop in the gap zone (visualY between 1200 and 1224 on page 1).
      mousemove(SQUARE_RECT.x + 30, 1210);
      expect(setup.controller.pendingAnchoredDrag?.disabled).toBe(true);
      expect(setup.controller.pendingAnchoredDrag?.caret).toBeNull();

      mouseup(SQUARE_RECT.x + 30, 1210);
      expect(setNodeAttrs).not.toHaveBeenCalled();
      expect(moveNode).not.toHaveBeenCalled();
      expect(moveAndUpdateNode).not.toHaveBeenCalled();
    });
  });

  describe("Step 5 — cross-page resolve via layout fragments", () => {
    it("posAtCoords→0 on a virtualized destination page resolves via layout.pages", () => {
      setup = makePointerControllerSetup({
        isPageless: false,
        tileHeight: 1200,
        slotHeight: 1224,
      });
      overrideLayout(setup.editor, {
        anchoredObjects: [makePlacement(setup)],
        pages: [
          { pageNumber: 1, blocks: [{ nodePos: 0, y: 0, height: 200 }] },
          { pageNumber: 2, blocks: [{ nodePos: 42, y: 50, height: 120 }] },
        ] satisfies { pageNumber: number; blocks: LayoutBlockFixture[] }[],
      });
      // posAtCoords returns 0 on page 2 (virtualized), 5 on page 1.
      vi.spyOn(setup.editor.charMap, "posAtCoords").mockImplementation((_x, _y, page) =>
        page === 2 ? 0 : 5,
      );
      const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);
      const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
      const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});

      mousedown(setup.container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      // Drop on page 2 at docY ≈ 80 (visualY = 1224 + 80 = 1304).
      mousemove(SQUARE_RECT.x + 30, 1304);
      mouseup(SQUARE_RECT.x + 30, 1304);

      // Layout fallback resolved page 2's block start → nodePos+1 = 43.
      // dx = 0 so xAlign/x not included; cross-page commit is moveAndUpdateNode.
      expect(moveAndUpdateNode).toHaveBeenCalledWith(5, 43, { yOffset: 0 });
      expect(moveNode).not.toHaveBeenCalled();
      expect(setNodeAttrs).not.toHaveBeenCalled();
    });
  });

  describe("Step 7 — same-page re-anchor", () => {
    it("dy past threshold re-anchors to the closer paragraph", () => {
      setup = makePointerControllerSetup({ isPageless: true });
      const sourceBlock = { nodePos: 4, y: 50, height: 100 };
      const targetBlock = { nodePos: 20, y: 200, height: 100 };
      overrideLayout(setup.editor, {
        anchoredObjects: [makePlacement(setup)],
        pages: [
          { pageNumber: 1, blocks: [sourceBlock, targetBlock] },
        ] satisfies { pageNumber: number; blocks: LayoutBlockFixture[] }[],
      });
      vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(5);
      const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);
      const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});

      mousedown(setup.container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      mousemove(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30 + 200); // dy = 200
      mouseup(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30 + 200);

      // imageGlobalY = 50 + 200 = 250. Distance to targetBlock at y=200 = 50.
      // wouldReduce = 200 - 50 = 150 > 24 → re-anchor to nodePos+1 = 21,
      // yOffset = 250 - 200 = 50.
      expect(moveAndUpdateNode).toHaveBeenCalledWith(5, 21, { yOffset: 50 });
      expect(setNodeAttrs).not.toHaveBeenCalled();
    });

    it("no closer paragraph → keeps the original anchor (setNodeAttrs path)", () => {
      setup = makePointerControllerSetup({ isPageless: true });
      const sourceBlock = { nodePos: 4, y: 50, height: 100 };
      const farBlock = { nodePos: 20, y: 400, height: 100 };
      overrideLayout(setup.editor, {
        anchoredObjects: [makePlacement(setup)],
        pages: [
          { pageNumber: 1, blocks: [sourceBlock, farBlock] },
        ] satisfies { pageNumber: number; blocks: LayoutBlockFixture[] }[],
      });
      vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(5);
      const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
      const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);

      mousedown(setup.container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      mousemove(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30 + 30);
      mouseup(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30 + 30);

      expect(setNodeAttrs).toHaveBeenCalledWith(5, { yOffset: 30 });
      expect(moveAndUpdateNode).not.toHaveBeenCalled();
    });
  });

  describe("Step 8 — cross-page yOffset preserves visual position", () => {
    it("drop on a destination page commits non-zero yOffset against the new anchor", () => {
      setup = makePointerControllerSetup({
        isPageless: false,
        tileHeight: 1200,
        slotHeight: 1224,
      });
      overrideLayout(setup.editor, {
        anchoredObjects: [makePlacement(setup)],
        pages: [
          { pageNumber: 1, blocks: [{ nodePos: 0, y: 0, height: 200 }] },
          { pageNumber: 2, blocks: [{ nodePos: 42, y: 50, height: 120 }] },
        ] satisfies { pageNumber: number; blocks: LayoutBlockFixture[] }[],
      });
      vi.spyOn(setup.editor.charMap, "posAtCoords").mockImplementation((_x, _y, page) =>
        page === 2 ? 0 : 5,
      );
      const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);

      // grabOffsetY = 80 - 50 = 30. Drop at page 2 docY = 120 → ghost top at
      // localY 90. Anchor block on page 2 at localY 50. Expected yOffset = 40.
      mousedown(setup.container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      mousemove(SQUARE_RECT.x + 30, 1224 + 120);
      mouseup(SQUARE_RECT.x + 30, 1224 + 120);

      expect(moveAndUpdateNode).toHaveBeenCalledWith(5, 43, { yOffset: 40 });
    });
  });

  describe("Step 6 — single source of truth", () => {
    it("hitHandleAt reads from editor.getNodeRect (layout.anchoredObjects authoritative)", () => {
      // Drift fixture: charMap reports a stale rect at x=999; layout's
      // anchoredObjects (via getNodeRect) is the authoritative position.
      // A click on the canonical TL corner must resolve to a handle via
      // the layout rect — if hitHandleAt still read charMap, the click
      // would miss.
      setup = makePointerControllerSetup({ isPageless: true });
      overrideLayout(setup.editor, {
        anchoredObjects: [makePlacement(setup, { x: 200, y: 300 })],
      });
      stubImageSelection(setup, 5);
      // Stale charMap rect — would never match the click position.
      vi.spyOn(setup.editor.charMap, "getObjectRect").mockReturnValue({
        docPos: 5, page: 1, x: 999, y: 999, width: 80, height: 60,
      });
      // Layout-derived rect — the canonical position.
      vi.spyOn(setup.editor, "getNodeRect").mockReturnValue({
        docPos: 5, page: 1, x: 200, y: 300, width: 80, height: 60,
      });

      mousedown(setup.container, 200, 300); // canonical TL corner

      expect(setup.controller.pendingResize?.handle).toBe("TL");
      // charMap's stale (999, 999) rect did NOT win — the test would have
      // failed above if hitHandleAt had used it.
    });
  });

  describe("Step 9 — pointer capture during drag", () => {
    it("ignores a second mousedown while an anchored-object drag is active", () => {
      setup = makePointerControllerSetup({ isPageless: true });
      overrideLayout(setup.editor, { anchoredObjects: [makePlacement(setup)] });
      const moveCursorTo = vi.spyOn(setup.editor.selection, "moveCursorTo").mockImplementation(() => {});
      const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});

      // Start an anchored drag at the image's body.
      mousedown(setup.container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      const initialDrag = setup.controller.pendingAnchoredDrag;
      expect(initialDrag).not.toBeNull();
      const initialSourceX = initialDrag!.sourceX;
      const initialSourceY = initialDrag!.sourceY;
      const moveCursorBefore = moveCursorTo.mock.calls.length;

      // Second mousedown elsewhere — must be ignored.
      mousedown(setup.container, 500, 500);

      expect(setup.controller.pendingAnchoredDrag).not.toBeNull();
      expect(setup.controller.pendingAnchoredDrag?.sourceX).toBe(initialSourceX);
      expect(setup.controller.pendingAnchoredDrag?.sourceY).toBe(initialSourceY);
      expect(moveCursorTo.mock.calls.length).toBe(moveCursorBefore);
      expect(selectNode).toHaveBeenCalledTimes(1);
    });

    it("ignores a second mousedown while a resize drag is active", () => {
      setup = makePointerControllerSetup({ isPageless: true });
      overrideLayout(setup.editor, { anchoredObjects: [makePlacement(setup)] });
      stubImageSelection(setup, 5);
      vi.spyOn(setup.editor, "getNodeRect").mockReturnValue({ ...SQUARE_RECT });

      mousedown(setup.container, SQUARE_RECT.x, SQUARE_RECT.y);
      const initialResize = setup.controller.pendingResize;
      expect(initialResize?.handle).toBe("TL");

      mousedown(setup.container, 500, 500);
      expect(setup.controller.pendingResize?.handle).toBe("TL");
    });

    it("allows a fresh mousedown after mouseup releases the drag", () => {
      setup = makePointerControllerSetup({ isPageless: true });
      overrideLayout(setup.editor, { anchoredObjects: [makePlacement(setup)] });
      const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});

      mousedown(setup.container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      expect(setup.controller.pendingAnchoredDrag).not.toBeNull();
      mouseup(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      expect(setup.controller.pendingAnchoredDrag).toBeNull();

      mousedown(setup.container, SQUARE_RECT.x + 40, SQUARE_RECT.y + 40);
      expect(setup.controller.pendingAnchoredDrag).not.toBeNull();
      expect(selectNode).toHaveBeenCalledTimes(2);
    });
  });
});
