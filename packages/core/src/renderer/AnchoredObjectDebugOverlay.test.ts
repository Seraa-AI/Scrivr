/**
 * AnchoredObjectDebugOverlay tests — gate behaviour + paint invocation.
 *
 * Visual correctness can't be unit-tested in a meaningful way, so the tests
 * verify the gating contract: the handler is a no-op when the flag is off,
 * and exercises the ctx when the flag is on. Anything more would just
 * pin internal paint details that may legitimately change.
 *
 * Setup: drive a real `Editor` via `makeRendererTestSetup`, swap in fixture
 * placements through `overrideLayout`, and capture the registered overlay
 * handler by spying on `addOverlayRenderHandler`. Paint assertions use a real
 * canvas context with method spies; the test cares about *which* canvas calls
 * fire, not their pixel-level effect.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { installAnchoredObjectDebugOverlay } from "./AnchoredObjectDebugOverlay";
import {
  makeRendererTestSetup,
  overrideLayout,
  type RendererTestSetup,
} from "../test-utils";
import type { OverlayRenderHandler } from "../extensions/types";
import type { CharacterMap } from "../layout/CharacterMap";
import type { ResolvedTheme } from "../model/theme";
import type { PageConfig } from "../layout/PageLayout";
import type { Node } from "prosemirror-model";

/** Minimal fixture shape — matches what the overlay reads off each placement. */
interface PlacementFixture {
  docPos: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  wrapMode: string;
  zIndex: number;
  node: Node;
  clamped?: boolean;
}

interface OverlaySetup {
  editor: RendererTestSetup["editor"];
  getHandler: () => OverlayRenderHandler;
  cleanup: () => void;
}

function makeOverlaySetup(opts: {
  flag: boolean;
  objects: ReadonlyArray<PlacementFixture>;
}): OverlaySetup {
  const setup = makeRendererTestSetup({ pageCount: 1 });
  setup.editor.debug.anchoredObjects = opts.flag;
  overrideLayout(setup.editor, { anchoredObjects: opts.objects });

  let registered: OverlayRenderHandler | null = null;
  vi.spyOn(setup.editor, "addOverlayRenderHandler").mockImplementation((handler) => {
    registered = handler;
    return () => {
      registered = null;
    };
  });

  return {
    editor: setup.editor,
    getHandler: () => {
      if (registered === null) throw new Error("overlay handler not registered");
      return registered;
    },
    cleanup: setup.cleanup,
  };
}

interface SpiedContext {
  ctx: CanvasRenderingContext2D;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

function makeSpiedContext(): SpiedContext {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return {
    ctx,
    fillRect: vi.spyOn(ctx, "fillRect") as ReturnType<typeof vi.fn>,
    strokeRect: vi.spyOn(ctx, "strokeRect") as ReturnType<typeof vi.fn>,
    fillText: vi.spyOn(ctx, "fillText") as ReturnType<typeof vi.fn>,
    save: vi.spyOn(ctx, "save") as ReturnType<typeof vi.fn>,
  };
}

function paint(setup: OverlaySetup, spied: SpiedContext, page = 1): void {
  // OverlayRenderHandler's real signature has 5 args (ctx, page, pageConfig,
  // charMap, theme). The overlay under test only reads ctx + page + pageConfig,
  // so empty stand-ins are fine for charMap + theme.
  const handler = setup.getHandler();
  handler(
    spied.ctx,
    page,
    PAGE_CONFIG,
    {} as CharacterMap,
    {} as ResolvedTheme,
  );
}

const PAGE_CONFIG: PageConfig = {
  pageWidth: 800,
  pageHeight: 1000,
  margins: { top: 40, right: 40, bottom: 40, left: 40 },
};

function makeImageNode(setup: OverlaySetup, wrapMode: string): Node {
  return setup.editor.schema.nodes["image"]!.create({
    src: "x",
    width: 80,
    height: 60,
    wrapMode,
    margin: 12,
  });
}

function squareObj(setup: OverlaySetup, overrides: Partial<PlacementFixture> = {}): PlacementFixture {
  const wrapMode = overrides.wrapMode ?? "square";
  return {
    docPos: 5,
    page: 1,
    x: 100,
    y: 50,
    width: 80,
    height: 60,
    wrapMode,
    zIndex: 0,
    node: makeImageNode(setup, wrapMode),
    ...overrides,
  };
}

describe("installAnchoredObjectDebugOverlay", () => {
  let current: OverlaySetup | null = null;

  afterEach(() => {
    current?.cleanup();
    current = null;
  });

  function setup(opts: { flag: boolean; build?: (s: OverlaySetup) => PlacementFixture[] }): OverlaySetup {
    // Two-step: create setup with empty objects, then populate (build callback
    // needs the editor's real schema to construct real PM image nodes).
    const s = makeOverlaySetup({ flag: opts.flag, objects: [] });
    const objects = opts.build?.(s) ?? [];
    overrideLayout(s.editor, { anchoredObjects: objects });
    current = s;
    return s;
  }

  it("registers a handler and returns a dispose function", () => {
    const s = setup({ flag: false });
    const dispose = installAnchoredObjectDebugOverlay(s.editor);
    expect(typeof dispose).toBe("function");
    expect(s.getHandler()).toBeDefined();
  });

  it("no-op when editor.debug.anchoredObjects is false", () => {
    const s = setup({ flag: false, build: (s) => [squareObj(s)] });
    installAnchoredObjectDebugOverlay(s.editor);
    const spied = makeSpiedContext();
    paint(s, spied);
    expect(spied.fillRect).not.toHaveBeenCalled();
    expect(spied.strokeRect).not.toHaveBeenCalled();
    expect(spied.save).not.toHaveBeenCalled();
  });

  it("paints wrap-zone fill + label when flag is true (square)", () => {
    const s = setup({ flag: true, build: (s) => [squareObj(s)] });
    installAnchoredObjectDebugOverlay(s.editor);
    const spied = makeSpiedContext();
    paint(s, spied);
    // Wrap-zone fill (1) + label background (1) = 2 fillRect calls.
    expect(spied.fillRect).toHaveBeenCalledTimes(2);
    // Wrap-zone stroke = 1 strokeRect call (no clamp on this fixture).
    expect(spied.strokeRect).toHaveBeenCalledTimes(1);
    // Label text rendered.
    expect(spied.fillText).toHaveBeenCalledTimes(1);
    expect(spied.fillText.mock.calls[0]![0]).toBe("square z=0");
  });

  it("adds clamp outline when placement.clamped is true", () => {
    const s = setup({ flag: true, build: (s) => [squareObj(s, { clamped: true })] });
    installAnchoredObjectDebugOverlay(s.editor);
    const spied = makeSpiedContext();
    paint(s, spied);
    // Wrap-zone stroke + clamp outline = 2 strokeRect calls.
    expect(spied.strokeRect).toHaveBeenCalledTimes(2);
  });

  it("skips placements on other pages", () => {
    const s = setup({ flag: true, build: (s) => [squareObj(s, { page: 2 })] });
    installAnchoredObjectDebugOverlay(s.editor);
    const spied = makeSpiedContext();
    paint(s, spied);
    expect(spied.fillRect).not.toHaveBeenCalled();
  });

  it("paints a full-width band for top-bottom wrap", () => {
    const s = setup({ flag: true, build: (s) => [squareObj(s, { wrapMode: "top-bottom" })] });
    installAnchoredObjectDebugOverlay(s.editor);
    const spied = makeSpiedContext();
    paint(s, spied);
    // First fillRect is the band, spanning full pageWidth.
    const bandCall = spied.fillRect.mock.calls[0]!;
    expect(bandCall[0]).toBe(0);
    expect(bandCall[2]).toBe(PAGE_CONFIG.pageWidth);
  });

  it("renders nothing for behind/front (no wrap zone)", () => {
    const s = setup({ flag: true, build: (s) => [squareObj(s, { wrapMode: "behind" })] });
    installAnchoredObjectDebugOverlay(s.editor);
    const spied = makeSpiedContext();
    paint(s, spied);
    // No wrap-zone fill/stroke. Only the label fillRect + fillText fire.
    expect(spied.fillRect).toHaveBeenCalledTimes(1); // label background only
    expect(spied.strokeRect).not.toHaveBeenCalled();
    expect(spied.fillText).toHaveBeenCalledTimes(1);
  });
});
