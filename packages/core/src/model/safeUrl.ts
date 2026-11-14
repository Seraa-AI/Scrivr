/**
 * Ingestion-time URL allow-list. Returns the trimmed input when it's safe
 * to store in the document, `null` when it isn't.
 *
 * Use this at every boundary where a URL enters the ProseMirror JSON
 * document — `parseDOM` getAttrs (paste), command handlers (programmatic
 * inserts), and any future ingestion path (collab apply, AI suggestion
 * accept). The load-bearing invariant is **storage-safe forever**: the
 * value that ends up in `mark.attrs.href` or `node.attrs.src` must be
 * safe to render through any current or future surface (canvas, DOM
 * accessibility mirror, PDF, DOCX, exports).
 *
 * Canvas paint can't execute a `javascript:` href today, but a future
 * DOM-shaped target will. Validating at ingestion means the document is
 * safe by construction; render-side targets don't have to re-validate.
 *
 * ## Allow-list
 *
 * - **`http:` / `https:`** — standard web URLs
 * - **`mailto:`** — email links
 * - **`tel:`** — phone links
 * - **Fragment-only** (`#anchor`) — in-page anchors
 * - **Relative** (`./foo`, `/foo`, `foo.html`, `//cdn`) — no scheme, no risk
 *
 * Anything else returns `null`. Apps that genuinely need `s3://` or
 * other custom schemes wrap this helper with their own allow-list.
 *
 * ## Defences
 *
 * - Strips ASCII control characters (`\x00`–`\x1F`, `\x7F`) before
 *   validating — defeats the classic `"java\x00script:"` obfuscation
 *   where a NUL hides the dangerous scheme from a naive prefix check.
 * - Trims surrounding whitespace.
 * - Case-insensitive scheme match (per RFC 3986).
 * - Defensive against non-string input (returns `null`) so callers
 *   reading from `unknown`-typed sources (collab apply, parseDOM
 *   attribute getters) can pass the value straight through without
 *   their own type guard.
 *
 * Does NOT normalise tracking params, fragments, percent-encoding, or
 * casing in the host/path — this is a security gate, not a URL canonicaliser.
 *
 * @example
 *   safeUrl("https://example.com")          // "https://example.com"
 *   safeUrl("javascript:alert(1)")          // null
 *   safeUrl("  JavaScript:alert(1)  ")      // null (trimmed, case-insensitive)
 *   safeUrl("java\x00script:alert(1)")      // null (control chars stripped)
 *   safeUrl("#anchor")                      // "#anchor"
 *   safeUrl("/about")                       // "/about"
 *   safeUrl({ href: "..." })                // null (non-string)
 */
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/** Matches scheme + colon at the start of a URL. RFC 3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":" */
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;

/** ASCII control characters that obfuscation attacks hide inside scheme strings. */
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

/**
 * Inline raster bytes, base64-encoded. `image/svg+xml` is deliberately absent:
 * SVG is a document format that can carry script, so it is the one image media
 * type that would breach safeUrl's storage-safe-forever invariant. Base64 is
 * required rather than merely allowed — it is what every real producer emits
 * (clipboard screenshots, DOCX media parts), and it keeps the payload to an
 * alphabet that cannot smuggle markup.
 */
const RASTER_DATA_URL =
  /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i;

/**
 * The same gate as {@link safeUrl}, plus inline raster `data:` URLs — the form
 * a pasted screenshot and a DOCX-embedded image both arrive in.
 *
 * Use this for image `src` only. Links keep the stricter {@link safeUrl}: a
 * `data:` href navigates, which is a different risk from bytes that only paint.
 */
export function safeImageUrl(value: unknown): string | null {
  const allowed = safeUrl(value);
  if (allowed !== null) return allowed;
  if (typeof value !== "string") return null;

  // Same control-char stripping and trim as safeUrl, so the obfuscation
  // defences hold for this branch too.
  const cleaned = value.replace(CONTROL_CHARS, "").trim();
  return RASTER_DATA_URL.test(cleaned) ? cleaned : null;
}

/** A drawing as an inline PNG or JPEG (prefix case-insensitive). */
const DRAWING_DATA_URL = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/i;

type DrawingFormat = "png" | "jpeg" | "jpg";

/** Each format's canonical media type, and its opening bytes base64-encoded: `\x89PNG\r\n\x1a\n`, and JPEG's `FF D8 FF`. */
const FORMATS: Record<DrawingFormat, { mime: string; opening: string }> = {
  png: { mime: "image/png", opening: "iVBORw0KGgo" },
  jpeg: { mime: "image/jpeg", opening: "/9j/" },
  jpg: { mime: "image/jpeg", opening: "/9j/" },
};

const isDrawingFormat = (format: string): format is DrawingFormat => Object.hasOwn(FORMATS, format);

/** Whether base64 decodes: padded to a whole number of quads, or unpadded and never one character past a whole quad. */
const wholeBase64 = (bytes: string): boolean => (bytes.endsWith("=") ? bytes.length % 4 === 0 : bytes.length % 4 !== 1);

/** The largest drawing a drawn field takes, decoded — a pad's PNG is far smaller; a PDF embeds it whole. */
export const MAX_DRAWING_BYTES = 2 * 1024 * 1024;

/**
 * A drawing for a drawn field that a signed record can carry: an inline PNG
 * or JPEG whose base64 decodes and opens as the format it names, no larger
 * than `MAX_DRAWING_BYTES` — what a PDF can embed, and fixed once given, where
 * a link could change after signing. Returned trimmed, with a canonical
 * prefix (`data:image/png;base64,`, `jpg` as `jpeg`); `null` for anything else.
 */
export function safeDrawingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [, format, bytes] = DRAWING_DATA_URL.exec(value.replace(CONTROL_CHARS, "").trim()) ?? [];
  const name = format?.toLowerCase();
  if (!name || !isDrawingFormat(name) || !bytes) return null;
  const { mime, opening } = FORMATS[name];
  if (!bytes.startsWith(opening) || !wholeBase64(bytes)) return null;
  if (Math.floor((bytes.length * 3) / 4) > MAX_DRAWING_BYTES) return null;
  return `data:${mime};base64,${bytes}`;
}

export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  // Strip control characters BEFORE pattern matching, then trim. The order
  // matters: `"  java\x00script:..."` becomes `"javascript:..."` after this,
  // which the scheme check correctly rejects.
  const cleaned = value.replace(CONTROL_CHARS, "").trim();
  if (cleaned === "") return null;

  // Fragment-only — safe; never has a scheme.
  if (cleaned.startsWith("#")) return cleaned;

  // No scheme present → relative URL (relative path or protocol-relative).
  // Safe by definition: no scheme means no execution context.
  const schemeMatch = cleaned.match(SCHEME_PATTERN);
  if (!schemeMatch) return cleaned;

  // Has a scheme — check the allow-list.
  const scheme = schemeMatch[1]!.toLowerCase();
  if (!ALLOWED_SCHEMES.has(scheme)) return null;

  return cleaned;
}
