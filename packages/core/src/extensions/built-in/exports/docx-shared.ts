/**
 * Shared structural types + helpers used by built-in extensions that
 * contribute DOCX export handlers via `addExports().docx`.
 *
 * These mirror the public types in `@scrivr/export-docx` *structurally*,
 * with no runtime or type imports from that package. Keeping the
 * dependency one-way (export-docx → core) avoids a build-order cycle.
 *
 * The integration tests in `@scrivr/export-docx` drive a real `ServerEditor`
 * through `exportDocx` so any structural drift between these types and
 * the real `DocxContext` shape surfaces immediately.
 *
 * Convention: every built-in's DOCX contribution imports from this module
 * instead of redeclaring the same stand-ins locally. One place to update
 * if the export-docx contract ever needs to evolve.
 */

import type { Node as PmNode, Mark as PmMark } from "prosemirror-model";

// ── XML ─────────────────────────────────────────────────────────────────────

export type XmlAttrs = Record<string, string>;

export interface XmlNode {
  name: string;
  attributes?: XmlAttrs;
  children?: Array<XmlNode | string>;
}

export type XmlChild = XmlNode | string;

/**
 * Construct an `XmlNode`. Mirrors the `xml()` helper inside
 * `@scrivr/export-docx` — same behavior, declared locally so consumers
 * don't pull a runtime dep on the export package.
 */
export function el(
  name: string,
  attrs?: XmlAttrs,
  children?: XmlChild[],
): XmlNode {
  const node: XmlNode = { name };
  if (attrs && Object.keys(attrs).length > 0) node.attributes = attrs;
  if (children && children.length > 0) node.children = children;
  return node;
}

// ── Run / paragraph property shapes ─────────────────────────────────────────

/**
 * The run-property bag marks accumulate into. Matches `DocxRunProps` in
 * `@scrivr/export-docx`. Marks return a NEW object (treat `props` as
 * immutable) so the walker can short-circuit on identity.
 */
export interface DocxRunPropsShape {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  highlight?: string;
  fontSize?: number;
  fontFamily?: string;
  styleId?: string;
}

/** Matches `DocxStyleSpec` in `@scrivr/export-docx`. */
export interface DocxStyleSpecShape {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  spacingBefore?: number;
  spacingAfter?: number;
  lineHeight?: number;
}

// ── Context shape (subset that built-ins actually touch) ────────────────────

export interface DocxDiagnosticInput {
  code: string;
  message: string;
  pos?: number;
  nodeType?: string;
  markType?: string;
}

export interface DocxContextShape {
  editor: { getState(): { doc: PmNode } };
  styles: {
    paragraph: { getOrCreate(name: string, spec: DocxStyleSpecShape): string };
    character: { getOrCreate(name: string, spec: DocxStyleSpecShape): string };
  };
  rels: {
    addImage(mediaFilename: string): string;
    addHyperlink(url: string): string;
  };
  media: {
    add(input: { data: Uint8Array; contentType: string; ext: string }): string;
  };
  shared: {
    getOrInit<T>(key: string, init: () => T): T;
    get<T>(key: string): T | undefined;
  };
  diagnostics: {
    warn(d: DocxDiagnosticInput): void;
    error(d: DocxDiagnosticInput): void;
  };
}

// ── Handler types ───────────────────────────────────────────────────────────

export interface DocxNodeMetaShape {
  inline: boolean;
}

export type DocxNodeHandlerShape = (
  node: PmNode,
  children: XmlNode[],
  ctx: DocxContextShape,
  meta: DocxNodeMetaShape,
) => XmlNode | XmlNode[];

export type DocxMarkHandlerShape = (
  props: DocxRunPropsShape,
  mark: PmMark,
  ctx: DocxContextShape,
) => DocxRunPropsShape;

// ── Unit conversion ─────────────────────────────────────────────────────────

/** 1 inch @ 96 DPI = 96 px = 1440 twips → 15 twips per px. */
export const TWIPS_PER_PX = 15;
/** 1 inch = 914400 EMU; 1 px @ 96 DPI = 9525 EMU. */
export const EMU_PER_PX = 9525;

export function pxToTwips(px: number): number {
  return Math.round(px * TWIPS_PER_PX);
}

export function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}
