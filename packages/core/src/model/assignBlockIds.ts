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
import { Fragment, type Node, type Mark, type Attrs } from "prosemirror-model";

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

/** Result of `recloneDocumentIds`: the fresh-id doc plus the old→new mapping. */
export interface RecloneResult {
  /** A new document with re-minted `nodeId`s. The source is never mutated. */
  doc: Node;
  /**
   * old nodeId → new nodeId, one entry per node/mark that was actually
   * re-keyed. Ids left untouched (null, or filtered out by `shouldReclone`)
   * are absent. When `generate` is custom, values are whatever it returned.
   */
  idMap: CloneIdMap;
}

/** A clone map with an unambiguous lookup for a specific node/mark type. */
export interface CloneIdMap extends ReadonlyMap<string, string> {
  /**
   * Resolve an id for one exact carrier type. Unlike `get(oldId)`, this remains
   * unambiguous if custom schemas reuse the same source string in different id
   * spaces. `kind` defaults to `"node"`.
   */
  getByType(oldId: string, typeName: string, kind?: CloneIdKind): string | undefined;
}

export type CloneIdKind = "node" | "mark" | "custom";

/** What carries the id being re-keyed, passed to `generate` / `shouldReclone`. */
export interface RecloneIdContext {
  /** The existing id being replaced. */
  oldId: string;
  /** Whether the id lives on a node's attrs or on a mark. */
  kind: "node" | "mark";
  /** Node or mark type name, e.g. "paragraph", "image", "comment". */
  typeName: string;
}

/** Generator context for an id space owned by an extension clone handler. */
export interface CustomCloneIdContext {
  oldId: string;
  kind: "custom";
  typeName: string;
}

export type CloneGenerateContext = RecloneIdContext | CustomCloneIdContext;

export interface RecloneOptions {
  /**
   * Produce the replacement id for a re-keyed node/mark. Receives the old id +
   * carrier so callers can derive a custom id (e.g. `"v2-" + oldId`) or map to
   * an externally-chosen id. Extension-owned ids use `kind: "custom"` when
   * their clone handler calls `newId(typeName, oldId)`. Defaults to
   * `crypto.randomUUID()`.
   */
  generate?: (ctx: CloneGenerateContext) => string;
  /**
   * Decide whether a given id-bearing node/mark should be re-keyed. Return
   * false to leave its id untouched and out of the map — e.g. re-key only
   * paragraphs with `({ typeName }) => typeName === "paragraph"`. Defaults to
   * re-keying every node/mark that carries a non-null `nodeId`.
   */
  shouldReclone?: (ctx: RecloneIdContext) => boolean;
}

/**
 * Clones a document into an independent id space: re-mints the `nodeId` on
 * every node AND mark that carries one, and returns the old→new map so callers
 * can remap references held OUTSIDE the doc (comment stores, citation indexes,
 * semantic chunk tables) onto the clone. The source doc is never mutated.
 *
 * Schema-driven and extension-agnostic: any node (block or inline) or mark
 * whose spec declares a `nodeId` attr is covered — custom nodes/marks included,
 * no per-type wiring. `generate` and `shouldReclone` let callers control the
 * new ids and restrict which types get re-keyed (and so appear in the map).
 *
 * Pure re-key: only non-null ids change; nulls are left as-is. Other id spaces
 * (tracked-change `id`, `referenceId`, `moveNodeId`) are self-contained within
 * the doc and pass through untouched — nothing outside references them by value.
 *
 * Unlike the load-time read path (which never fabricates ids), a clone is an
 * intentional new document, so minting here is correct.
 */
export function recloneDocumentIds(
  doc: Node,
  options: RecloneOptions = {},
): RecloneResult {
  const generate: Generate = options.generate ?? (() => defaultGenerate());
  const shouldReclone: ShouldReclone = options.shouldReclone ?? (() => true);
  const idMap = new CloneIdMapImpl();
  return { doc: recloneWalk(doc, generate, shouldReclone, idMap), idMap };
}

type Generate = (ctx: CloneGenerateContext) => string;
type ShouldReclone = (ctx: RecloneIdContext) => boolean;

class CloneIdMapImpl extends Map<string, string> implements CloneIdMap {
  private readonly typed = new Map<string, string>();
  private readonly newIdOwners = new Map<string, string>();

  getByType(oldId: string, typeName: string, kind: CloneIdKind = "node"): string | undefined {
    return this.typed.get(typedIdKey({ oldId, typeName, kind }));
  }

  record(ctx: { oldId: string; typeName: string; kind: CloneIdKind }, newId: string): void {
    const key = typedIdKey(ctx);
    const owner = this.newIdOwners.get(newId);
    if (owner !== undefined && owner !== key) {
      throw new Error(`[recloneDocumentIds] generate() returned duplicate id "${newId}"`);
    }
    this.newIdOwners.set(newId, key);
    this.typed.set(key, newId);
    // Preserve the original Map API for documents whose IDs are globally
    // unique. First-write wins when a custom schema reuses a source string;
    // callers in that situation should use getByType().
    if (!this.has(ctx.oldId)) this.set(ctx.oldId, newId);
  }
}

function typedIdKey(ctx: { oldId: string; typeName: string; kind: CloneIdKind }): string {
  return `${ctx.kind}\u0000${ctx.typeName}\u0000${ctx.oldId}`;
}

/** @internal Used by BaseEditor to expose typed custom-extension mappings. */
export function recordCustomCloneId(
  idMap: CloneIdMap,
  typeName: string,
  oldId: string,
  newId: string,
): void {
  if (!(idMap instanceof CloneIdMapImpl)) {
    throw new TypeError("[recordCustomCloneId] idMap was not created by recloneDocumentIds");
  }
  if (!typeName || !oldId || !newId) {
    throw new TypeError("[recordCustomCloneId] typeName, oldId, and newId must be non-empty strings");
  }
  if (oldId === newId) {
    throw new Error("[recordCustomCloneId] a cloned id must differ from its source id");
  }
  idMap.record({ kind: "custom", typeName, oldId }, newId);
}

function generateValidId(generate: Generate, ctx: RecloneIdContext): string {
  const newId = generate(ctx);
  if (typeof newId !== "string" || newId.length === 0) {
    throw new TypeError(`[recloneDocumentIds] generate() returned an empty or non-string id for ${ctx.kind} "${ctx.typeName}"`);
  }
  if (newId === ctx.oldId) {
    throw new Error(`[recloneDocumentIds] generate() returned the unchanged id for ${ctx.kind} "${ctx.typeName}"`);
  }
  return newId;
}

function recloneWalk(
  node: Node,
  generate: Generate,
  shouldReclone: ShouldReclone,
  idMap: CloneIdMapImpl,
): Node {
  const marks = recloneMarks(node, generate, shouldReclone, idMap);

  // Text nodes never carry a nodeId attr; only their marks can be re-keyed, and
  // text nodes must be copied via `.mark()`, not `type.create`.
  if (node.isText) {
    return marks === node.marks ? node : node.mark(marks);
  }

  const content = node.isLeaf
    ? node.content
    : Fragment.fromArray(recloneChildren(node, generate, shouldReclone, idMap));
  const attrs = recloneAttrs(node, generate, shouldReclone, idMap);
  return node.type.create(attrs, content, marks);
}

function recloneChildren(
  node: Node,
  generate: Generate,
  shouldReclone: ShouldReclone,
  idMap: CloneIdMapImpl,
): Node[] {
  const out: Node[] = [];
  node.forEach((child) => out.push(recloneWalk(child, generate, shouldReclone, idMap)));
  return out;
}

/** Re-key a node's own `nodeId` attr if its spec declares one and it's set. */
function recloneAttrs(
  node: Node,
  generate: Generate,
  shouldReclone: ShouldReclone,
  idMap: CloneIdMapImpl,
): Attrs {
  if (!declaresNodeId(node.type.spec.attrs)) return node.attrs;
  const oldId = node.attrs["nodeId"];
  if (typeof oldId !== "string" || oldId.length === 0) return node.attrs;
  const ctx: RecloneIdContext = { oldId, kind: "node", typeName: node.type.name };
  if (!shouldReclone(ctx)) return node.attrs;
  // The same logical id can occur more than once (most commonly when a mark
  // is split across adjacent text nodes). Reuse its first replacement so the
  // clone preserves that identity and the returned map remains truthful.
  const newId = idMap.getByType(oldId, node.type.name, "node") ?? generateValidId(generate, ctx);
  idMap.record(ctx, newId);
  return { ...node.attrs, nodeId: newId };
}

/** Re-key any of a node's marks that carry a `nodeId` (e.g. custom markers). */
function recloneMarks(
  node: Node,
  generate: Generate,
  shouldReclone: ShouldReclone,
  idMap: CloneIdMapImpl,
): readonly Mark[] {
  let changed = false;
  const next = node.marks.map((mark) => {
    if (!declaresNodeId(mark.type.spec.attrs)) return mark;
    const oldId = mark.attrs["nodeId"];
    if (typeof oldId !== "string" || oldId.length === 0) return mark;
    const ctx: RecloneIdContext = { oldId, kind: "mark", typeName: mark.type.name };
    if (!shouldReclone(ctx)) return mark;
    const newId = idMap.getByType(oldId, mark.type.name, "mark") ?? generateValidId(generate, ctx);
    idMap.record(ctx, newId);
    changed = true;
    return mark.type.create({ ...mark.attrs, nodeId: newId });
  });
  return changed ? next : node.marks;
}

/** Whether a node/mark spec's attrs declare a `nodeId`. */
function declaresNodeId(attrs: Record<string, unknown> | null | undefined): boolean {
  return !!attrs && "nodeId" in attrs;
}
