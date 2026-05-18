/**
 * Shared test utilities for @scrivr/core tests.
 *
 * Centralises:
 *   - `createMeasurer()` / `createTestEditor()` — Skia-backed real canvas
 *     via `@napi-rs/canvas`, no DOM patching.
 *   - Common ProseMirror node builders (paragraph, heading, doc, etc.).
 *   - StarterKit context builder (full schema + fontConfig).
 *
 * Measurement is a real engine dependency: tests inject a real context, never
 * a fake. See `feedback_no_canvas_mocking.md` for the rationale.
 */

import { vi } from "vitest";
import { ExtensionManager, getSchema } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import { TextMeasurer } from "./layout/TextMeasurer";
import { Editor, type EditorOptions } from "./Editor";
import { Extension } from "./extensions/Extension";
import { EditorSurface } from "./surfaces/EditorSurface";
import { defaultPageConfig } from "./layout/PageLayout";

// Test-side schema source of truth — same `getSchema([StarterKit])` shape
// the production editor builds at construction time. Module-load only; no
// production code path runs this.
const schema = getSchema([StarterKit]);
import { createNapiCanvasContext } from "./test/createNapiCanvasContext";
import type { Node } from "prosemirror-model";
import type { Schema } from "prosemirror-model";
import type { FontConfig } from "./layout/FontConfig";
import type { PageConfig } from "./layout/PageLayout";

/**
 * Default text style used by `measureTextWidth()`. Mirrors the engine's
 * default body font; override only when a test specifically exercises
 * a different style.
 */
export const DEFAULT_TEST_FONT = "16px sans-serif";

/**
 * Creates a TextMeasurer backed by a real `@napi-rs/canvas` context — the
 * one and only way layout tests should measure text. Calling this is the
 * test-side equivalent of how `Editor` constructs its production measurer.
 */
export function createMeasurer(): TextMeasurer {
  return new TextMeasurer({
    lineHeightMultiplier: 1.2,
    context: createNapiCanvasContext(),
  });
}

/**
 * Construct a real `Editor` wired to a Skia-backed `TextMeasurer`. Use this
 * — never `new Editor()` directly — in any test that depends on layout,
 * text width, cursor geometry, pagination, tile bounds, or page projection.
 */
export function createTestEditor(options: Partial<EditorOptions> = {}): Editor {
  return new Editor({
    ...options,
    textMeasurer: options.textMeasurer ?? createMeasurer(),
  });
}

/**
 * Measure a string with the same backend the engine uses in tests. Use this
 * to drive `toBeCloseTo` assertions instead of hardcoding pixel constants.
 */
export function measureTextWidth(text: string, font = DEFAULT_TEST_FONT): number {
  const ctx = createNapiCanvasContext();
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Empty or text paragraph node. */
export function paragraph(text = ""): Node {
  return text
    ? schema.node("paragraph", null, [schema.text(text)])
    : schema.node("paragraph", null, []);
}

/** Paragraph with bold text. */
export function boldParagraph(text: string): Node {
  return schema.node("paragraph", null, [
    schema.text(text, [schema.marks["bold"]!.create()]),
  ]);
}

/** Paragraph with underlined text. */
export function underlineParagraph(text: string): Node {
  return schema.node("paragraph", null, [
    schema.text(text, [schema.marks["underline"]!.create()]),
  ]);
}

/** Paragraph with strikethrough text. */
export function strikethroughParagraph(text: string): Node {
  return schema.node("paragraph", null, [
    schema.text(text, [schema.marks["strikethrough"]!.create()]),
  ]);
}

/** Paragraph with a plain run followed by an underlined run. */
export function mixedParagraph(plain: string, underlined: string): Node {
  return schema.node("paragraph", null, [
    schema.text(plain),
    schema.text(underlined, [schema.marks["underline"]!.create()]),
  ]);
}

/** Heading node at the given level (1–6). */
export function heading(level: number, text: string): Node {
  return schema.node("heading", { level }, [schema.text(text)]);
}

/** Document node wrapping an array of block nodes. */
export function doc(...blocks: Node[]): Node {
  return schema.node("doc", null, blocks);
}

/** Hard page-break node. */
export function pageBreak(): Node {
  return schema.node("pageBreak");
}

export interface FullEditorContext {
  /** ProseMirror schema built from StarterKit — includes all built-in nodes and marks. */
  schema: Schema;
  /** Merged FontConfig from StarterKit — block styles for all built-in node types. */
  fontConfig: FontConfig;
}

/**
 * Builds a full editor context (schema + fontConfig) from StarterKit.
 *
 * Use this in tests that need nodes not present in the minimal base schema
 * (e.g. horizontalRule, image, listItem) or that need accurate block styles.
 *
 * @example
 * const { schema, fontConfig } = buildStarterKitContext();
 * const hr = schema.nodes["horizontalRule"]!.create();
 */
export function buildStarterKitContext(): FullEditorContext {
  const manager = new ExtensionManager([StarterKit]);
  return {
    schema: manager.schema,
    fontConfig: manager.buildBlockStyles(),
  };
}

// ── Renderer test setup ──────────────────────────────────────────────────────
//
// Helpers shared by renderer tests (TileManager, PointerController, etc.)
// that need a real `Editor` mounted in a DOM container with predictable
// page geometry. Built on `createTestEditor` so canvas measurement is real.

/**
 * Build a doc JSON spanning `pageCount` pages by interleaving (N-1)
 * `pageBreak` nodes between short paragraphs. Each page has minimal content
 * — enough for layout to produce real metrics, no canvas-fake gymnastics.
 */
export function makeNPageDoc(pageCount: number): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  for (let i = 0; i < pageCount; i++) {
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: `page ${i + 1}` }],
    });
    if (i < pageCount - 1) content.push({ type: "pageBreak" });
  }
  return { type: "doc", content };
}

export interface RendererTestSetupOptions {
  /** Wrap `container` in a vertically scrollable parent (clientHeight=800). */
  scrollParent?: boolean;
  pageConfig?: PageConfig;
  /** Force the editor's doc to span this many pages via pageBreak nodes. Default: 10. */
  pageCount?: number;
  /** Extra extensions appended to StarterKit (e.g. chrome contributions). */
  extraExtensions?: Extension[];
}

export interface RendererTestSetup {
  editor: Editor;
  container: HTMLDivElement;
  scrollParent?: HTMLDivElement | undefined;
  pageConfig: PageConfig;
  cleanup: () => void;
}

/**
 * Real-Editor renderer test setup: creates the editor, mounts a container,
 * optionally wraps it in a scroll parent. Caller is responsible for calling
 * `cleanup()` (destroys the editor + removes DOM nodes).
 */
export function makeRendererTestSetup(
  opts: RendererTestSetupOptions = {},
): RendererTestSetup {
  const pageConfig = opts.pageConfig ?? defaultPageConfig;
  const pageCount = opts.pageCount ?? 10;

  const container = document.createElement("div");
  let scrollParent: HTMLDivElement | undefined;
  if (opts.scrollParent) {
    scrollParent = document.createElement("div");
    scrollParent.style.overflowY = "scroll";
    Object.defineProperty(scrollParent, "clientHeight", { value: 800, configurable: true });
    Object.defineProperty(scrollParent, "scrollTop", { value: 0, configurable: true, writable: true });
    scrollParent.appendChild(container);
    document.body.appendChild(scrollParent);
  } else {
    document.body.appendChild(container);
  }

  const extensions = opts.extraExtensions
    ? [StarterKit, ...opts.extraExtensions]
    : undefined;
  const editor = createTestEditor({
    pageConfig,
    content: makeNPageDoc(pageCount),
    ...(extensions ? { extensions } : {}),
  });

  function cleanup(): void {
    editor.destroy();
    (scrollParent ?? container).remove();
  }

  return { editor, container, scrollParent, pageConfig, cleanup };
}

/**
 * Single-purpose extension contributing fixed header + footer band heights
 * on every page. Lets renderer tests verify chrome-band branches without
 * pulling in the @scrivr/plugins HeaderFooter extension (cross-package).
 */
export function fixedChromeBandsExtension(
  headerHeight: number,
  footerHeight: number,
): Extension {
  return Extension.create({
    name: "test_fixedChromeBands",
    addPageChrome() {
      return {
        name: "test_fixedChromeBands",
        measure() {
          return {
            topForPage: () => headerHeight,
            bottomForPage: () => footerHeight,
            stable: true,
          };
        },
        render() {},
      };
    },
  });
}

/**
 * Register a real EditorSurface with the editor and activate it. Returns
 * the surface so callers can read its id. Drives the real SurfaceRegistry
 * — no surface mocks.
 */
export function registerActiveSurface(
  editor: Editor,
  id = "test:surface",
): EditorSurface {
  const surface = new EditorSurface({
    id,
    owner: "test",
    schema: editor.schema,
    initialDocJSON: { type: "doc", content: [{ type: "paragraph" }] },
  });
  editor.surfaces.register(surface);
  editor.surfaces.activate(surface.id);
  return surface;
}

// ── PointerController test setup ─────────────────────────────────────────────
//
// Drives a real `PointerController` against a real `Editor`. Tests stay
// behavioural — assert which Editor methods got called when, while keeping
// the dependency surface honest (no editor mocks).

import { PointerController, type PointerControllerDeps } from "./renderer/PointerController";

export interface PointerControllerSetupOptions {
  isPageless?: boolean;
  tileHeight?: number;
  slotHeight?: number;
  pageConfig?: PageConfig;
}

export interface PointerControllerSetup {
  editor: Editor;
  controller: PointerController;
  /**
   * The element PointerController listens on. Positioned at viewport
   * (0, 0) so client coords equal doc coords for simpler test math.
   */
  container: HTMLDivElement;
  cleanup: () => void;
}

/**
 * Replace fields on the editor's `layout` getter result. Single localized
 * seam for tests that need specific `anchoredObjects` or `pages` shapes
 * which real layout would only produce via painful doc construction. Calls
 * compose — re-invoking the helper merges new fields on top.
 */
export function overrideLayout(
  editor: Editor,
  partial: Record<string, unknown>,
): void {
  const real = editor.layout;
  Object.defineProperty(editor, "layout", {
    get: () => ({ ...real, ...partial }),
    configurable: true,
  });
}

export function makePointerControllerSetup(
  opts: PointerControllerSetupOptions = {},
): PointerControllerSetup {
  const tileHeight = opts.tileHeight ?? 1200;
  const slotHeight = opts.slotHeight ?? tileHeight + 24;
  const isPageless = opts.isPageless ?? false;
  const pageConfig = opts.pageConfig ?? defaultPageConfig;

  const editor = createTestEditor({
    pageConfig,
    content: makeNPageDoc(1),
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  // Pin the container's bounding rect so `clientX/clientY` map 1:1 to doc
  // coords. jsdom layout is non-functional; without this stub
  // `getBoundingClientRect()` returns zeros and click math breaks.
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1200,
    width: 800, height: 1200, toJSON: () => ({}),
  });

  const deps: PointerControllerDeps = {
    editor,
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
    scheduleUpdate: () => {},
  };
  const controller = new PointerController(deps);
  controller.attach();

  function cleanup(): void {
    controller.detach();
    container.remove();
    editor.destroy();
  }

  return { editor, controller, container, cleanup };
}
