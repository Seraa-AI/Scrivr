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
  | { reason: "unidentified-fields"; count: number }
  /**
   * Signer fields in a header, a footer or another part kept beside the body
   * — the signing view completes fields in the body only.
   */
  | { reason: "fields-outside-body"; count: number }
  /** One of the host's own checks refused — a signing order, an approval, anything Scrivr cannot know. */
  | HostSealRefusal;

/** A refusal from a check the host runs; `code` is the host's own. */
export interface HostSealRefusal {
  reason: "host";
  code: string;
  message: string;
}

/** What a host's check is shown: the document, and the signer fields it would seal. */
export interface SealCheckSubject {
  doc: PmNode;
  fields: readonly SignerFieldDescriptor[];
  assignedRoles: readonly string[];
}

/** A host's check on a seal: a refusal, or `null` to let it through. */
export type SealCheck = (subject: SealCheckSubject) => HostSealRefusal | null | Promise<HostSealRefusal | null>;

export type SnapshotResult = { ok: true; snapshot: SealedSnapshot } | { ok: false; refusal: SealRefusal };

export interface CreateSnapshotOptions {
  /** Role names the host has mapped to people — never the people. */
  assignedRoles: readonly string[];
  /**
   * The host's own checks. `before` run ahead of Scrivr's, `after` only once
   * Scrivr's have passed; the first refusal stops the seal. Each sees the
   * same reading of the document the snapshot is taken from.
   */
  checks?: { before?: readonly SealCheck[]; after?: readonly SealCheck[] };
}

async function hostRefusal(checks: readonly SealCheck[] | undefined, subject: SealCheckSubject): Promise<HostSealRefusal | null> {
  for (const check of checks ?? []) {
    const refusal = await check(subject);
    if (refusal) return refusal;
  }
  return null;
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

/**
 * The parts of a document kept in its attributes — headers, footers — each a
 * document of its own, read with the body's schema. A seal checks them as it
 * does the body: the hash covers them, so what they hold is agreed too.
 */
function partsBesideBody(doc: PmNode): PmNode[] {
  const parts: PmNode[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value === null || typeof value !== "object") return;
    if ("type" in value && value.type === "doc" && "content" in value) {
      parts.push(doc.type.schema.nodeFromJSON(value));
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(doc.attrs);
  return parts;
}

/** Every open suggestion, by id — on a node's or mark's `dataTracked`, or a tracked mark. */
function pendingChanges(docs: readonly PmNode[]): number {
  const ids = new Set<string>();
  const record = (tracked: unknown, fallback: string) => {
    for (const entry of [tracked].flat()) {
      if (entry === null || typeof entry !== "object") continue;
      const id = "id" in entry && typeof entry.id === "string" ? entry.id : fallback;
      ids.add(id);
    }
  };
  docs.forEach((doc, part) => doc.descendants((node, pos) => {
    record(node.attrs["dataTracked"], `node@${part}:${pos}`);
    for (const mark of node.marks) {
      record(mark.attrs["dataTracked"], `mark@${part}:${pos}`);
      if (TRACKED_MARKS.has(mark.type.name) && !mark.attrs["dataTracked"]) ids.add(`mark@${part}:${pos}`);
    }
    return true;
  }));
  return ids.size;
}

/** The prompts of author text fields still showing them, one per field. */
function unfilledPrompts(docs: readonly PmNode[]): string[] {
  const prompts = new Map<string, string>();
  for (const doc of docs) doc.descendants((node) => {
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
export async function createSnapshot(doc: PmNode, { assignedRoles, checks }: CreateSnapshotOptions): Promise<SnapshotResult> {
  const fields = listSignerFields(doc);
  const subject: SealCheckSubject = { doc, fields, assignedRoles };
  const before = await hostRefusal(checks?.before, subject);
  if (before) return { ok: false, refusal: before };
  const parts = partsBesideBody(doc);
  const count = pendingChanges([doc, ...parts]);
  if (count > 0) return { ok: false, refusal: { reason: "pending-tracked-changes", count } };
  const prompts = unfilledPrompts([doc, ...parts]);
  if (prompts.length > 0) return { ok: false, refusal: { reason: "unfilled-fields", prompts } };
  const outside = parts.reduce((n, part) => n + listSignerFields(part).length + unidentifiedFields(part), 0);
  if (outside > 0) return { ok: false, refusal: { reason: "fields-outside-body", count: outside } };
  const unidentified = unidentifiedFields(doc);
  if (unidentified > 0) return { ok: false, refusal: { reason: "unidentified-fields", count: unidentified } };
  const refusal = roleRefusal(fields, assignedRoles);
  if (refusal) return { ok: false, refusal };
  const after = await hostRefusal(checks?.after, subject);
  if (after) return { ok: false, refusal: after };
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
