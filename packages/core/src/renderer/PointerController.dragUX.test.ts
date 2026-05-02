/**
 * PointerController drag UX tests — pins the four hardening fixes from
 * docs/anchored-objects/04-edit-ux.md § Dragging:
 *
 *   1. Handle precedence — pointer well inside an image's rect resolves to
 *      body drag, NOT a resize handle hit. Without the EDGE_BAND_PX guard
 *      the 8-point handle grid would steal the entire rect for resize.
 *   2. Clamp-no-move — a horizontal drag whose clamped target X equals the
 *      source X dispatches no PM transaction (no spurious xAlign:"custom"
 *      flip + re-layout).
 *   3. Gap drop — a drop in the inter-page gap is reported as gap:true via
 *      hitTest and is treated as a no-op by commitAnchoredDrag.
 *   4. Cross-page resolve — when posAtCoords returns 0 on a virtualized
 *      destination page AND posAbove/posBelow return null, the layout-page
 *      block scan resolves the target docPos so vertical drag never
 *      silently collapses to docPos 0.
 *   5. Single source of truth — hitHandleAt reads through editor.getNodeRect
 *      (layout.anchoredObjects authoritative for anchored, charMap fallback
 *      for inline), so handles never paint at a stale charMap rect.
 *
 * Helpers are intentionally local rather than shared with PointerController.test.ts —
 * the click-routing suite there uses an empty selection mock; here we need a
 * NodeSelection-like fixture and full layout/getNodeRect plumbing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NodeSelection } from "prosemirror-state";
import { PointerController } from "./PointerController";
import type { PointerControllerDeps } from "./PointerController";
import type { Editor } from "../Editor";

interface ImageRect {
  docPos: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MockLayoutBlock {
  nodePos: number;
  y: number;
  height: number;
}

interface MockEditor {
  readOnly: boolean;
  selectNode: ReturnType<typeof vi.fn>;
  selection: {
    moveCursorTo: ReturnType<typeof vi.fn>;
    setSelection: ReturnType<typeof vi.fn>;
    selectWordAt: ReturnType<typeof vi.fn>;
    selectBlockAt: ReturnType<typeof vi.fn>;
  };
  charMap: {
    posAtCoords: ReturnType<typeof vi.fn>;
    coordsAtPos: ReturnType<typeof vi.fn>;
    objectRectAtPoint: ReturnType<typeof vi.fn>;
    getObjectRect: ReturnType<typeof vi.fn>;
    posBelow: ReturnType<typeof vi.fn>;
    posAbove: ReturnType<typeof vi.fn>;
  };
  layout: {
    anchoredObjects?: ImageRect[];
    pages?: { pageNumber: number; blocks: MockLayoutBlock[] }[];
    pageConfig: {
      pageWidth: number;
      margins: { top: number; right: number; bottom: number; left: number };
    };
  };
  getState: ReturnType<typeof vi.fn>;
  getSelectionSnapshot: ReturnType<typeof vi.fn>;
  setNodeAttrs: ReturnType<typeof vi.fn>;
  moveNode: ReturnType<typeof vi.fn>;
  moveAndUpdateNode: ReturnType<typeof vi.fn>;
  ensurePagePopulated: ReturnType<typeof vi.fn>;
  getNodeRect: ReturnType<typeof vi.fn>;
  surfaces?: undefined;
  debug?: { drag?: boolean };
}

/**
 * Builds an object whose prototype chain includes NodeSelection so the
 * `sel instanceof NodeSelection` check inside hitHandleAt passes without
 * spinning up a full ProseMirror state. ProseMirror's Selection base
 * defines `from`/`to` as getters (no setters), so we use defineProperty
 * to override them with plain data values.
 */
function imageNodeSelection(docPos: number, width = 80, height = 60): NodeSelection {
  const sel = Object.create(NodeSelection.prototype);
  const fields: Record<string, unknown> = {
    from: docPos,
    to: docPos + 1,
    head: docPos,
    anchor: docPos,
    empty: false,
    node: {
      nodeSize: 1,
      type: { name: "image", create: vi.fn() },
      attrs: { width, height, wrapMode: "square", xAlign: "left" },
    },
  };
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(sel, key, { value, configurable: true });
  }
  return sel as NodeSelection;
}

function makeMockEditor(overrides: Partial<MockEditor> = {}): MockEditor {
  const base: MockEditor = {
    readOnly: false,
    selectNode: vi.fn(),
    selection: {
      moveCursorTo: vi.fn(),
      setSelection: vi.fn(),
      selectWordAt: vi.fn(() => ({ from: 0, to: 0 })),
      selectBlockAt: vi.fn(),
    },
    charMap: {
      posAtCoords: vi.fn(() => 10),
      coordsAtPos: vi.fn(() => ({ x: 0, y: 0, height: 16, page: 1 })),
      objectRectAtPoint: vi.fn(() => undefined),
      getObjectRect: vi.fn(() => undefined),
      posBelow: vi.fn(() => null),
      posAbove: vi.fn(() => null),
    },
    layout: {
      pageConfig: {
        pageWidth: 800,
        margins: { top: 40, right: 40, bottom: 40, left: 40 },
      },
    },
    getState: vi.fn(() => ({
      doc: {
        resolve: vi.fn(() => ({
          depth: 1,
          start: vi.fn(() => 1),
          end: vi.fn(() => 30),
        })),
        nodeAt: vi.fn(() => ({
          attrs: { width: 80, height: 60, wrapMode: "square", xAlign: "left" },
        })),
        content: { size: 40 },
      },
      selection: { head: 0, anchor: 0, from: 0, to: 0, empty: true },
    })),
    getSelectionSnapshot: vi.fn(() => ({
      head: 0, anchor: 0, from: 0, to: 0, empty: true,
    })),
    setNodeAttrs: vi.fn(),
    moveNode: vi.fn(),
    moveAndUpdateNode: vi.fn(),
    ensurePagePopulated: vi.fn(),
    getNodeRect: vi.fn(() => undefined),
  };
  return { ...base, ...overrides };
}

function makeController(
  editor: MockEditor,
  options: { isPageless?: boolean; tileHeight?: number; slotHeight?: number } = {},
): {
  controller: PointerController;
  container: HTMLDivElement;
} {
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 1200 }) as DOMRect;
  document.body.appendChild(container);

  const tileHeight = options.tileHeight ?? 1200;
  const slotHeight = options.slotHeight ?? tileHeight + 24;
  const isPageless = options.isPageless ?? false;

  const deps: PointerControllerDeps = {
    editor: editor as unknown as Editor,
    tilesContainer: container,
    pool: [],
    slotHeight: () => slotHeight,
    tileHeight: () => tileHeight,
    isPageless: () => isPageless,
    visualYToDocY: (y) => {
      if (isPageless) return { page: 1, docY: y };
      const tileIndex = Math.floor(y / slotHeight);
      return { page: tileIndex + 1, docY: y - tileIndex * slotHeight };
    },
    scheduleUpdate: vi.fn(),
  };

  const controller = new PointerController(deps);
  controller.attach();
  return { controller, container };
}

function mousedown(container: HTMLDivElement, x: number, y: number): void {
  container.dispatchEvent(
    new MouseEvent("mousedown", { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

function mousemove(x: number, y: number): void {
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

function mouseup(x = 0, y = 0): void {
  document.dispatchEvent(
    new MouseEvent("mouseup", { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

const SQUARE_RECT: ImageRect = {
  docPos: 5,
  page: 1,
  x: 100,
  y: 50,
  width: 80,
  height: 60,
};

const placement = (overrides: Partial<ImageRect> = {}) => ({
  ...SQUARE_RECT,
  ...overrides,
  wrapMode: "square" as const,
  node: {
    nodeSize: 1,
    type: { create: vi.fn() },
    attrs: { width: SQUARE_RECT.width, height: SQUARE_RECT.height, wrapMode: "square" },
  },
  anchorGlobalY: SQUARE_RECT.y,
  anchorPage: SQUARE_RECT.page,
  globalY: SQUARE_RECT.y,
});

describe("PointerController — drag UX", () => {
  let editor: MockEditor;
  let container: HTMLDivElement;
  let controller: PointerController;

  afterEach(() => {
    controller?.detach();
    container?.remove();
  });

  describe("Step 2 — handle vs body precedence", () => {
    it("pointerdown 50px inside the rect resolves to body drag, not a resize handle", () => {
      // Image is currently selected (NodeSelection). The 8-handle grid would
      // otherwise blanket the bounding box; EDGE_BAND_PX restricts handles to
      // the rect edge band so the inner body is reachable for body drag.
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement()],
        },
      });
      const sel = imageNodeSelection(5);
      editor.getState.mockReturnValue({
        doc: {
          resolve: vi.fn(() => ({ depth: 1, start: () => 1, end: () => 30 })),
          nodeAt: vi.fn(() => sel.node),
          content: { size: 40 },
        },
        selection: sel,
      });
      editor.getNodeRect.mockReturnValue({ ...SQUARE_RECT });
      ({ controller, container } = makeController(editor, { isPageless: true }));

      // Click 50px from the left edge of a 80px-wide rect = inner body
      // (well past EDGE_BAND_PX = 12).
      mousedown(container, SQUARE_RECT.x + 40, SQUARE_RECT.y + 30);

      expect(controller.pendingResize).toBeNull();
      expect(controller.pendingAnchoredDrag).not.toBeNull();
      expect(controller.pendingAnchoredDrag?.sourcePage).toBe(1);
    });

    it("pointerdown on the rect edge still resolves to a resize handle", () => {
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement()],
        },
      });
      const sel = imageNodeSelection(5);
      editor.getState.mockReturnValue({
        doc: {
          resolve: vi.fn(() => ({ depth: 1, start: () => 1, end: () => 30 })),
          nodeAt: vi.fn(() => sel.node),
          content: { size: 40 },
        },
        selection: sel,
      });
      editor.getNodeRect.mockReturnValue({ ...SQUARE_RECT });
      ({ controller, container } = makeController(editor, { isPageless: true }));

      // Click exactly on the top-left corner = TL handle hit.
      mousedown(container, SQUARE_RECT.x, SQUARE_RECT.y);

      expect(controller.pendingResize).not.toBeNull();
      expect(controller.pendingResize?.handle).toBe("TL");
      expect(controller.pendingAnchoredDrag).toBeNull();
    });
  });

  describe("Step 3 — clamp-no-move", () => {
    it("dragging a square-left image further left dispatches no PM transaction", () => {
      // square-left image painted at contentX = 40 (margins.left). Dragging
      // farther left clamps newX to contentX, equal to startImageX. The
      // commit guard must skip the setNodeAttrs that would otherwise flip
      // xAlign to "custom" with no visual change.
      const startImageX = 40;
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement({ x: startImageX })],
        },
      });
      editor.charMap.posAtCoords.mockReturnValue(5); // stays in source
      ({ controller, container } = makeController(editor, { isPageless: true }));

      const grabX = startImageX + 30;
      const grabY = SQUARE_RECT.y + 30;
      mousedown(container, grabX, grabY);
      mousemove(grabX - 200, grabY);   // pure horizontal — way off the left edge
      mouseup(grabX - 200, grabY);

      expect(editor.setNodeAttrs).not.toHaveBeenCalled();
      expect(editor.moveNode).not.toHaveBeenCalled();
      expect(editor.moveAndUpdateNode).not.toHaveBeenCalled();
    });
  });

  describe("Step 4 — gap-as-invalid drop zone", () => {
    it("drop in the inter-page gap dispatches no PM transaction", () => {
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement()],
        },
      });
      ({ controller, container } = makeController(editor, {
        isPageless: false,
        tileHeight: 1200,
        slotHeight: 1224, // 1200 + 24px gap
      }));

      mousedown(container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      // Drop in the gap zone (visualY between 1200 and 1224 on page 1).
      mousemove(SQUARE_RECT.x + 30, 1210);
      // The overlay state should reflect disabled = true while in the gap.
      expect(controller.pendingAnchoredDrag?.disabled).toBe(true);
      expect(controller.pendingAnchoredDrag?.caret).toBeNull();

      mouseup(SQUARE_RECT.x + 30, 1210);
      expect(editor.setNodeAttrs).not.toHaveBeenCalled();
      expect(editor.moveNode).not.toHaveBeenCalled();
      expect(editor.moveAndUpdateNode).not.toHaveBeenCalled();
    });
  });

  describe("Step 5 — cross-page resolve via layout fragments", () => {
    it("posAtCoords→0 on a virtualized destination page resolves via layout.pages", () => {
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement()],
          pages: [
            { pageNumber: 1, blocks: [{ nodePos: 0, y: 0, height: 200 }] },
            // Block on page 2 whose Y range contains docY=80; nodePos+1 = 43.
            { pageNumber: 2, blocks: [{ nodePos: 42, y: 50, height: 120 }] },
          ],
        },
      });
      // Source-range hover triggers posBelow fallback first; both null →
      // layout.pages fallback fires only when posAtCoords returns 0 directly.
      // Simulate the cross-page case explicitly: posAtCoords returns 0 on
      // page 2, never inside [from, to].
      editor.charMap.posAtCoords.mockImplementation(
        (_x: number, _y: number, page: number) => (page === 2 ? 0 : 5),
      );
      ({ controller, container } = makeController(editor, {
        isPageless: false,
        tileHeight: 1200,
        slotHeight: 1224,
      }));

      mousedown(container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      // Drop on page 2 at docY ≈ 80 (visualY = 1224 + 80 = 1304).
      mousemove(SQUARE_RECT.x + 30, 1304);
      mouseup(SQUARE_RECT.x + 30, 1304);

      // Layout fallback resolved page 2's block start → nodePos+1 = 43.
      // Phase 2: cross-page commits via moveAndUpdateNode (atomic move + attr
      // reset) so the new anchor and yOffset land in one transaction. dx = 0
      // so xAlign/x aren't included; only yOffset: 0.
      expect(editor.moveAndUpdateNode).toHaveBeenCalledWith(5, 43, { yOffset: 0 });
      expect(editor.moveNode).not.toHaveBeenCalled();
      expect(editor.setNodeAttrs).not.toHaveBeenCalled();
    });
  });

  describe("Step 7 — same-page re-anchor", () => {
    // Dragging an image far down its own page parks it next to a different
    // paragraph than its docPos anchor. resolveSamePageReanchor catches the
    // case where the new anchor would dramatically shrink |yOffset| (past
    // RE_ANCHOR_THRESHOLD_PX = 24) and re-parents the image so the saved
    // yOffset stays small. Without this the offset accumulates across drags.
    it("dy past threshold re-anchors to the closer paragraph", () => {
      const sourceBlock = { nodePos: 4, y: 50, height: 100 };
      const targetBlock = { nodePos: 20, y: 200, height: 100 };
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement()],
          pages: [
            { pageNumber: 1, blocks: [sourceBlock, targetBlock] },
          ],
        },
      });
      // Stay on the source range so resolveDragTargetDocPos returns null
      // (same-page yOffset commit path).
      editor.charMap.posAtCoords.mockReturnValue(5);
      ({ controller, container } = makeController(editor, { isPageless: true }));

      mousedown(container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      mousemove(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30 + 200); // dy = 200
      mouseup(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30 + 200);

      // imageGlobalY = anchorGlobalY (50) + newYOffset (200) = 250.
      // Distance to targetBlock at y=200 → 50. wouldReduce = 200 - 50 = 150 > 24.
      // Re-anchor to targetBlock.nodePos + 1 = 21 with yOffset = 250 - 200 = 50.
      expect(editor.moveAndUpdateNode).toHaveBeenCalledWith(5, 21, { yOffset: 50 });
      expect(editor.setNodeAttrs).not.toHaveBeenCalled();
    });

    it("no closer paragraph → keeps the original anchor (setNodeAttrs path)", () => {
      // Re-anchor only fires when a sibling paragraph is dramatically closer
      // to the painted top than the source. Here the only other block is far
      // below the dropped position, so wouldReduce stays <= 24 and the
      // same-page commit goes through setNodeAttrs with the new yOffset.
      const sourceBlock = { nodePos: 4, y: 50, height: 100 };
      const farBlock = { nodePos: 20, y: 400, height: 100 };
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement()],
          pages: [{ pageNumber: 1, blocks: [sourceBlock, farBlock] }],
        },
      });
      editor.charMap.posAtCoords.mockReturnValue(5);
      ({ controller, container } = makeController(editor, { isPageless: true }));

      mousedown(container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      mousemove(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30 + 30);
      mouseup(SQUARE_RECT.x + 30, SQUARE_RECT.y + 30 + 30);

      expect(editor.setNodeAttrs).toHaveBeenCalledWith(5, { yOffset: 30 });
      expect(editor.moveAndUpdateNode).not.toHaveBeenCalled();
    });
  });

  describe("Step 8 — cross-page yOffset preserves visual position", () => {
    // Cross-page drops must commit a yOffset measured against the destination
    // anchor's globalY, not 0. Otherwise the image snaps to the new anchor's
    // natural row, ignoring where the user dropped it.
    it("drop on a destination page commits non-zero yOffset against the new anchor", () => {
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement()],
          pages: [
            { pageNumber: 1, blocks: [{ nodePos: 0, y: 0, height: 200 }] },
            { pageNumber: 2, blocks: [{ nodePos: 42, y: 50, height: 120 }] },
          ],
        },
      });
      editor.charMap.posAtCoords.mockImplementation(
        (_x: number, _y: number, page: number) => (page === 2 ? 0 : 5),
      );
      ({ controller, container } = makeController(editor, {
        isPageless: false,
        tileHeight: 1200,
        slotHeight: 1224,
      }));

      // grabOffsetY = 80 - 50 = 30. Drop at page 2 docY = 120 → ghost top at
      // localY 90. Anchor block on page 2 at localY 50. Expected yOffset = 40.
      mousedown(container, SQUARE_RECT.x + 30, SQUARE_RECT.y + 30);
      mousemove(SQUARE_RECT.x + 30, 1224 + 120);
      mouseup(SQUARE_RECT.x + 30, 1224 + 120);

      expect(editor.moveAndUpdateNode).toHaveBeenCalledWith(5, 43, { yOffset: 40 });
    });
  });

  describe("Step 6 — single source of truth", () => {
    it("hitHandleAt reads from editor.getNodeRect (layout.anchoredObjects authoritative)", () => {
      // Drift fixture: charMap reports a stale rect at x=999; layout.anchoredObjects
      // (returned via getNodeRect) is the authoritative position. A click on the
      // canonical TL corner (200, 300) must resolve to a handle via the layout
      // rect — if hitHandleAt still read charMap, the click wouldn't match.
      editor = makeMockEditor({
        layout: {
          ...makeMockEditor().layout,
          anchoredObjects: [placement({ x: 200, y: 300 })],
        },
      });
      const sel = imageNodeSelection(5);
      editor.getState.mockReturnValue({
        doc: {
          resolve: vi.fn(() => ({ depth: 1, start: () => 1, end: () => 30 })),
          nodeAt: vi.fn(() => sel.node),
          content: { size: 40 },
        },
        selection: sel,
      });
      // Stale charMap rect — would never match the click position.
      editor.charMap.getObjectRect.mockReturnValue({
        docPos: 5,
        page: 1,
        x: 999,
        y: 999,
        width: 80,
        height: 60,
      });
      // Layout-derived rect — the canonical position.
      editor.getNodeRect.mockReturnValue({
        docPos: 5,
        page: 1,
        x: 200,
        y: 300,
        width: 80,
        height: 60,
      });
      ({ controller, container } = makeController(editor, { isPageless: true }));

      mousedown(container, 200, 300); // canonical TL corner

      expect(controller.pendingResize?.handle).toBe("TL");
      // And charMap.getObjectRect was NOT the source — the test would have
      // failed above if it were, since the charMap rect is at (999, 999).
    });
  });
});
