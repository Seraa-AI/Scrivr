/**
 * What each tracked record means to an agent reading the semantic lane. The
 * walker places what these return; this decides what they say.
 *
 * Records come from saved and synced documents, so every field is read through
 * a check of its type rather than trusted.
 */
import { describeInlineMark, isTrackedMark, semanticImage } from "@scrivr/core";
import type { SemanticChange, SemanticMarkHandler, SemanticNodeChange, UnitCtx } from "@scrivr/core";
import { EditorState } from "@scrivr/core/pm";
import type { Mark, Node as PMNode } from "@scrivr/core/pm";

import { findChanges } from "./findChanges";
import { getBlockInlineTrackedData, isTrackedRecord, isValidTrackableMark, markRecords } from "./helpers";
import { changeActs } from "./reviewPlan";
import { CHANGE_OPERATION, CHANGE_STATUS, type TrackedAttrs } from "./types";

type TrackedRecord = Partial<TrackedAttrs>;

const textOf = (value: unknown) => (typeof value === "string" ? value : undefined);
const numberOf = (value: unknown) => (typeof value === "number" ? value : undefined);
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPending = (record: TrackedRecord) => record.status === CHANGE_STATUS.pending;

/** A formatting mark is only ever added or removed. */
const FORMATTING_OPERATIONS: ReadonlySet<CHANGE_OPERATION | undefined> = new Set([CHANGE_OPERATION.insert, CHANGE_OPERATION.delete]);

const actIdsByDoc = new WeakMap<PMNode, ReadonlyMap<string, string>>();

/**
 * Each pending record's act, named by its primary record: the id
 * `reviewChanges` decides the act by. Grouped over the pending changes, as the
 * review plan groups them, so the reader and the decider agree.
 */
function actIds(doc: PMNode): ReadonlyMap<string, string> {
  const cached = actIdsByDoc.get(doc);
  if (cached) return cached;
  const ids = new Map<string, string>();
  for (const { primary, records } of changeActs(findChanges(EditorState.create({ doc })).pending)) {
    for (const record of records) ids.set(record.id, primary.id);
  }
  actIdsByDoc.set(doc, ids);
  return ids;
}

function describe(type: SemanticChange["type"], text: string, record: TrackedRecord, ctx: UnitCtx): SemanticChange {
  const recordId = textOf(record.id);
  const id = recordId === undefined ? undefined : actIds(ctx.doc).get(recordId) ?? recordId;
  const authorId = textOf(record.authorID);
  const status = textOf(record.status);
  const createdAt = numberOf(record.createdAt);
  const groupId = textOf(record.groupId);
  const moveId = textOf(record.moveId) ?? textOf(record.moveNodeId);
  return {
    type,
    text,
    ...(id !== undefined ? { id } : {}),
    ...(authorId !== undefined ? { authorId } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
    ...(moveId !== undefined ? { moveId } : {}),
  };
}

/**
 * A review mark's pending records. A mark with no records at all still stands
 * for one change, as documents written before records existed carry them; one
 * whose records are all decided stands for none.
 */
const reviewRecords = (mark: Mark): TrackedRecord[] => {
  const records = markRecords(mark);
  return records.length > 0 ? records.filter(isPending) : [{}];
};

/** Inserted text stays in the proposed text, and is reported as proposed. */
export const keepInserted: SemanticMarkHandler = (run, mark, ctx) => ({
  text: run.text,
  changes: [...(run.changes ?? []), ...reviewRecords(mark).map((r) => describe("suggestedInsert", run.text, r, ctx))],
});

/**
 * Deleted text leaves the proposed text, and is kept as the change that removes
 * it. A deletion whose records are all decided proposes nothing, so its text
 * stays and nothing is reported. A mark with no records at all, as documents
 * written before records existed carry, still reads as one deletion.
 */
export const dropDeleted: SemanticMarkHandler = (run, mark, ctx) => {
  const records = reviewRecords(mark);
  if (records.length === 0) return run;
  return {
    text: "",
    changes: [...(run.changes ?? []), ...records.map((r) => describe("suggestedDelete", run.text, r, ctx))],
  };
};

const hasPending = (mark: Mark, operation: CHANGE_OPERATION) =>
  markRecords(mark).some((record) => record.operation === operation && isPending(record));

/** A formatting mark proposed for removal is left off the proposed text. */
export const isMarkRemoved = (mark: Mark): boolean =>
  isValidTrackableMark(mark) && hasPending(mark, CHANGE_OPERATION.delete);

/**
 * A node type a block could have been instead of this one: never text, and the
 * same kind of node — block or inline, leaf or not — with every attr it
 * requires given. A synced record may name anything.
 */
function formerType(node: PMNode, name: string | undefined, attrs: Record<string, unknown>) {
  const type = name !== undefined ? node.type.schema.nodes[name] : undefined;
  const fits = !!type && !type.isText && type.isBlock === node.type.isBlock && type.isLeaf === node.type.isLeaf &&
    Object.entries(type.spec.attrs ?? {}).every(([key, spec]) => "default" in spec || key in attrs);
  return type && fits ? type : node.type;
}

/** The block as it was before an attribute change, in the vocabulary of `attrsOf`. */
function formerAttrs(node: PMNode, record: TrackedRecord, ctx: UnitCtx): Record<string, unknown> {
  const oldAttrs = "oldAttrs" in record && isPlainRecord(record.oldAttrs) ? record.oldAttrs : {};
  const oldType = formerType(node, "oldNodeTypeName" in record ? textOf(record.oldNodeTypeName) : undefined, oldAttrs);
  // The node's own attrs fill what the record leaves out, so a required one is never missing.
  const former = oldType.create(oldType === node.type ? { ...node.attrs, ...oldAttrs } : oldAttrs);
  const level = former.attrs["level"];
  return {
    ...(ctx.attrsOf(former) ?? {}),
    // `attrsOf` leaves level out as structure; here it is what changed.
    ...(typeof level === "number" ? { level } : {}),
    ...(oldType !== node.type ? { nodeType: oldType.name } : {}),
  };
}

/** The list types a block sat in before a list change, outermost first; malformed entries are skipped. */
const listTypes = (record: TrackedRecord): string[] => {
  const oldList: unknown = "oldList" in record ? record.oldList : undefined;
  return Array.isArray(oldList)
    ? oldList.flatMap((level: unknown) => (isPlainRecord(level) ? textOf(level["type"]) ?? [] : []))
    : [];
};

/** What an inserted or deleted node adds or removes, beyond its text. */
const objectOf = (node: PMNode) => {
  const image = semanticImage(node);
  return image ? { image } : {};
};

const insertion = (node: PMNode, record: TrackedRecord, ctx: UnitCtx): SemanticNodeChange =>
  ({ change: { ...describe("suggestedInsert", "", record, ctx), ...objectOf(node) }, place: "covers" });

type NodeReading = (node: PMNode, record: TrackedRecord, ctx: UnitCtx) => SemanticNodeChange;

/**
 * How each node operation reads. A map, not an object: a synced record may
 * name any operation, "toString" included, which an object lookup finds on its
 * prototype. Operations not listed (`node_split`) are read through another
 * record of their act.
 */
const NODE_CHANGES = new Map<string, NodeReading>([
  [CHANGE_OPERATION.insert, insertion],
  [CHANGE_OPERATION.move, insertion],
  // A container added around content, which is inserted with it.
  [CHANGE_OPERATION.wrap_with_node, insertion],
  // A block's copy at the place a structural change moved it to.
  [CHANGE_OPERATION.structure, insertion],
  [CHANGE_OPERATION.delete, (node, r, ctx) =>
    ({ change: { ...describe("suggestedDelete", "", r, ctx), ...objectOf(node) }, place: "covers" })],
  [CHANGE_OPERATION.node_join, (_node, r, ctx) => ({ change: describe("suggestedDelete", "\n", r, ctx), place: "after" })],
  // A split is one act with the reference its first block holds; reported there.
  [CHANGE_OPERATION.reference, (_node, r, ctx) => ({ change: describe("suggestedInsert", "\n", r, ctx), place: "after" })],
  [CHANGE_OPERATION.set_node_attributes, (node, r, ctx) => ({
    change: { ...describe("suggestedAttrs", "", r, ctx), oldAttrs: formerAttrs(node, r, ctx) },
    place: "covers",
  })],
  [CHANGE_OPERATION.list_change, (_node, r, ctx) => ({
    change: { ...describe("suggestedAttrs", "", r, ctx), oldAttrs: { list: listTypes(r) } },
    place: "covers",
  })],
]);

/** A formatting change on text: the marks the text had before it. */
function formattingChanges(node: PMNode, ctx: UnitCtx): SemanticNodeChange[] {
  const formatting = node.marks.filter((mark) => !isTrackedMark(mark.type.name));
  // What the text had before any pending formatting change: without the marks
  // proposed as added. Every change on this text states the same.
  const before = { marks: formatting.filter((m) => !hasPending(m, CHANGE_OPERATION.insert)).map(describeInlineMark) };
  return formatting.filter(isValidTrackableMark).flatMap((mark) =>
    markRecords(mark)
      .filter((record) => isPending(record) && FORMATTING_OPERATIONS.has(record.operation))
      .map((record): SemanticNodeChange => ({ change: { ...describe("suggestedAttrs", "", record, ctx), oldAttrs: before }, place: "covers" })),
  );
}

/** The pending records written on a node itself, or on the formatting of its text. */
export function nodeChanges(node: PMNode, ctx: UnitCtx): SemanticNodeChange[] {
  // Text carries its own records on marks; the review marks are read by the
  // mark handlers, so only its formatting is read here.
  if (node.isText) return formattingChanges(node, ctx);
  return (getBlockInlineTrackedData(node) ?? []).filter(isTrackedRecord).filter(isPending).flatMap((record) => {
    const operation = record.operation;
    const toChange = operation === undefined ? undefined : NODE_CHANGES.get(operation);
    return toChange ? [toChange(node, record, ctx)] : [];
  });
}
