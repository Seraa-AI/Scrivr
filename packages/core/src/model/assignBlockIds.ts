/**
 * Pure block-ID assignment. Walks a ProseMirror doc and stamps a stable
 * `nodeId` onto every block whose schema declares the attr but whose
 * current value is `null`. Returns the same node reference when nothing
 * needed assignment, so callers can detect a no-op cheaply.
 *
 * This is the core of UniqueId. The plugin form (which fires on every
 * transaction inside an editor) is a thin wrapper around this function —
 * the same logic is also reachable from ingestion-time normalization
 * (`normalizeDocument`) so server-side and AI workflows are guaranteed
 * to receive a fully-ID'd doc without materialising an `EditorState`.
 *
 * Schema contract: block node specs that want IDs must declare
 * `nodeId: { default: null }` in their attrs (Paragraph, Heading,
 * ListItem, CodeBlock, Image all do this today).
 *
 * @example
 *   const safe = assignBlockIds(schema.nodeFromJSON(savedJson));
 *   const state = EditorState.create({ schema, doc: safe });
 */
import { Fragment, type Node } from "prosemirror-model";

export interface AssignBlockIdsOptions {
  /** Override the ID source. Defaults to `crypto.randomUUID()`. */
  generate?: () => string;
}

export function assignBlockIds(
  doc: Node,
  options: AssignBlockIdsOptions = {},
): Node {
  const generate = options.generate ?? defaultGenerate;
  return walk(doc, generate);
}

function defaultGenerate(): string {
  return crypto.randomUUID();
}

function walk(node: Node, generate: () => string): Node {
  // Leaves (text, atomic images) have no children — only consider their
  // own attrs. Avoids attempting `type.create(..., fragment)` on a node
  // type that does not accept content.
  if (node.isLeaf) {
    if (needsBlockId(node)) {
      return node.type.create(
        { ...node.attrs, nodeId: generate() },
        null,
        node.marks,
      );
    }
    return node;
  }

  let childChanged = false;
  const newChildren: Node[] = [];
  node.forEach((child) => {
    const walked = walk(child, generate);
    if (walked !== child) childChanged = true;
    newChildren.push(walked);
  });

  const needsId = needsBlockId(node);
  if (!needsId && !childChanged) return node;

  const attrs = needsId
    ? { ...node.attrs, nodeId: generate() }
    : node.attrs;
  const content = childChanged
    ? Fragment.fromArray(newChildren)
    : node.content;
  return node.type.create(attrs, content, node.marks);
}

function needsBlockId(node: Node): boolean {
  if (!node.isBlock) return false;
  const attrs = node.type.spec.attrs;
  if (!attrs || !("nodeId" in attrs)) return false;
  return node.attrs["nodeId"] === null;
}

/**
 * A single block waiting for an ID, returned by `planBlockIdAssignments`.
 * Absolute ProseMirror position + the full attrs object the plugin should
 * write back via `tr.setNodeMarkup(pos, undefined, attrs)`.
 */
export interface BlockIdAssignment {
  pos: number;
  attrs: Record<string, unknown>;
}

/**
 * Companion to `assignBlockIds` for the transaction-level path (the
 * `UniqueId` plugin). Returns one entry per block that needs an ID, so
 * the caller can emit one `setNodeMarkup` step per block instead of a
 * single whole-doc replace — better grain for history and collab.
 *
 * Both functions share the same `needsBlockId` predicate, so the rule
 * for "which blocks get IDs?" lives in exactly one place.
 */
export function planBlockIdAssignments(
  doc: Node,
  options: AssignBlockIdsOptions = {},
): BlockIdAssignment[] {
  const generate = options.generate ?? defaultGenerate;
  const out: BlockIdAssignment[] = [];
  doc.descendants((node, pos) => {
    if (needsBlockId(node)) {
      out.push({ pos, attrs: { ...node.attrs, nodeId: generate() } });
    }
    return true;
  });
  return out;
}
