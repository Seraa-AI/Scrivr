/**
 * AnchoredObjectDebugOverlay tests — gate behaviour + paint invocation.
 *
 * Visual correctness can't be unit-tested in a meaningful way, so the tests
 * verify the gating contract: the handler is a no-op when the flag is off,
 * and exercises the ctx when the flag is on. Anything more would just
 * pin internal paint details that may legitimately change.
 */
import { describe, it, expect, vi } from "vitest";
import { installAnchoredObjectDebugOverlay } from "./AnchoredObjectDebugOverlay";
import type { Editor } from "../Editor";
import type { PageConfig } from "../layout/PageLayout";

type OverlayHandler = (
  ctx: CanvasRenderingContext2D,
  pageNumber: number,
  pageConfig: PageConfig,
  charMap: unknown,
) => void;

interface MinimalLayout {
  anchoredObjects?: ReadonlyArray<{
    docPos: number;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    wrapMode: string;
    zIndex: number;
    node: unknown;
    clamped?: boolean;
  }>;
}

function makeFakeEditor(opts: {
  flag: boolean;
  objects: NonNullable<MinimalLayout["anchoredObjects"]>;
}): { editor: Editor; getHandler: () => OverlayHandler } {
  let registered: OverlayHandler | null = null;
  const editor = {
    debug: { anchoredObjects: opts.flag },
    layout: { anchoredObjects: opts.objects },
    addOverlayRenderHandler: (handler: OverlayHandler) => {
      registered = handler;
      return () => { registered = null; };
    },
  } as unknown as Editor;
  return { editor, getHandler: () => registered! };
}

function makeFakeCtx(): CanvasRenderingContext2D & {
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
} {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 30 })),
    setLineDash: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textBaseline: "alphabetic" as CanvasTextBaseline,
  };
  return ctx as unknown as ReturnType<typeof makeFakeCtx>;
}

const PAGE_CONFIG: PageConfig = {
  pageWidth: 800,
  pageHeight: 1000,
  margins: { top: 40, right: 40, bottom: 40, left: 40 },
};

const SQUARE_OBJ = {
  docPos: 5,
  page: 1,
  x: 100,
  y: 50,
  width: 80,
  height: 60,
  wrapMode: "square",
  zIndex: 0,
  node: { attrs: { width: 80, height: 60, wrapMode: "square", margin: 12 } },
};

describe("installAnchoredObjectDebugOverlay", () => {
  it("registers a handler and returns a dispose function", () => {
    const { editor, getHandler } = makeFakeEditor({ flag: false, objects: [] });
    const dispose = installAnchoredObjectDebugOverlay(editor);
    expect(typeof dispose).toBe("function");
    expect(getHandler()).toBeDefined();
  });

  it("no-op when editor.debug.anchoredObjects is false", () => {
    const { editor, getHandler } = makeFakeEditor({ flag: false, objects: [SQUARE_OBJ] });
    installAnchoredObjectDebugOverlay(editor);
    const ctx = makeFakeCtx();
    getHandler()(ctx, 1, PAGE_CONFIG, {});
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("paints wrap-zone fill + label when flag is true (square)", () => {
    const { editor, getHandler } = makeFakeEditor({ flag: true, objects: [SQUARE_OBJ] });
    installAnchoredObjectDebugOverlay(editor);
    const ctx = makeFakeCtx();
    getHandler()(ctx, 1, PAGE_CONFIG, {});
    // Wrap-zone fill (1) + label background (1) = 2 fillRect calls.
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    // Wrap-zone stroke = 1 strokeRect call (no clamp on this fixture).
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    // Label text rendered.
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText.mock.calls[0]![0]).toBe("square z=0");
  });

  it("adds clamp outline when placement.clamped is true", () => {
    const clampedObj = { ...SQUARE_OBJ, clamped: true };
    const { editor, getHandler } = makeFakeEditor({ flag: true, objects: [clampedObj] });
    installAnchoredObjectDebugOverlay(editor);
    const ctx = makeFakeCtx();
    getHandler()(ctx, 1, PAGE_CONFIG, {});
    // Wrap-zone stroke + clamp outline = 2 strokeRect calls.
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
  });

  it("skips placements on other pages", () => {
    const offPageObj = { ...SQUARE_OBJ, page: 2 };
    const { editor, getHandler } = makeFakeEditor({ flag: true, objects: [offPageObj] });
    installAnchoredObjectDebugOverlay(editor);
    const ctx = makeFakeCtx();
    getHandler()(ctx, 1, PAGE_CONFIG, {});
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("paints a full-width band for top-bottom wrap", () => {
    const tbObj = { ...SQUARE_OBJ, wrapMode: "top-bottom" };
    const { editor, getHandler } = makeFakeEditor({ flag: true, objects: [tbObj] });
    installAnchoredObjectDebugOverlay(editor);
    const ctx = makeFakeCtx();
    getHandler()(ctx, 1, PAGE_CONFIG, {});
    // First fillRect is the band, spanning full pageWidth.
    const bandCall = ctx.fillRect.mock.calls[0]!;
    expect(bandCall[0]).toBe(0);
    expect(bandCall[2]).toBe(PAGE_CONFIG.pageWidth);
  });

  it("renders nothing for behind/front (no wrap zone)", () => {
    const behindObj = { ...SQUARE_OBJ, wrapMode: "behind" };
    const { editor, getHandler } = makeFakeEditor({ flag: true, objects: [behindObj] });
    installAnchoredObjectDebugOverlay(editor);
    const ctx = makeFakeCtx();
    getHandler()(ctx, 1, PAGE_CONFIG, {});
    // No wrap-zone fill/stroke. Only the label fillRect + fillText fire.
    expect(ctx.fillRect).toHaveBeenCalledTimes(1); // label background only
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
  });
});
