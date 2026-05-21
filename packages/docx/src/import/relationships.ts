/**
 * Read `word/_rels/document.xml.rels` and resolve image relationships to
 * media filenames. The `<a:blip r:embed="rId5"/>` inside a drawing
 * references a `<Relationship Id="rId5" Target="media/image1.png"/>`.
 *
 * Hyperlink rels (`Type="...hyperlink"`) are kept too — the future link
 * import milestone will read them via the same map.
 */

import { parseOoxml, findChildren, attr, type OoxmlElement } from "./xml";

const REL_TYPE_IMAGE_SUFFIX = "/relationships/image";
const REL_TYPE_HYPERLINK_SUFFIX = "/relationships/hyperlink";

export interface RelationshipEntry {
  id: string;
  type: "image" | "hyperlink" | "other";
  /** Path inside the package — for images, usually `media/imageN.png`. */
  target: string;
  /** `"External"` for hyperlinks; absent for internal refs. */
  targetMode?: string;
}

export interface RelationshipMap {
  /** Look up a single relationship by Id. */
  get(id: string): RelationshipEntry | undefined;
  /** All entries (for debugging / future link parsing). */
  list(): RelationshipEntry[];
}

export function readRelationshipMap(xml: string | undefined): RelationshipMap {
  if (!xml) return emptyMap();
  const root = parseOoxml(xml);
  if (!root || root.name !== "Relationships") return emptyMap();

  const entries = new Map<string, RelationshipEntry>();
  for (const rel of findChildren(root, "Relationship")) {
    const id = attr(rel, "Id");
    const type = attr(rel, "Type");
    const target = attr(rel, "Target");
    if (!id || !type || !target) continue;
    entries.set(id, {
      id,
      type: classify(type),
      target,
      ...(attr(rel, "TargetMode") ? { targetMode: attr(rel, "TargetMode")! } : {}),
    });
  }

  return {
    get(id) { return entries.get(id); },
    list() { return Array.from(entries.values()); },
  };
}

function classify(typeUri: string): RelationshipEntry["type"] {
  if (typeUri.endsWith(REL_TYPE_IMAGE_SUFFIX)) return "image";
  if (typeUri.endsWith(REL_TYPE_HYPERLINK_SUFFIX)) return "hyperlink";
  return "other";
}

function emptyMap(): RelationshipMap {
  return {
    get: () => undefined,
    list: () => [],
  };
}
