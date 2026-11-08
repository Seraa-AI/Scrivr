/**
 * What each tracked record means to an agent reading the semantic lane. The
 * walker places what these return; this decides what they say.
 */
import type { SemanticChange, SemanticMarkHandler, SemanticNodeChange, UnitCtx } from "@scrivr/core";
import type { Node as PMNode } from "@scrivr/core/pm";

import { CHANGE_OPERATION, CHANGE_STATUS } from "./types";

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry => typeof value === "object" && value !== null;

/** A mark's or node's records; a mark with none still stands for one change. */
function entriesOf(raw: unknown): Entry[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const entries = list.filter(isEntry);
  return entries.length > 0 ? entries : [{}];
}

const stringField = (entry: Entry, key: string) => {
  const value = entry[key];
  return typeof value === "string" ? value : undefined;
};

/** Per read: each record id seen so far, and the root it resolved to. */
const rootsByRead = new WeakMap<UnitCtx, Map<string, string>>();

/**
 * The record an act is named by. Pieces of one act — the text a new block was
 * created with, the cells of a deleted row, a deletion later typing split
 * apart, the reference a split leaves — report it, so one act reads as one
 * change. A piece names the record it is part of, which may itself be a piece
 * of an enclosing one; the walker reads a container before its content, so the
 * enclosing record has been resolved by then.
 */
function rootId(entry: Entry, ctx: UnitCtx): string | undefined {
  const id = stringField(entry, "id");
  const partOf = entry["operation"] === CHANGE_OPERATION.reference
    ? stringField(entry, "referenceId")
    : stringField(entry, "creationId") ?? stringField(entry, "deletionId") ?? stringField(entry, "continuesId");
  const roots = rootsByRead.get(ctx) ?? new Map<string, string>();
  rootsByRead.set(ctx, roots);
  const root = partOf !== undefined ? roots.get(partOf) ?? partOf : id;
  if (id !== undefined && root !== undefined) roots.set(id, root);
  return root;
}

function describe(type: SemanticChange["type"], text: string, entry: Entry, ctx: UnitCtx): SemanticChange {
  const id = rootId(entry, ctx);
  const authorId = stringField(entry, "authorID");
  const status = stringField(entry, "status");
  const createdAt = entry["createdAt"];
  const groupId = stringField(entry, "groupId");
  const moveId = stringField(entry, "moveId") ?? stringField(entry, "moveNodeId");
  return {
    type,
    text,
    ...(id !== undefined ? { id } : {}),
    ...(authorId !== undefined ? { authorId } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(typeof createdAt === "number" ? { createdAt } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
    ...(moveId !== undefined ? { moveId } : {}),
  };
}

/** Inserted text stays in the proposed text, and is reported as proposed. */
export const keepInserted: SemanticMarkHandler = (run, mark, ctx) => ({
  text: run.text,
  changes: [...(run.changes ?? []), ...entriesOf(mark.attrs["dataTracked"]).map((e) => describe("suggestedInsert", run.text, e, ctx))],
});

/** Deleted text leaves the proposed text, and is kept as the change that removes it. */
export const dropDeleted: SemanticMarkHandler = (run, mark, ctx) => ({
  text: "",
  changes: [...(run.changes ?? []), ...entriesOf(mark.attrs["dataTracked"]).map((e) => describe("suggestedDelete", run.text, e, ctx))],
});

/** The block as it was before an attribute change, in the vocabulary of `attrsOf`. */
function formerAttrs(node: PMNode, entry: Entry, ctx: UnitCtx): Record<string, unknown> {
  const oldTypeName = stringField(entry, "oldNodeTypeName");
  const oldType = (oldTypeName !== undefined ? ctx.schema.nodes[oldTypeName] : undefined) ?? node.type;
  const oldAttrs = entry["oldAttrs"];
  const former = oldType.create(isEntry(oldAttrs) ? oldAttrs : null);
  const level = former.attrs["level"];
  return {
    ...(ctx.attrsOf(former) ?? {}),
    ...(typeof level === "number" ? { level } : {}),
    ...(oldType !== node.type ? { nodeType: oldType.name } : {}),
  };
}

function listTypes(entry: Entry): string[] {
  const oldList = entry["oldList"];
  return Array.isArray(oldList) ? oldList.filter(isEntry).flatMap((level) => stringField(level, "type") ?? []) : [];
}

const NODE_CHANGES: Partial<Record<string, (node: PMNode, entry: Entry, ctx: UnitCtx) => SemanticNodeChange>> = {
  [CHANGE_OPERATION.insert]: (_node, e, ctx) => ({ change: describe("suggestedInsert", "", e, ctx), place: "covers" }),
  [CHANGE_OPERATION.move]: (_node, e, ctx) => ({ change: describe("suggestedInsert", "", e, ctx), place: "covers" }),
  [CHANGE_OPERATION.delete]: (_node, e, ctx) => ({ change: describe("suggestedDelete", "", e, ctx), place: "covers" }),
  [CHANGE_OPERATION.node_join]: (_node, e, ctx) => ({ change: describe("suggestedDelete", "\n", e, ctx), place: "after" }),
  // A split is reported once, through the reference its first block holds.
  [CHANGE_OPERATION.reference]: (_node, e, ctx) => ({ change: describe("suggestedInsert", "\n", e, ctx), place: "after" }),
  [CHANGE_OPERATION.set_node_attributes]: (node, e, ctx) => ({
    change: { ...describe("suggestedAttrs", "", e, ctx), oldAttrs: formerAttrs(node, e, ctx) },
    place: "covers",
  }),
  [CHANGE_OPERATION.list_change]: (_node, e, ctx) => ({
    change: { ...describe("suggestedAttrs", "", e, ctx), oldAttrs: { list: listTypes(e) } },
    place: "covers",
  }),
};

/** The pending records written on a node itself. */
export function nodeChanges(node: PMNode, ctx: UnitCtx): SemanticNodeChange[] {
  const raw = node.attrs["dataTracked"];
  const records = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(isEntry);
  return records
    .filter((record) => record["status"] === CHANGE_STATUS.pending)
    .flatMap((record) => {
      const operation = stringField(record, "operation");
      const toChange = operation !== undefined ? NODE_CHANGES[operation] : undefined;
      return toChange ? [toChange(node, record, ctx)] : [];
    });
}
