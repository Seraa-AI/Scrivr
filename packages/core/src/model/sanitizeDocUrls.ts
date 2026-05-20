/**
 * Post-parse URL allow-list sweep for raw ProseMirror JSON documents.
 *
 * The `parseDOM` gate on Link / Image catches URLs from HTML paste, and
 * the command gates catch programmatic inserts. But the editor accepts
 * raw PM JSON via `schema.nodeFromJSON` (`new Editor({ content: json })`,
 * `ServerEditor.setContent(json)`, AI-generated structured inserts,
 * future collab snapshots). That path bypasses both gates — a saved doc
 * on disk with `link.attrs.href = "javascript:..."` would round-trip
 * unchanged through the editor and out the other side.
 *
 * This walker enforces the same allow-list as the ingestion gates, at
 * the moment a constructed PM doc lands in editor state. Same semantic
 * as `parseDOM` returning false: an image with an unsafe `src` is
 * dropped entirely; a link mark with an unsafe `href` is stripped from
 * its span while the text content survives.
 *
 * Cheap idempotent fast-path: a clean doc returns the same Node
 * reference, no allocation. Walks only as deep as needed to rebuild
 * subtrees that actually changed.
 *
 * @example
 *   const doc = schema.nodeFromJSON(savedJson);
 *   const safe = sanitizeDocUrls(doc, schema);
 *   const state = EditorState.create({ schema, doc: safe });
 */
import type { Mark, Node, Schema } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import { safeUrl } from "./safeUrl";

/**
 * Built-in nodes that carry URL attrs which must pass safeUrl. Extensions
 * with custom URL attrs aren't covered here — they should either validate
 * at command-handler time (preferred) or post-process via this same helper
 * with a custom allow-list (future API: an extension lane that lets
 * extensions register URL attrs centrally).
 */
const NODE_URL_ATTRS = new Map<string, readonly string[]>([
  ["image", ["src"]],
]);

const MARK_URL_ATTRS = new Map<string, readonly string[]>([
  ["link", ["href"]],
]);

export function sanitizeDocUrls(doc: Node, _schema: Schema): Node {
  // The root doc never has URL attrs of its own and can't be "dropped"
  // upward, so we always return it (walkNode handles its children).
  const walked = walkNode(doc);
  return walked ?? doc;
}

/**
 * Walk one node. Returns:
 *   - the same node reference if nothing changed (fast path)
 *   - a rebuilt node with cleaned children/marks if a descendant changed
 *   - null if the node itself fails the URL gate and must be dropped from
 *     its parent's content (only happens for image-shaped nodes today)
 */
function walkNode(node: Node): Node | null {
  // 1. Check this node's own URL attrs.
  const nodeAttrKeys = NODE_URL_ATTRS.get(node.type.name);
  if (nodeAttrKeys) {
    for (const key of nodeAttrKeys) {
      if (safeUrl(node.attrs[key]) === null) {
        return null;
      }
    }
  }

  // 2. Text nodes carry marks, never children — filter marks and return.
  if (node.isText) {
    const cleanMarks = filterUnsafeMarks(node.marks);
    return cleanMarks === node.marks ? node : node.mark(cleanMarks);
  }

  // 3. Non-text node — recurse into children.
  let changed = false;
  const newChildren: Node[] = [];
  node.forEach((child) => {
    const walked = walkNode(child);
    if (walked === null) {
      changed = true;
    } else {
      if (walked !== child) changed = true;
      newChildren.push(walked);
    }
  });

  if (!changed) return node;
  // Rebuild with cleaned children. If the schema rejects the result
  // (e.g. a content expression that requires at least one child but we
  // dropped them all), we surface the error rather than silently
  // returning corrupt state.
  return node.copy(Fragment.fromArray(newChildren));
}

function filterUnsafeMarks(marks: readonly Mark[]): readonly Mark[] {
  // Two-pass to preserve referential equality on the fast path: scan
  // first, allocate only if any mark is unsafe.
  if (!marks.some(isMarkUnsafe)) return marks;
  return marks.filter((m) => !isMarkUnsafe(m));
}

function isMarkUnsafe(mark: Mark): boolean {
  const keys = MARK_URL_ATTRS.get(mark.type.name);
  if (!keys) return false;
  for (const key of keys) {
    if (safeUrl(mark.attrs[key]) === null) return true;
  }
  return false;
}
