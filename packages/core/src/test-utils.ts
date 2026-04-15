/**
 * Shared test utilities for @scrivr/core tests.
 *
 * Centralises:
 *   - Canvas mock setup (consistent char width / ascent / descent across all layout tests)
 *   - TextMeasurer factory
 *   - Common ProseMirror node builders (paragraph, heading, doc, etc.)
 *   - StarterKit context builder (full schema + fontConfig)
 */

import { vi } from "vitest";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import { TextMeasurer } from "./layout/TextMeasurer";
import { schema } from "./model/schema";
import type { Node } from "prosemirror-model";
import type { Schema } from "prosemirror-model";
import type { FontConfig } from "./layout/FontConfig";
  
/** Fixed character width used by the canvas mock — 8px per character. */
export const MOCK_CHAR_WIDTH = 8;
/** Fixed font ascent used by the canvas mock. */
export const MOCK_ASCENT = 12;
/** Fixed font descent used by the canvas mock. */
export const MOCK_DESCENT = 3;
/**
 * Line height produced by the default measurer (lineHeightMultiplier: 1.2):
 * (MOCK_ASCENT + MOCK_DESCENT) * 1.2 = 18
 */
export const MOCK_LINE_HEIGHT = (MOCK_ASCENT + MOCK_DESCENT) * 1.2;

/**
 * Mocks HTMLCanvasElement.getContext so TextMeasurer returns deterministic values.
 * Call inside a beforeEach so each test gets a fresh spy.
 *
 * @example
 * beforeEach(() => mockCanvas());
 */
export function mockCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: vi.fn((text: string) => ({
      width: text.length * MOCK_CHAR_WIDTH,
      actualBoundingBoxAscent: MOCK_ASCENT,
      actualBoundingBoxDescent: MOCK_DESCENT,
      fontBoundingBoxAscent: MOCK_ASCENT,
      fontBoundingBoxDescent: MOCK_DESCENT,
    })),
    font: "",
  } as unknown as CanvasRenderingContext2D);
}

/**
 * Creates a TextMeasurer with the standard lineHeightMultiplier used in tests (1.2).
 * Requires mockCanvas() to have been called first.
 */
export function createMeasurer(): TextMeasurer {
  return new TextMeasurer({ lineHeightMultiplier: 1.2 });
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
