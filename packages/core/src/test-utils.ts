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

import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import { TextMeasurer } from "./layout/TextMeasurer";
import { Editor, type EditorOptions } from "./Editor";
import { schema } from "./model/schema";
import { createNapiCanvasContext } from "./test/createNapiCanvasContext";
import type { Node } from "prosemirror-model";
import type { Schema } from "prosemirror-model";
import type { FontConfig } from "./layout/FontConfig";

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
