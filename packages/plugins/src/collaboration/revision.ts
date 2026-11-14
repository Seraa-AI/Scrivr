import * as Y from "yjs";
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { contentHashOf, createSnapshot, type CreateSnapshotOptions, type SnapshotResult } from "@scrivr/core";
import { Node as PmNode, type Schema } from "@scrivr/core/pm";
import { readDocAttrs } from "./docAttrs";
import { DOC_ATTRS_MAP_NAME, type DocAttrEnvelope } from "./YBinding";

/** The Y.Map that carries a room's revision stamp, beside its content. */
export const REVISION_MAP_NAME = "scrivr:revision";

/** The fragment `Collaboration` binds the document to. */
const CONTENT_FRAGMENT = "prosemirror";

/**
 * Where a room's revision stands, written into the room so every client sees
 * the boundary on its next sync — not when its server next re-checks it.
 */
export type RevisionStamp =
  | { mode: "editable"; revisionId: string; parentRevisionId: string | null }
  | { mode: "sealed"; revisionId: string; contentHash: string; sealedAt: string };

/** A room's stamp while it is sealed. */
export type SealedStamp = Extract<RevisionStamp, { mode: "sealed" }>;
/** A room's stamp while it is being edited. */
export type EditableStamp = Extract<RevisionStamp, { mode: "editable" }>;

const STAMP_KEY = "stamp";

function isRevisionStamp(value: unknown): value is RevisionStamp {
  if (value === null || typeof value !== "object" || !("mode" in value) || !("revisionId" in value)) return false;
  if (typeof value.revisionId !== "string") return false;
  if (value.mode === "sealed") {
    return (
      "contentHash" in value &&
      typeof value.contentHash === "string" &&
      "sealedAt" in value &&
      typeof value.sealedAt === "string"
    );
  }
  return (
    value.mode === "editable" &&
    "parentRevisionId" in value &&
    (value.parentRevisionId === null || typeof value.parentRevisionId === "string")
  );
}

/** The room's stamp, or `null` when it has none or what it holds is not one. */
export function readRevisionStamp(ydoc: Y.Doc): RevisionStamp | null {
  const stamp = ydoc.getMap(REVISION_MAP_NAME).get(STAMP_KEY);
  return isRevisionStamp(stamp) ? stamp : null;
}

export function isSealed(ydoc: Y.Doc): boolean {
  return readRevisionStamp(ydoc)?.mode === "sealed";
}

/** Mark the room sealed. Call it in the same step as the host records the seal. */
export function stampSeal(ydoc: Y.Doc, seal: { revisionId: string; contentHash: string; sealedAt: string }): void {
  const stamp: RevisionStamp = { mode: "sealed", ...seal };
  ydoc.getMap(REVISION_MAP_NAME).set(STAMP_KEY, stamp);
}

/**
 * Open the room for editing as a new revision. A sealed revision is never
 * edited in place; unsealing starts its successor.
 */
export function stampEditable(ydoc: Y.Doc, revision: { revisionId: string; parentRevisionId: string | null }): void {
  const stamp: RevisionStamp = { mode: "editable", ...revision };
  ydoc.getMap(REVISION_MAP_NAME).set(STAMP_KEY, stamp);
}

/** The document a room holds: its content, with the attributes stored beside it. */
export function docFromYDoc(ydoc: Y.Doc, schema: Schema): PmNode {
  const content = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(CONTENT_FRAGMENT), schema);
  const declared = schema.nodes["doc"]?.spec.attrs ?? {};
  const stored = readDocAttrs(ydoc);
  const attrs: Record<string, unknown> = { ...content.attrs };
  for (const key of Object.keys(declared)) if (key in stored) attrs[key] = stored[key];
  return schema.topNodeType.create(attrs, content.content);
}

/** Seal the room's document — `createSnapshot` over what the room holds. */
export function snapshotFromYDoc(
  ydoc: Y.Doc,
  schema: Schema,
  options: CreateSnapshotOptions,
): Promise<SnapshotResult> {
  return createSnapshot(docFromYDoc(ydoc, schema), options);
}

/** Whether the room still holds exactly what was sealed. */
export async function matchesSnapshot(ydoc: Y.Doc, schema: Schema, contentHash: string): Promise<boolean> {
  return (await contentHashOf(docFromYDoc(ydoc, schema))) === contentHash;
}

/**
 * Put the room back to a sealed snapshot — content and attributes — in one
 * transaction. For a room whose cached state drifted from its seal. Give the
 * Y.Doc the host's deterministic client id first, as for any seeding, so two
 * servers resetting the same room write the same history.
 */
export function resetToSnapshot(ydoc: Y.Doc, schema: Schema, content: string): void {
  const doc = PmNode.fromJSON(schema, JSON.parse(content));
  const attrs = ydoc.getMap<DocAttrEnvelope>(DOC_ATTRS_MAP_NAME);
  ydoc.transact(() => {
    const fragment = ydoc.getXmlFragment(CONTENT_FRAGMENT);
    fragment.delete(0, fragment.length);
    prosemirrorToYXmlFragment(doc, fragment);
    attrs.clear();
    for (const [key, value] of Object.entries(doc.attrs)) {
      if (value !== null && value !== undefined) attrs.set(key, { localSeq: 0, value });
    }
  });
}
