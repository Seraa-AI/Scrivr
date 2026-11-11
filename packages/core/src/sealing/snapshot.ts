import type { Node as PmNode } from "prosemirror-model";
import { listSignerFields, type SignerFieldDescriptor } from "../extensions/built-in/Field";

/** A revision frozen as the exact bytes that were agreed. */
export interface SealedSnapshot {
  /** The document as canonical JSON. Load it with `JSON.parse`; verify it as is. */
  content: string;
  /** `sha256:<hex>` over `content` — what was agreed. */
  contentHash: string;
  /** The signer fields in `content`, taken from the same bytes as the hash. */
  fields: SignerFieldDescriptor[];
}

/** Why a document could not be sealed. */
export type SealRefusal =
  /** A required field's role has nobody assigned. */
  | { reason: "unassigned-roles"; missing: string[] }
  /** A role was assigned that no field carries — its field was removed after the invitation. */
  | { reason: "unknown-roles"; unknown: string[] }
  /** Suggestions are still open; a signer would agree to wording not yet decided. */
  | { reason: "pending-tracked-changes"; count: number }
  /** Text the author fills still shows its prompt; a signer would agree to a blank. */
  | { reason: "unfilled-fields"; prompts: string[] }
  /**
   * Signer fields with no id, no role, or another field's id — nobody could
   * be asked to complete them, or their values would land in each other.
   */
  | { reason: "unidentified-fields"; count: number };

export type SnapshotResult = { ok: true; snapshot: SealedSnapshot } | { ok: false; refusal: SealRefusal };

export interface CreateSnapshotOptions {
  /** Role names the host has mapped to people — never the people. */
  assignedRoles: readonly string[];
}

/**
 * JSON with object keys sorted and no whitespace, so one document always
 * gives one byte string. Key order is UTF-16 code-unit order and numbers are
 * JavaScript's shortest form — the rules of RFC 8785 for the values a
 * document holds.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  // A copy owns a plain ArrayBuffer, which is what `digest` accepts.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const TRACKED_MARKS = new Set(["trackedInsert", "trackedDelete"]);

/** Every open suggestion, by id — on a node's or mark's `dataTracked`, or a tracked mark. */
function pendingChanges(doc: PmNode): number {
  const ids = new Set<string>();
  const record = (tracked: unknown, fallback: string) => {
    for (const entry of [tracked].flat()) {
      if (entry === null || typeof entry !== "object") continue;
      const id = "id" in entry && typeof entry.id === "string" ? entry.id : fallback;
      ids.add(id);
    }
  };
  doc.descendants((node, pos) => {
    record(node.attrs["dataTracked"], `node@${pos}`);
    for (const mark of node.marks) {
      record(mark.attrs["dataTracked"], `mark@${pos}`);
      if (TRACKED_MARKS.has(mark.type.name) && !mark.attrs["dataTracked"]) ids.add(`mark@${pos}`);
    }
    return true;
  });
  return ids.size;
}

/** The prompts of author text fields still showing them, one per field. */
function unfilledPrompts(doc: PmNode): string[] {
  const prompts = new Map<string, string>();
  doc.descendants((node) => {
    for (const mark of node.marks) {
      const { nodeId, prompt, placeholder } = mark.attrs;
      if (mark.type.name === "fieldRange" && placeholder === true) prompts.set(String(nodeId), String(prompt));
    }
    return true;
  });
  return [...prompts.values()];
}

/** Signer fields that lack an id or a role, or repeat an earlier field's id. */
function unidentifiedFields(doc: PmNode): number {
  const ids = new Set<string>();
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name !== "field" || node.attrs["fill"] !== "signer") return true;
    const { nodeId, role } = node.attrs;
    if (typeof nodeId !== "string" || typeof role !== "string" || ids.has(nodeId)) count++;
    else ids.add(nodeId);
    return false;
  });
  return count;
}

function roleRefusal(fields: readonly SignerFieldDescriptor[], assigned: readonly string[]): SealRefusal | null {
  const roles = new Set(fields.map((f) => f.role));
  const missing = [...new Set(fields.filter((f) => f.required && !assigned.includes(f.role)).map((f) => f.role))];
  if (missing.length > 0) return { reason: "unassigned-roles", missing };
  const unknown = assigned.filter((role) => !roles.has(role));
  if (unknown.length > 0) return { reason: "unknown-roles", unknown };
  return null;
}

/**
 * Freeze a document into a snapshot and its hash. The manifest of fields and
 * the hash come from one reading of one document: checked separately, a field
 * added between the check and the freeze would leave a signer out.
 */
export async function createSnapshot(doc: PmNode, { assignedRoles }: CreateSnapshotOptions): Promise<SnapshotResult> {
  const count = pendingChanges(doc);
  if (count > 0) return { ok: false, refusal: { reason: "pending-tracked-changes", count } };
  const prompts = unfilledPrompts(doc);
  if (prompts.length > 0) return { ok: false, refusal: { reason: "unfilled-fields", prompts } };
  const unidentified = unidentifiedFields(doc);
  if (unidentified > 0) return { ok: false, refusal: { reason: "unidentified-fields", count: unidentified } };
  const fields = listSignerFields(doc);
  const refusal = roleRefusal(fields, assignedRoles);
  if (refusal) return { ok: false, refusal };
  const content = canonicalJson(doc.toJSON());
  return { ok: true, snapshot: { content, contentHash: await hashContent(content), fields } };
}

const hashContent = (content: string): Promise<string> => sha256(new TextEncoder().encode(content));

/**
 * The hash a snapshot of `doc` would carry, without the checks a seal makes —
 * for telling whether a document still is what was sealed.
 */
export function contentHashOf(doc: PmNode): Promise<string> {
  return hashContent(canonicalJson(doc.toJSON()));
}

/** Whether `content` is still the snapshot `contentHash` was taken of. */
export async function verifySnapshot(content: string, contentHash: string): Promise<boolean> {
  return (await hashContent(content)) === contentHash;
}

/** Hash exported bytes — the executed PDF, which records what was displayed. */
export function hashArtifact(bytes: Uint8Array): Promise<string> {
  return sha256(bytes);
}
