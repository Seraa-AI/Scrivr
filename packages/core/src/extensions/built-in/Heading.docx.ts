/**
 * DOCX export contribution for the `heading` node.
 *
 * Reads the canonical `HEADING_LEVEL_SPEC` (size + spaceBefore + spaceAfter
 * in pixels) and emits paragraph styles `Heading1`..`Heading6` with the
 * same intent the canvas renders — converting `px → twips` (1 px @ 96 DPI =
 * 15 twips) at this boundary so the spec stays in one place.
 *
 * Uses LOCAL structural types instead of importing from @scrivr/export-docx
 * so the dependency direction stays one-way (export-docx → core). See
 * Image.docx.ts for the same pattern + rationale.
 */

import type { Node as PmNode } from "prosemirror-model";
import { HEADING_LEVEL_SPEC, type HeadingLevel } from "./Heading";

// ── Local structural types ──────────────────────────────────────────────────

type XmlAttrs = Record<string, string>;

interface XmlNode {
  name: string;
  attributes?: XmlAttrs;
  children?: Array<XmlNode | string>;
}

interface DocxStyleSpecShape {
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

interface DocxContextShape {
  styles: {
    paragraph: { getOrCreate(name: string, spec: DocxStyleSpecShape): string };
  };
}

type HeadingNodeHandler = (
  node: PmNode,
  children: XmlNode[],
  ctx: DocxContextShape,
  meta: { inline: boolean },
) => XmlNode;

// ── Unit conversion ─────────────────────────────────────────────────────────

const TWIPS_PER_PX = 15; // 1 inch = 96 px = 1440 twips → 15 twips per px.

function pxToTwips(px: number): number {
  return Math.round(px * TWIPS_PER_PX);
}

// ── XmlNode builder (local clone of xml() in @scrivr/export-docx) ───────────

function el(name: string, attrs?: XmlAttrs, children?: Array<XmlNode | string>): XmlNode {
  const node: XmlNode = { name };
  if (attrs && Object.keys(attrs).length > 0) node.attributes = attrs;
  if (children && children.length > 0) node.children = children;
  return node;
}

// ── Handler ─────────────────────────────────────────────────────────────────

function readLevel(raw: unknown, allowed: readonly HeadingLevel[]): HeadingLevel {
  if (typeof raw === "number") {
    const level = raw as HeadingLevel;
    if (allowed.includes(level)) return level;
  }
  return allowed[0] ?? 1;
}

function buildHeadingHandler(levels: readonly HeadingLevel[]): HeadingNodeHandler {
  return (node, children, ctx) => {
    const level = readLevel(node.attrs["level"], levels);
    const spec = HEADING_LEVEL_SPEC[level];
    const styleId = ctx.styles.paragraph.getOrCreate(`Heading ${level}`, {
      bold: true,
      size: spec?.size ?? 14,
      spacingBefore: spec ? pxToTwips(spec.spaceBefore) : 0,
      spacingAfter: spec ? pxToTwips(spec.spaceAfter) : 0,
    });
    return el("w:p", undefined, [
      el("w:pPr", undefined, [el("w:pStyle", { "w:val": styleId })]),
      ...children,
    ]);
  };
}

// ── Public contribution ─────────────────────────────────────────────────────

export function headingDocxContribution(levels: readonly HeadingLevel[]) {
  return {
    nodes: {
      heading: buildHeadingHandler(levels),
    },
  };
}
