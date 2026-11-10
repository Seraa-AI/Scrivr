/** Reviewer-facing names for the attributes a block or image change can touch. */
const ATTR_LABELS: Record<string, string> = {
  level: "Heading level",
  align: "Alignment",
  fontFamily: "Font",
  fontSize: "Font size",
  indent: "Indent",
  textIndent: "First-line indent",
  order: "Start number",
  levelOffset: "List indent",
  wrapMode: "Text wrapping",
  xAlign: "Horizontal alignment",
  x: "Horizontal position",
  yOffset: "Vertical offset",
  floatOffset: "Offset",
  width: "Width",
  height: "Height",
};

const ALIGN_LABELS: Record<string, string> = { left: "Left", center: "Center", right: "Right", justify: "Justify" };

/** Bookkeeping, not something a reviewer changes. */
const UNREVIEWED = new Set(["nodeId", "dataTracked"]);

function valueLabel(key: string, value: unknown): string {
  if (key === "level") return value == null ? "Paragraph" : `Heading ${String(value)}`;
  if (value == null) return "default";
  if (key === "align") return ALIGN_LABELS[String(value)] ?? String(value);
  if (Array.isArray(value)) return value.map((item) => valueLabel("", item)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value).map(([name, inner]) => `${name} ${valueLabel(name, inner)}`).join(", ");
  }
  return String(value);
}

/**
 * The attributes a reviewer would see changed: compared by content, so an
 * equal object written anew is unchanged, and a missing value is the same as
 * `null`. Ids and tracking records are bookkeeping and never listed.
 */
export function changedAttrKeys(oldAttrs: Record<string, unknown>, newAttrs: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(oldAttrs), ...Object.keys(newAttrs)]);
  return [...keys].filter((key) =>
    !UNREVIEWED.has(key) && JSON.stringify(oldAttrs[key] ?? null) !== JSON.stringify(newAttrs[key] ?? null));
}

/**
 * What an attribute change does, as a reviewer reads it: each attribute whose
 * value differs, named, with its old and new value — "Heading level: Heading 1
 * → Heading 2 · Alignment: Left → Center", over `changedAttrKeys`. Empty when
 * nothing a reviewer changes differs.
 */
export function describeAttrChanges(oldAttrs: Record<string, unknown>, newAttrs: Record<string, unknown>): string {
  return changedAttrKeys(oldAttrs, newAttrs)
    .map((key) => `${ATTR_LABELS[key] ?? key}: ${valueLabel(key, oldAttrs[key])} → ${valueLabel(key, newAttrs[key])}`)
    .join(" · ");
}
