import {
  Editor,
  documentFromBlocks,
  getSchema,
  replaceFieldValues,
  hashArtifact,
  isFieldAnswered,
  isSigningKind,
  readSigningMoment,
  type DocumentBlock,
  type FieldKindSpec,
  type FieldValue,
  type SealedSnapshot,
  type SignerFieldDescriptor,
  type SigningMoment,
} from "@scrivr/core";
import type { Schema } from "@scrivr/core/pm";
import { PDFDocument } from "pdf-lib";
import { containedSize } from "./contain";
import { printExecuted, type ExecutedPdfOptions, type ExecutedPdfRefusal, type ExecutedPrint } from "./executed";
import { exportToPdf } from "./pdf";

/** The steps a certificate labels itself; `sent`, `viewed` and `consented` before signing, and signing before `completed`, are checked. */
export type StandardEventKind = "sent" | "viewed" | "consented" | "signed" | "declined" | "completed";

/** One line of the host's record: when, what, and whose. A `custom` step is the host's own, shown by its label. */
export type CompletionEvent =
  | { at: string; kind: StandardEventKind; party?: string }
  | { at: string; kind: "custom"; label: string; party?: string };

/**
 * A party as the host identified them. Only `role` and `name` are needed;
 * nothing absent — or blank — is printed. A party whose role carries no
 * field, someone sent a copy, is listed like any other.
 */
export interface CompletionParty {
  /** The role the party completed fields for, as the snapshot's fields name it, or one of the host's own. */
  role: string;
  name: string;
  email?: string;
  authentication?: string;
  ip?: string;
  userAgent?: string;
}

/** The host's record of the signing — printed as the host's word, never as checked. */
export interface CompletionRecord {
  /** Who keeps this record, named on the certificate as its source. */
  issuer: string;
  documentId?: string;
  title?: string;
  parties: CompletionParty[];
  events: CompletionEvent[];
}

/**
 * Every fixed title and label on a certificate, so a host can issue it in
 * its signers' language. A signature is headed by its field kind's own
 * label, and a party by its name.
 */
export interface CertificateLabels {
  readonly title: string;
  readonly verified: string;
  readonly verifiedNote: string;
  readonly contentHash: string;
  readonly artifactHash: string;
  /** Followed by the issuer's name. */
  readonly record: string;
  readonly documentTitle: string;
  readonly documentId: string;
  readonly role: string;
  readonly email: string;
  readonly authentication: string;
  readonly ip: string;
  readonly userAgent: string;
  readonly events: string;
  readonly eventKinds: Readonly<Record<StandardEventKind, string>>;
}

/** The English labels a certificate uses unless given others — a base to spread for a full translation. */
export const DEFAULT_CERTIFICATE_LABELS: Readonly<CertificateLabels> = Object.freeze({
  title: "Certificate of completion",
  verified: "Verified at issue",
  verifiedNote:
    "Checked when this certificate was issued, with the executed document it was printed beside: the agreed content against its hash, the executed document's hash, and each signature as that document prints it.",
  contentHash: "Agreed content (SHA-256)",
  artifactHash: "Executed document (SHA-256)",
  record: "Signing record — as recorded by",
  documentTitle: "Document",
  documentId: "Document ID",
  role: "Role",
  email: "Email",
  authentication: "Authentication",
  ip: "IP address",
  userAgent: "User agent",
  events: "Events",
  eventKinds: Object.freeze({ sent: "Sent", viewed: "Viewed", consented: "Consented", signed: "Signed", declined: "Declined", completed: "Completed" }),
});

/** What a host's `content` is handed: the record section Scrivr would print, and the facts behind the certificate. */
export interface CertificateParts {
  /** The body of the record section as Scrivr lays it out — to keep, change, or replace. */
  record: DocumentBlock[];
  /** What was checked, as data. */
  verified: VerifiedFacts;
  /** The labels this certificate is printed under — the host's own where it gave them — to find Scrivr's blocks by. */
  labels: CertificateLabels;
  /** The host's record as it was given. */
  signingRecord: CompletionRecord;
}

/**
 * Where Scrivr's own parts go in a certificate the host lays out. The host
 * places a slot; Scrivr fills it after `content` has run, from facts the host
 * only ever sees frozen, so nothing the host writes appears inside one.
 */
export type CertificateSlot =
  /** *Verified at issue*: its title, note, both hashes, and every signature not placed in a `signature` slot. */
  | { slot: "verified" }
  /** The record's title, naming the issuer: it heads the host's record. */
  | { slot: "record" }
  /** `role`'s signatures as the executed PDF prints them, each under its field kind's label. */
  | { slot: "signature"; role: string };

/** A node of the certificate's document, in the host's own schema, or a slot for one of Scrivr's parts. */
export type CertificateNode = CertificateSlot | { type: string; slot?: never; [key: string]: unknown };

/**
 * A host's own content. Either blocks around Scrivr's layout — above the
 * title, a record body of its own, at the end; any left out stays as
 * Scrivr's — or a `body`: the whole certificate as the host lays it out, in
 * its own schema, with slots for Scrivr's parts.
 */
export interface CertificateContent {
  before?: DocumentBlock[];
  record?: DocumentBlock[];
  after?: DocumentBlock[];
  /** The certificate as a document's content, in the host's schema, with exactly one `verified` and one `record` slot. */
  body?: readonly CertificateNode[];
  /** The certificate document's attributes — page-level state such as a header and footer. */
  attrs?: Record<string, unknown>;
}

export interface CompletionCertificateOptions extends ExecutedPdfOptions {
  /** The host's record, printed under its issuer's name. */
  record: CompletionRecord;
  /**
   * The host's own content around the certificate: a logo or intro before
   * it, a disclosure after it, the record section's body laid out its own
   * way. *Verified at issue*, and the record's title naming its issuer,
   * stay Scrivr's — only what was checked is ever printed as checked.
   */
  content?: (parts: CertificateParts) => CertificateContent;
  /** Labels to use instead of the English defaults; any left out, or blank, stay English. */
  labels?: Partial<Omit<CertificateLabels, "eventKinds">> & { eventKinds?: Partial<Record<StandardEventKind, string>> };
}

/** A signature as checked: which field, whose role, what kind. When it was given is the host's record, printed there. */
export interface VerifiedSignature {
  readonly fieldId: string;
  readonly role: string;
  readonly kind: string;
}

/** The certificate's checked section as data, to keep beside it. */
export interface VerifiedFacts {
  readonly contentHash: string;
  readonly artifactHash: string;
  readonly signatures: readonly VerifiedSignature[];
}

/** Why no certificate was issued, beyond why there is no executed document. */
export type CertificateRefusal =
  /** An answered signature was not drawn by the standard field printer. */
  | { reason: "unverified-signature-print"; fieldId: string }
  /** A field's kind is not one the editor setup knows: the certificate could not tell whether it is a signature. */
  | { reason: "unknown-field-kind"; kind: string }
  /** The record names no issuer: its facts would be printed under nobody's name. */
  | { reason: "unnamed-issuer" }
  /** Two parties play one role: whose a signature for it is could not be said. */
  | { reason: "duplicate-party"; role: string }
  /** An event of a kind no certificate knows, or a step of the host's own with no label. */
  | { reason: "unknown-event"; event: CompletionEvent }
  /** A role that answered or must answer a field has no party in the record. */
  | { reason: "missing-party"; role: string }
  /** An event names a role no party in the record plays. */
  | { reason: "unknown-party"; role: string }
  /** A time that is not a full timestamp with a zone — a bare day included: the certificate would have to invent the moment. */
  | { reason: "unzoned-time"; at: string }
  /** A signature with no `signedAt`: the certificate could not say when it was given. */
  | { reason: "undated-signature"; fieldId: string }
  /** A signature dated after `completed`. */
  | { reason: "signed-after-completed"; fieldId: string }
  /** A party first sent, viewing or consenting only after it signed, or a host `signed` event after `completed`. */
  | { reason: "events-out-of-order"; event: CompletionEvent }
  /** The editor setup cannot hold the titles, paragraphs, labelled lines and images Scrivr's parts are printed in. */
  | { reason: "unprintable-certificate"; message: string }
  /** A `body` without a `verified` slot, or with more than one: what was checked must be printed, once. */
  | { reason: "verified-slot" }
  /** A `body` without a `record` slot, or with more than one: the issuer's name heads the host's word. */
  | { reason: "record-slot" }
  /** A role's signatures placed in two slots. */
  | { reason: "duplicate-signature-slot"; role: string }
  /** A `body` that is no document the host's schema accepts. */
  | { reason: "invalid-content"; message: string };

/** The executed PDF and its certificate from one printing, or why there is neither — an answer the host shows someone. */
export type CompletionCertificateResult =
  | {
      ok: true;
      executed: { pdf: Uint8Array; artifactHash: string };
      certificate: {
        pdf: Uint8Array;
        certificateHash: string;
        verified: VerifiedFacts;
        /** The certificate as a document's JSON, to show in a viewer as well as print. */
        content: Record<string, unknown>;
      };
    }
  | { ok: false; refusal: ExecutedPdfRefusal | CertificateRefusal };

/**
 * The executed PDF and its certificate of completion, issued together from
 * one printing — so the certificate can only describe the document beside
 * it. Prints the executed record as `exportExecutedPdf` does (same checks,
 * same refusals), then the certificate: *Verified at issue* holds only what
 * was checked in this call — the snapshot against its hash, the executed
 * PDF's hash, every signature as it printed — and the host's record follows
 * under the issuer's name, as the host's word. The certificate is printed in
 * `editorOptions` — the signers' extensions, fonts and page — its drawings from
 * the bytes the executed PDF embedded. Refuses rather than certify a record
 * that disagrees with the document or with time.
 */
export async function exportCompletionCertificate(
  snapshot: Pick<SealedSnapshot, "content" | "contentHash">,
  values: Readonly<Record<string, FieldValue>>,
  options: CompletionCertificateOptions,
): Promise<CompletionCertificateResult> {
  const { record, labels, content, ...executedOptions } = options;
  const printed = await printExecuted(snapshot, values, executedOptions);
  if (!printed.ok) return printed;
  const { print } = printed;

  const { editorOptions, ...pdfOptions } = executedOptions;
  const schema = getSchema(editorOptions.extensions ?? []);
  const issued = certificateOf(snapshot.contentHash, print, record, labelsOf(labels), content, schema);
  if ("reason" in issued) return { ok: false, refusal: issued };

  // Printed in the signers' own setup — their extensions, fonts and page — so
  // whatever the host can put in a document it can put here; its drawings are
  // the bytes the executed PDF embedded.
  const made = certificateEditor(editorOptions, issued.content);
  if ("reason" in made) return { ok: false, refusal: made };
  const editor = made;
  try {
    const pdf = await exportToPdf(editor, { ...pdfOptions, resolveImage: print.resolveImage });
    return {
      ok: true,
      executed: { pdf: print.pdf, artifactHash: print.artifactHash },
      certificate: { pdf, certificateHash: await hashArtifact(pdf), verified: issued.verified, content: issued.content },
    };
  } finally {
    editor.destroy();
  }
}

/**
 * One file: the executed record's pages, then the certificate's, under a
 * `bundleHash` of their own. The certificate inside still names the executed
 * record's `artifactHash` — the hash of that record alone, as it was issued.
 */
export async function bundleCertificate(executed: Uint8Array, certificate: Uint8Array): Promise<{ pdf: Uint8Array; bundleHash: string }> {
  const bundle = await PDFDocument.create();
  for (const bytes of [executed, certificate]) {
    const source = await PDFDocument.load(bytes);
    for (const page of await bundle.copyPages(source, source.getPageIndices())) bundle.addPage(page);
  }
  const pdf = await bundle.save();
  return { pdf, bundleHash: await hashArtifact(pdf) };
}

// ── Checking the record ──────────────────────────────────────────────────────

/** A signature the executed record printed. */
interface Signature {
  field: SignerFieldDescriptor;
  spec: FieldKindSpec;
  /** When it was given, to the second: an undated or unzoned signature was refused. */
  moment: SigningMoment & { time: NonNullable<SigningMoment["time"]> };
  /** The signature as the executed PDF prints it: its words, or its drawing fitted to the field's box. */
  shown: DocumentBlock;
}

/**
 * The editor the certificate prints from, or why the host's content cannot
 * open in it. It holds no field values: a field on the certificate shows
 * nothing the executed PDF did not print and Scrivr check.
 */
function certificateEditor(editorOptions: CompletionCertificateOptions["editorOptions"], content: Record<string, unknown>): Editor | CertificateRefusal {
  try {
    const editor = new Editor({ ...editorOptions, content });
    replaceFieldValues(editor, {});
    editor.seal();
    return editor;
  } catch (error) {
    return { reason: "invalid-content", message: error instanceof Error ? error.message : String(error) };
  }
}

interface TimedEvent {
  event: CompletionEvent;
  at: number;
}

/**
 * The certificate's document and checked facts, or why it cannot be issued
 * over this printing. *Verified at issue* and the record's title are built
 * from facts the host only ever sees frozen, and the host places them without
 * writing in them.
 */
function certificateOf(
  contentHash: string,
  print: ExecutedPrint,
  record: CompletionRecord,
  labels: CertificateLabels,
  content: CompletionCertificateOptions["content"],
  schema: Schema,
): { content: Record<string, unknown>; verified: VerifiedFacts } | CertificateRefusal {
  const unknownKind = print.fields.find((f) => print.kinds[f.kind] === undefined);
  if (unknownKind) return { reason: "unknown-field-kind", kind: unknownKind.kind };
  const issuer = given(record.issuer);
  if (issuer === null) return { reason: "unnamed-issuer" };

  const signatures = signaturesOf(print);
  if ("reason" in signatures) return signatures;
  const timeline = timelineOf(record.events);
  if ("reason" in timeline) return timeline;
  const refusal = checkParties(print, record) ?? checkOrder(timeline, signatures);
  if (refusal) return refusal;

  const verified = deepFreeze<VerifiedFacts>({
    contentHash,
    artifactHash: print.artifactHash,
    signatures: signatures.map(({ field }) => ({ fieldId: field.id, role: field.role, kind: field.kind })),
  });
  const recordBody = recordBlocks(signatures, record, timeline, labels);
  const recordTitle: DocumentBlock = { title: `${labels.record} ${issuer}`, level: 2 };
  const host = content?.({ record: recordBody, verified, labels, signingRecord: record }) ?? {};
  if (host.body === undefined) {
    const document = withAttrs(documentFromBlocks([
      ...(host.before ?? []),
      { title: labels.title, level: 1 },
      ...verifiedBlocks(verified, signatures, labels),
      recordTitle,
      ...(host.record ?? recordBody),
      ...(host.after ?? []),
    ]), host.attrs);
    const unprintable = schemaErrorOf(schema, document);
    return unprintable === null ? { content: document, verified } : { reason: "unprintable-certificate", message: unprintable };
  }

  const roles = new Set(record.parties.map((party) => party.role));
  const laid = layOut(host.body, signatures, verified, labels, recordTitle, roles);
  if ("reason" in laid) return laid;
  // Scrivr's own parts first: a setup that cannot hold them cannot print what was checked.
  const unprintable = schemaErrorOf(schema, { type: "doc", content: laid.filled });
  if (unprintable !== null) return { reason: "unprintable-certificate", message: unprintable };
  const document = withAttrs({ type: "doc", content: laid.content }, host.attrs);
  const invalid = schemaErrorOf(schema, document);
  return invalid === null ? { content: document, verified } : { reason: "invalid-content", message: invalid };
}

/** Why `schema` does not accept `document`, or null when it does. */
function schemaErrorOf(schema: Schema, document: Record<string, unknown>): string | null {
  try {
    schema.nodeFromJSON(document).check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** `document` with the host's attributes, when it gave any. */
const withAttrs = (document: Record<string, unknown>, attrs: Record<string, unknown> | undefined) =>
  attrs === undefined ? document : { ...document, attrs };

/** Nodes of the blocks Scrivr lays out for a slot. */
const nodesOf = (blocks: readonly DocumentBlock[]): unknown[] => {
  const content = documentFromBlocks(blocks)["content"];
  return Array.isArray(content) ? content : [];
};

const isSlot = (node: CertificateNode): node is CertificateSlot => "slot" in node && node.slot !== undefined;

/** Whether a body entry from a host — typed or not — is a node, or a slot Scrivr knows. */
const wellFormed = (node: unknown): boolean => {
  if (typeof node !== "object" || node === null) return false;
  if (!("slot" in node) || node.slot === undefined) return true;
  return node.slot === "verified" || node.slot === "record" ||
    (node.slot === "signature" && "role" in node && typeof node.role === "string");
};

/**
 * The host's body with Scrivr's parts in its slots: what was checked exactly
 * once, the issuer's title exactly once, and every signature exactly once —
 * in its role's slot, or in *Verified at issue* when its role has none.
 */
function layOut(
  body: readonly CertificateNode[],
  signatures: readonly Signature[],
  verified: VerifiedFacts,
  labels: CertificateLabels,
  recordTitle: DocumentBlock,
  roles: ReadonlySet<string>,
): { content: unknown[]; filled: unknown[] } | CertificateRefusal {
  const malformed = body.find((node) => !wellFormed(node));
  if (malformed !== undefined) return { reason: "invalid-content", message: `not a node or a known slot: ${JSON.stringify(malformed)}` };
  const slots = body.filter(isSlot);
  if (slots.filter((s) => s.slot === "verified").length !== 1) return { reason: "verified-slot" };
  if (slots.filter((s) => s.slot === "record").length !== 1) return { reason: "record-slot" };
  const placed = new Set<string>();
  for (const slot of slots) {
    if (slot.slot !== "signature") continue;
    if (!roles.has(slot.role)) return { reason: "unknown-party", role: slot.role };
    if (placed.has(slot.role)) return { reason: "duplicate-signature-slot", role: slot.role };
    placed.add(slot.role);
  }
  const unplaced = signatures.filter(({ field }) => !placed.has(field.role));
  const fill = (slot: CertificateSlot): unknown[] => {
    if (slot.slot === "verified") return nodesOf(verifiedBlocks(verified, unplaced, labels));
    if (slot.slot === "record") return nodesOf([recordTitle]);
    return nodesOf(signatures
      .filter(({ field }) => field.role === slot.role)
      .flatMap(({ spec, shown }): DocumentBlock[] => [{ title: spec.label, level: 3 }, shown]));
  };
  return {
    content: body.flatMap((node) => (isSlot(node) ? fill(node) : [node])),
    filled: slots.flatMap(fill),
  };
}

/** `value`, and everything in it, made read-only. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** The signatures the record printed, each dated by its full `signedAt`. Unknown kinds were refused before. */
function signaturesOf({ fields, kinds, onRecord, drawings, printedFields }: ExecutedPrint): Signature[] | CertificateRefusal {
  const signatures: Signature[] = [];
  for (const field of fields) {
    const answer = onRecord[field.id];
    const spec = kinds[field.kind];
    if (!spec || !isSigningKind(kinds, field.kind) || !isFieldAnswered(field, answer, kinds)) continue;
    const printed = printedFields.get(field.id);
    if (!printed) return { reason: "unverified-signature-print", fieldId: field.id };
    const value = printed.value;
    // A signature line holds words or a drawing; anything else is no signature to show.
    if (value?.kind !== "text" && value?.kind !== "image") continue;
    if (value.signedAt === undefined) return { reason: "undated-signature", fieldId: field.id };
    const moment = readSigningMoment(value.signedAt);
    if (!moment?.time) return { reason: "unzoned-time", at: value.signedAt };
    const time = moment.time;
    if (value.kind === "text") {
      signatures.push({ field, spec, moment: { ...moment, time }, shown: { paragraph: value.text } });
      continue;
    }
    // The observed drawing must be one whose bytes this printing captured.
    const drawn = drawings.get(value.src);
    const box = printed.box;
    if (!drawn) return { reason: "unverified-signature-print", fieldId: field.id };
    signatures.push({ field, spec, moment: { ...moment, time }, shown: { image: value.src, ...containedSize(drawn, box) } });
  }
  return signatures;
}

/**
 * The instant a time names, or `null` unless it is a full timestamp with a
 * zone. A bare day is refused too: printing it, or ordering by it, would
 * stand an invented midnight in for the moment.
 */
function instantOf(at: string): number | null {
  const moment = readSigningMoment(at);
  return moment?.time ? moment.at : null;
}

/** The kinds of event a certificate labels itself. */
// Every kind that has a label: the labels' type names each one, so none is missed.
const STANDARD_EVENTS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_CERTIFICATE_LABELS.eventKinds));

/** The events by time — ties in the host's order — or the first that is not an instant, or not an event a certificate can name. */
function timelineOf(events: readonly CompletionEvent[]): TimedEvent[] | CertificateRefusal {
  const timed: TimedEvent[] = [];
  for (const event of events) {
    const named = event.kind === "custom" ? given(event.label) !== null : STANDARD_EVENTS.has(event.kind);
    if (!named) return { reason: "unknown-event", event };
    const at = instantOf(event.at);
    if (at === null) return { reason: "unzoned-time", at: event.at };
    timed.push({ event, at });
  }
  return timed.sort((a, b) => a.at - b.at);
}

/** One party per role; every role that answered or must answer a field has one; every event's party is one of them. */
function checkParties({ fields, onRecord, kinds }: ExecutedPrint, record: CompletionRecord): CertificateRefusal | null {
  const parties = new Set<string>();
  for (const party of record.parties) {
    if (parties.has(party.role)) return { reason: "duplicate-party", role: party.role };
    parties.add(party.role);
  }
  const unrepresented = fields.find((f) => (f.required || isFieldAnswered(f, onRecord[f.id], kinds)) && !parties.has(f.role));
  if (unrepresented) return { reason: "missing-party", role: unrepresented.role };
  const unknown = record.events.find((e) => e.party !== undefined && !parties.has(e.party));
  return unknown?.party !== undefined ? { reason: "unknown-party", role: unknown.party } : null;
}

/** The events by which a party first comes to the document: one of them, when recorded, comes before its first signing. */
const COMES_TO_THE_DOCUMENT: ReadonlySet<CompletionEvent["kind"]> = new Set(["sent", "viewed", "consented"]);

/**
 * A party comes to the document before it signs — its first signing being
 * the earlier of its printed signatures and the host's `signed` events — and
 * nothing is signed after completion. Views after signing, or after
 * completion, are what signing tools record, and pass.
 */
function checkOrder(timeline: readonly TimedEvent[], signatures: readonly Signature[]): CertificateRefusal | null {
  const firstSigning = new Map<string, number>();
  const noteSigning = (party: string, at: number) => firstSigning.set(party, Math.min(at, firstSigning.get(party) ?? Infinity));
  for (const { field, moment } of signatures) noteSigning(field.role, moment.at);
  for (const { event, at } of timeline) if (event.kind === "signed" && event.party !== undefined) noteSigning(event.party, at);

  const firstCame = new Map<string, TimedEvent>();
  for (const timed of timeline) {
    const { party, kind } = timed.event;
    if (party !== undefined && COMES_TO_THE_DOCUMENT.has(kind) && !firstCame.has(party)) firstCame.set(party, timed);
  }
  for (const [party, came] of firstCame) {
    if (came.at > (firstSigning.get(party) ?? Infinity)) return { reason: "events-out-of-order", event: came.event };
  }

  const completed = timeline.find(({ event }) => event.kind === "completed");
  if (!completed) return null;
  const late = signatures.find(({ moment }) => moment.at > completed.at);
  if (late) return { reason: "signed-after-completed", fieldId: late.field.id };
  const signedLate = timeline.find(({ event, at }) => event.kind === "signed" && at > completed.at);
  return signedLate ? { reason: "events-out-of-order", event: signedLate.event } : null;
}

// ── The document ─────────────────────────────────────────────────────────────

/** Text a host gave, or nothing when it gave none — blank included, so no line prints empty. */
const given = (value: string | undefined): string | null => (value === undefined || value.trim() === "" ? null : value);

/** The host's labels over the defaults; a blank one keeps its default, so no title prints empty. */
function labelsOf(overrides: CompletionCertificateOptions["labels"] = {}): CertificateLabels {
  const d = DEFAULT_CERTIFICATE_LABELS;
  const o = overrides;
  const e = o.eventKinds ?? {};
  const pick = (value: string | undefined, fallback: string): string => given(value) ?? fallback;
  // Frozen: the host is handed them, and the record's title among them names the issuer.
  return deepFreeze({
    title: pick(o.title, d.title),
    verified: pick(o.verified, d.verified),
    verifiedNote: pick(o.verifiedNote, d.verifiedNote),
    contentHash: pick(o.contentHash, d.contentHash),
    artifactHash: pick(o.artifactHash, d.artifactHash),
    record: pick(o.record, d.record),
    documentTitle: pick(o.documentTitle, d.documentTitle),
    documentId: pick(o.documentId, d.documentId),
    role: pick(o.role, d.role),
    email: pick(o.email, d.email),
    authentication: pick(o.authentication, d.authentication),
    ip: pick(o.ip, d.ip),
    userAgent: pick(o.userAgent, d.userAgent),
    events: pick(o.events, d.events),
    eventKinds: {
      sent: pick(e.sent, d.eventKinds.sent),
      viewed: pick(e.viewed, d.eventKinds.viewed),
      consented: pick(e.consented, d.eventKinds.consented),
      signed: pick(e.signed, d.eventKinds.signed),
      declined: pick(e.declined, d.eventKinds.declined),
      completed: pick(e.completed, d.eventKinds.completed),
    },
  });
}

/** An instant as a reader reads it in UTC: `2026-11-14 22:30:00 UTC`. */
const readableUtc = (at: number): string => `${new Date(at).toISOString().slice(0, 19).replace("T", " ")} UTC`;

/** A signature's moment as its signer gave it, in their own offset: `2026-11-15 01:30:00 (UTC+03:00)`. */
const asSigned = ({ day, time }: Signature["moment"]): string => `${day} ${time.clock} (UTC${time.zone})`;

/**
 * *Verified at issue*: what was checked, and each signature as the executed
 * PDF prints it — its words, or its drawing at the size it printed — headed by its kind and role — no person is named
 * as a fact here; who holds a role is the host's word, kept to the record.
 */
function verifiedBlocks(verified: VerifiedFacts, signatures: readonly Signature[], labels: CertificateLabels): DocumentBlock[] {
  return [
    { title: labels.verified, level: 2 },
    { paragraph: labels.verifiedNote },
    { label: labels.contentHash, value: verified.contentHash },
    { label: labels.artifactHash, value: verified.artifactHash },
    ...signatures.flatMap(({ field, spec, shown }): DocumentBlock[] => [{ title: `${spec.label} — ${field.role}`, level: 3 }, shown]),
  ];
}

/** The record section's body as Scrivr lays it out: the document, each party with its signing times, the events. */
function recordBlocks(signatures: readonly Signature[], record: CompletionRecord, timeline: readonly TimedEvent[], labels: CertificateLabels): DocumentBlock[] {
  const nameOf = (role: string): string => given(record.parties.find((p) => p.role === role)?.name) ?? role;
  const title = given(record.title);
  const documentId = given(record.documentId);

  const partyBlocks = record.parties.flatMap((party): DocumentBlock[] => [
    { title: given(party.name) ?? party.role, level: 3 },
    { label: labels.role, value: party.role },
    ...([
      [labels.email, party.email],
      [labels.authentication, party.authentication],
      [labels.ip, party.ip],
      [labels.userAgent, party.userAgent],
    ] satisfies Array<[string, string | undefined]>).flatMap(([label, value]): DocumentBlock[] => {
      const shown = given(value);
      return shown === null ? [] : [{ label, value: shown }];
    }),
    // When each signature was given is the host's own stamp on it, recorded here beside the party.
    ...signatures
      .filter(({ field }) => field.role === party.role)
      .map(({ spec, moment }): DocumentBlock => ({ label: spec.label, value: `${asSigned(moment)} · ${readableUtc(moment.at)}` })),
  ]);

  const eventBlocks = timeline.map(({ event, at }): DocumentBlock => {
    // Every event was checked nameable: a standard kind, or a step with a label.
    const what = event.kind === "custom" ? event.label : labels.eventKinds[event.kind];
    const who = event.party === undefined ? "" : ` — ${nameOf(event.party)}`;
    return { paragraph: `${readableUtc(at)} — ${what}${who}` };
  });

  return [
    ...(title === null ? [] : [{ label: labels.documentTitle, value: title }]),
    ...(documentId === null ? [] : [{ label: labels.documentId, value: documentId }]),
    ...partyBlocks,
    { title: labels.events, level: 3 },
    ...eventBlocks,
  ];
}
