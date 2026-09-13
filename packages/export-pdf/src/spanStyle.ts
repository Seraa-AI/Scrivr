import { compositeColor, parseCssColor, safeUrl, type PdfSpanStyle } from "@scrivr/core";
import { rgb, type RGB } from "pdf-lib";

/** Renderer-owned values. Invalid declarations never reach drawing helpers. */
export interface ResolvedPdfSpanStyle {
  color?: RGB;
  defaultColor?: RGB;
  underline: boolean;
  underlineColor?: RGB;
  strikethrough: boolean;
  backgroundColor?: { color: RGB; opacity: number };
  link?: string;
}

/** Schemes a viewer can act on with no base URL to resolve against. */
const FOLLOWABLE_TARGET = /^(?:https?|mailto|tel):/i;

/**
 * A target worth making clickable. Safety is `safeUrl`, the gate ingestion
 * already applies, so there is one answer to "is this URL safe" rather than
 * one per sink. Followability is a separate question it does not answer: a
 * downloaded file has no base URL, and a hit area over text that goes nowhere
 * is worse than text that never promised to.
 */
function parseLink(value: unknown): string | undefined {
  const url = safeUrl(value);
  return url !== null && FOLLOWABLE_TARGET.test(url) ? url : undefined;
}

function parseFill(value: unknown): { color: RGB; opacity: number } | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = parseCssColor(value);
  if (!parsed) return undefined;
  return {
    color: rgb(parsed.r / 255, parsed.g / 255, parsed.b / 255),
    opacity: parsed.alpha,
  };
}

function parseTextColor(value: unknown): RGB | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = parseCssColor(value);
  if (!parsed) return undefined;
  const opaque = compositeColor(parsed, { r: 255, g: 255, b: 255 });
  return rgb(opaque.r / 255, opaque.g / 255, opaque.b / 255);
}

/**
 * Cross the extension → renderer boundary once per mark. Unsupported colour
 * literals contribute no colour, preserving earlier declarations and theme
 * defaults. An invalid explicit opacity drops only that background.
 */
export function resolvePdfSpanStyle(style: PdfSpanStyle): ResolvedPdfSpanStyle {
  const color = parseTextColor(style.color);
  const defaultColor = parseTextColor(style.defaultColor);
  const underlineColor = parseTextColor(style.underlineColor);
  let backgroundColor = parseFill(style.backgroundColor?.color);
  const opacity = style.backgroundColor?.opacity;
  if (backgroundColor && opacity !== undefined) {
    backgroundColor = Number.isFinite(opacity) && opacity >= 0 && opacity <= 1
      ? { ...backgroundColor, opacity }
      : undefined;
  }
  const link = parseLink(style.link);
  return {
    ...(color ? { color } : {}),
    ...(link ? { link } : {}),
    ...(defaultColor ? { defaultColor } : {}),
    ...(underlineColor ? { underlineColor } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    underline: style.underline === true,
    strikethrough: style.strikethrough === true,
  };
}
