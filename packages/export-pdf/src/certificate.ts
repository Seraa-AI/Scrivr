import {
  Editor,
  documentFromBlocks,
  hashArtifact,
  isFieldAnswered,
  isSigningKind,
  readSigningMoment,
  type DocumentBlock,
  type FieldKindSpec,
  type FieldValue,
  type SealedSnapshot,
  type SignerFieldDescriptor,
} from "@scrivr/core";
import { PDFDocument } from "pdf-lib";
import { containedSize } from "./contain";
import { printExecuted, type ExecutedPdfOptions, type ExecutedPdfRefusal, type ExecutedPrint } from "./executed";
import { exportToPdf } from "./index";

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
  title: string;
  verified: string;
  verifiedNote: string;
  contentHash: string;
  artifactHash: string;
  /** Followed by the issuer's name. */
  record: string;
  documentTitle: string;
  documentId: string;
  role: string;
  email: string;
  authentication: string;
  ip: string;
  userAgent: string;
  signatureRecorded: string;
  events: string;
  eventKinds: Readonly<Record<StandardEventKind, string>>;
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
  signatureRecorded: "Signature recorded",
  events: "Events",
  eventKinds: Object.freeze({ sent: "Sent", viewed: "Viewed", consented: "Consented", signed: "Signed", declined: "Declined", completed: "Completed" }),
});

export interface CompletionCertificateOptions extends ExecutedPdfOptions {
  /** The host's record, printed under its issuer's name. */
  record: CompletionRecord;
  /** Labels to use instead of the English defaults; any left out, or blank, stay English. */
  labels?: Partial<Omit<CertificateLabels, "eventKinds">> & { eventKinds?: Partial<Record<StandardEventKind, string>> };
}

/** A signature as checked: which field, whose role, what kind. When it was given is the host's record, printed there. */
export interface VerifiedSignature {
  fieldId: string;
  role: string;
  kind: string;
}

/** The certificate's checked section as data, to keep beside it. */
export interface VerifiedFacts {
  contentHash: string;
  artifactHash: string;
  signatures: VerifiedSignature[];
}

/** Why no certificate was issued, beyond why there is no executed document. */
export type CertificateRefusal =
  /** A field's kind is not one the editor setup knows: the certificate could not tell whether it is a signature. */
  | { reason: "unknown-field-kind"; kind: string }
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
  | { reason: "events-out-of-order"; event: CompletionEvent };

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
 * under the issuer's name, as the host's word. Both PDFs are printed with
 * `editorOptions`. Refuses rather than certify a record that disagrees with
 * the document or with time.
 */
export async function exportCompletionCertificate(
  snapshot: Pick<SealedSnapshot, "content" | "contentHash">,
  values: Readonly<Record<string, FieldValue>>,
  options: CompletionCertificateOptions,
): Promise<CompletionCertificateResult> {
  const { record, labels, ...executedOptions } = options;
  const printed = await printExecuted(snapshot, values, executedOptions);
  if (!printed.ok) return printed;
  const { print } = printed;

  const issued = certificateOf(snapshot.contentHash, print, record, labelsOf(labels));
  if ("reason" in issued) return { ok: false, refusal: issued };

  const { editorOptions, ...pdfOptions } = executedOptions;
  const editor = new Editor({ ...editorOptions, content: issued.content, sealed: true });
  try {
    const pdf = await exportToPdf(editor, pdfOptions);
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

/** A signature as the executed record printed it, its kind and its instant read once. */
interface Signature {
  field: SignerFieldDescriptor;
  spec: FieldKindSpec;
  value: Extract<FieldValue, { kind: "text" | "image" }>;
  signedAt: string;
  at: number;
}

interface TimedEvent {
  event: CompletionEvent;
  at: number;
}

/** The certificate's document and checked facts, or why it cannot be issued over this printing. */
function certificateOf(
  contentHash: string,
  print: ExecutedPrint,
  record: CompletionRecord,
  labels: CertificateLabels,
): { content: Record<string, unknown>; verified: VerifiedFacts } | CertificateRefusal {
  const { fields, kinds, onRecord } = print;
  const unknownKind = fields.find((f) => kinds[f.kind] === undefined);
  if (unknownKind) return { reason: "unknown-field-kind", kind: unknownKind.kind };

  const signatures = signaturesOf(print);
  if ("reason" in signatures) return signatures;
  const timeline = timelineOf(record.events);
  if ("reason" in timeline) return timeline;
  const refusal = checkParties(fields, onRecord, print.kinds, record) ?? checkOrder(timeline, signatures);
  if (refusal) return refusal;

  const verified: VerifiedFacts = {
    contentHash,
    artifactHash: print.artifactHash,
    signatures: signatures.map(({ field }) => ({ fieldId: field.id, role: field.role, kind: field.kind })),
  };
  return { content: certificateDocument(verified, signatures, print.drawings, record, timeline, labels), verified };
}

/** The signatures the record printed, each dated by its full `signedAt`. */
function signaturesOf({ fields, kinds, onRecord }: ExecutedPrint): Signature[] | CertificateRefusal {
  const signatures: Signature[] = [];
  for (const field of fields) {
    const value = onRecord[field.id];
    const spec = kinds[field.kind];
    if (!spec || !isSigningKind(kinds, field.kind) || !isFieldAnswered(field, value, kinds)) continue;
    // A signature line holds words or a drawing; anything else is no signature to show.
    if (value?.kind !== "text" && value?.kind !== "image") continue;
    if (value.signedAt === undefined) return { reason: "undated-signature", fieldId: field.id };
    const at = instantOf(value.signedAt);
    if (at === null) return { reason: "unzoned-time", at: value.signedAt };
    signatures.push({ field, spec, value, signedAt: value.signedAt, at });
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
  return moment?.clock == null ? null : moment.at;
}

/** The events by time — ties in the host's order — or the first whose time is not an instant. */
function timelineOf(events: readonly CompletionEvent[]): TimedEvent[] | CertificateRefusal {
  const timed: TimedEvent[] = [];
  for (const event of events) {
    const at = instantOf(event.at);
    if (at === null) return { reason: "unzoned-time", at: event.at };
    timed.push({ event, at });
  }
  return timed.sort((a, b) => a.at - b.at);
}

/** Every role that answered or must answer a field has a party, and every event names one. */
function checkParties(
  fields: readonly SignerFieldDescriptor[],
  onRecord: Readonly<Record<string, FieldValue>>,
  kinds: ExecutedPrint["kinds"],
  record: CompletionRecord,
): CertificateRefusal | null {
  const parties = new Set(record.parties.map((p) => p.role));
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
  for (const { field, at } of signatures) noteSigning(field.role, at);
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
  const late = signatures.find(({ at }) => at > completed.at);
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
  const e = overrides.eventKinds ?? {};
  const pick = (value: string | undefined, fallback: string): string => given(value) ?? fallback;
  return {
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
    signatureRecorded: pick(o.signatureRecorded, d.signatureRecorded),
    events: pick(o.events, d.events),
    eventKinds: {
      sent: pick(e.sent, d.eventKinds.sent),
      viewed: pick(e.viewed, d.eventKinds.viewed),
      consented: pick(e.consented, d.eventKinds.consented),
      signed: pick(e.signed, d.eventKinds.signed),
      declined: pick(e.declined, d.eventKinds.declined),
      completed: pick(e.completed, d.eventKinds.completed),
    },
  };
}

/** An instant as a reader reads it in UTC: `2026-11-14 22:30:00 UTC`. */
const readableUtc = (at: number): string => `${new Date(at).toISOString().slice(0, 19).replace("T", " ")} UTC`;

/** A full `signedAt` as its signer gave it, in their own offset: `2026-11-15 01:30:00 (UTC+03:00)`. */
function asSigned(signedAt: string): string {
  const moment = readSigningMoment(signedAt);
  return moment ? `${moment.day} ${moment.clock ?? ""} (UTC${moment.zone ?? ""})` : signedAt;
}

function certificateDocument(
  verified: VerifiedFacts,
  signatures: readonly Signature[],
  drawings: ExecutedPrint["drawings"],
  record: CompletionRecord,
  timeline: readonly TimedEvent[],
  labels: CertificateLabels,
): Record<string, unknown> {
  const nameOf = (role: string): string => given(record.parties.find((p) => p.role === role)?.name) ?? role;

  // Headed by kind and role, never a person: a name is the host's word, kept to the record.
  const signatureBlocks = signatures.flatMap(({ field, spec, value }): DocumentBlock[] => {
    const size = drawings.get(field.id);
    return [
      { title: `${spec.label} — ${field.role}`, level: 3 },
      value.kind === "image" ? { image: value.src, ...(size ? containedSize(size, spec.size) : spec.size) } : { paragraph: value.text },
    ];
  });

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
      .map(({ spec, signedAt, at }): DocumentBlock => ({ label: `${labels.signatureRecorded} (${spec.label})`, value: `${asSigned(signedAt)} · ${readableUtc(at)}` })),
  ]);

  const eventBlocks = timeline.map(({ event, at }): DocumentBlock => {
    const what = event.kind === "custom" ? event.label : labels.eventKinds[event.kind];
    const who = event.party === undefined ? "" : ` — ${nameOf(event.party)}`;
    return { paragraph: `${readableUtc(at)} — ${what}${who}` };
  });

  const title = given(record.title);
  const documentId = given(record.documentId);
  return documentFromBlocks([
    { title: labels.title, level: 1 },
    { title: labels.verified, level: 2 },
    { paragraph: labels.verifiedNote },
    { label: labels.contentHash, value: verified.contentHash },
    { label: labels.artifactHash, value: verified.artifactHash },
    ...signatureBlocks,
    { title: `${labels.record} ${record.issuer}`.trim(), level: 2 },
    ...(title === null ? [] : [{ label: labels.documentTitle, value: title }]),
    ...(documentId === null ? [] : [{ label: labels.documentId, value: documentId }]),
    ...partyBlocks,
    { title: labels.events, level: 3 },
    ...eventBlocks,
  ]);
}
