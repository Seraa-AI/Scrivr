import { ServerEditor } from "../ServerEditor";
import type { Extension } from "../extensions/Extension";
import { flattenExtensions } from "../extensions/ExtensionManager";
import {
  Field,
  fieldKindsOf,
  isFieldAnswered,
  listSignerFields,
  replaceFieldValues,
  valuesOnRecordOf,
  type SignerFieldDescriptor,
} from "../extensions/built-in/Field";
import { isSigningKind, parseSignedAt, type FieldKinds, type FieldKindSpec, type FieldValue } from "../extensions/built-in/fieldKinds";
import { drawingSize } from "../model/drawingSize";
import { hashArtifact, snapshotDocument, verifySnapshot, type SealedSnapshot } from "./snapshot";

/** The steps a certificate labels itself; whether a party saw the document before signing, and when it completed, are checked. */
export type StandardEventKind = "sent" | "viewed" | "consented" | "signed" | "declined" | "completed";

/** One line of the host's record: when, what, and whose. A `custom` step is the host's own, shown by its label. */
export type CompletionEvent =
  | { at: string; kind: StandardEventKind; party?: string }
  | { at: string; kind: "custom"; label: string; party?: string };

/**
 * A party as the host identified them. Only `role` and `name` are needed;
 * nothing absent is printed. A party whose role carries no field — someone
 * sent a copy — is listed like any other.
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

/** Every heading and label on a certificate, so a host can issue it in its signers' language. */
export interface CertificateLabels {
  title: string;
  verified: string;
  verifiedNote: string;
  contentHash: string;
  artifactHash: string;
  signed: string;
  /** Followed by the issuer's name. */
  record: string;
  documentTitle: string;
  documentId: string;
  role: string;
  email: string;
  authentication: string;
  ip: string;
  userAgent: string;
  events: string;
  eventKinds: Readonly<Record<StandardEventKind, string>>;
}

/** The English labels a certificate uses unless given others — a base to spread for a full translation. */
export const DEFAULT_CERTIFICATE_LABELS: Readonly<CertificateLabels> = Object.freeze({
  title: "Certificate of completion",
  verified: "Verified at issue",
  verifiedNote:
    "Checked when this certificate was issued: the agreed content against its hash, and each signature as the executed document printed it — the document with the hash below.",
  contentHash: "Agreed content (SHA-256)",
  artifactHash: "Executed document (SHA-256)",
  signed: "Signed",
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

/** What a certificate is issued from. */
export interface CertificateInput {
  /** The sealed snapshot the signing was over; its fields are read from its verified content. */
  snapshot: Pick<SealedSnapshot, "content" | "contentHash">;
  /**
   * The executed PDF as `exportExecutedPdf` returned it: its bytes, hashed
   * here, and the values it printed. Taken together, so the signatures a
   * certificate shows are the ones that document holds.
   */
  executed: { pdf: Uint8Array; values: Readonly<Record<string, FieldValue>> };
  /** The host's record, printed under its issuer's name. */
  record: CompletionRecord;
  /** The setup the executed PDF was printed with: `Field` with the same kinds and date format. */
  extensions: Extension[];
  /** Labels to use instead of the English defaults; any left out stay English. */
  labels?: Partial<Omit<CertificateLabels, "eventKinds">> & { eventKinds?: Partial<Record<StandardEventKind, string>> };
}

/** A signature as checked: whose, and when — as given, and in UTC. */
export interface VerifiedSignature {
  fieldId: string;
  role: string;
  kind: string;
  signedAt: string;
  utc: string;
}

/** The certificate's checked section as data, to keep beside it. */
export interface VerifiedFacts {
  contentHash: string;
  artifactHash: string;
  signatures: VerifiedSignature[];
}

/** Why no certificate was issued. */
export type CertificateRefusal =
  | { reason: "snapshot-altered" }
  /** Not complete: required fields the executed record printed blank. */
  | { reason: "unanswered-fields"; missing: SignerFieldDescriptor[] }
  /** An event names a role no party in the record plays. */
  | { reason: "unknown-party"; role: string }
  /** A role that answered or must answer a field has no party in the record. */
  | { reason: "missing-party"; role: string }
  /** A time that is not an instant with a zone — a bare day included: the certificate would have to invent the moment. */
  | { reason: "unzoned-time"; at: string }
  /** A signature with no `signedAt`: the certificate could not say when it was given. */
  | { reason: "undated-signature"; fieldId: string }
  | { reason: "signed-after-completed"; fieldId: string }
  /** A party first sent, viewing or consenting only after it signed, or a signing recorded after completion. */
  | { reason: "events-out-of-order"; event: CompletionEvent };

/** A certificate, ready to show in a viewer or print with `exportCompletionCertificate`. */
export interface CompletionCertificate {
  /** The certificate as a document's JSON, built from StarterKit's nodes. */
  content: Record<string, unknown>;
  verified: VerifiedFacts;
}

/** A certificate, or why none was issued — an answer the host shows someone, not an exception. */
export type CertificateResult = { ok: true; certificate: CompletionCertificate } | { ok: false; refusal: CertificateRefusal };

/**
 * A certificate of completion for a signing, as a document. Its first section
 * holds only what was checked in this call — the snapshot against its hash,
 * the executed PDF's bytes hashed, every signature it printed with its time —
 * and the host's record follows under the issuer's name, printed as given.
 *
 * Reads the fields and the values on record as `exportExecutedPdf` does: from
 * the verified content, in an editor with the signers' extensions, holding
 * the values that PDF printed — so what is checked complete is what printed.
 * Refuses rather than certify an altered snapshot, an incomplete signing, or
 * a record that disagrees with the document or with time. Throws when
 * `Field` is not among `extensions`.
 */
export async function buildCompletionCertificate(input: CertificateInput): Promise<CertificateResult> {
  const { snapshot, executed, record } = input;
  if (!(await verifySnapshot(snapshot.content, snapshot.contentHash))) return refuse({ reason: "snapshot-altered" });
  // Matched by name, as the extension manager identifies extensions.
  if (!flattenExtensions(input.extensions).some((extension) => extension.name === Field.name)) {
    throw new Error("buildCompletionCertificate needs Field among extensions: only Field reads a field or holds its value");
  }

  const editor = new ServerEditor({ extensions: input.extensions, content: snapshotDocument(snapshot.content), sealed: true });
  try {
    if (!replaceFieldValues(editor, executed.values)) throw new Error("buildCompletionCertificate could not hold the field values: a plugin refused them");
    const kinds = fieldKindsOf(editor);
    const fields = listSignerFields(editor.getState().doc);
    const onRecord = valuesOnRecordOf(editor);

    const missing = fields.filter((f) => f.required && !isFieldAnswered(f, onRecord[f.id], kinds));
    if (missing.length > 0) return refuse({ reason: "unanswered-fields", missing });

    const signatures: Signature[] = [];
    for (const f of fields) {
      const value = onRecord[f.id];
      const spec = kinds[f.kind];
      if (!spec || !isSigningKind(kinds, f.kind) || !isFieldAnswered(f, value, kinds)) continue;
      if (value?.kind !== "text" && value?.kind !== "image") continue;
      if (value.signedAt === undefined) return refuse({ reason: "undated-signature", fieldId: f.id });
      const at = instantOf(value.signedAt);
      if (at === null) return refuse({ reason: "unzoned-time", at: value.signedAt });
      signatures.push({ field: f, spec, value, signedAt: value.signedAt, at });
    }

    const timeline = timelineOf(record.events);
    if ("reason" in timeline) return refuse(timeline);
    const recordRefusal = checkParties(fields, onRecord, kinds, record) ?? checkOrder(timeline, signatures);
    if (recordRefusal) return refuse(recordRefusal);

    const verified: VerifiedFacts = {
      contentHash: snapshot.contentHash,
      artifactHash: await hashArtifact(executed.pdf),
      signatures: signatures.map(({ field, signedAt, at }) => ({ fieldId: field.id, role: field.role, kind: field.kind, signedAt, utc: isoUtc(at) })),
    };
    return { ok: true, certificate: { content: certificateDocument(verified, signatures, record, timeline, labelsOf(input.labels)), verified } };
  } finally {
    editor.destroy();
  }
}

/** A signature found answered on record, its kind and its instant read once. */
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

const refuse = (refusal: CertificateRefusal): CertificateResult => ({ ok: false, refusal });

/**
 * The instant a time names, or `null` unless it is a full timestamp with a
 * zone. A bare day is refused too: printing it, or ordering by it, would
 * stand an invented midnight in for the moment.
 */
const instantOf = (at: string): number | null => (at.includes("T") ? parseSignedAt(at) : null);

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

/** Every event names a party in the record, and every role that answered or must answer a field has one. */
function checkParties(
  fields: readonly SignerFieldDescriptor[],
  onRecord: Readonly<Record<string, FieldValue>>,
  kinds: FieldKinds,
  record: CompletionRecord,
): CertificateRefusal | null {
  const parties = new Set(record.parties.map((p) => p.role));
  const unrepresented = fields.find((f) => (f.required || isFieldAnswered(f, onRecord[f.id], kinds)) && !parties.has(f.role));
  if (unrepresented) return { reason: "missing-party", role: unrepresented.role };
  const unknown = record.events.find((e) => e.party !== undefined && !parties.has(e.party));
  return unknown?.party !== undefined ? { reason: "unknown-party", role: unknown.party } : null;
}

/** The events by which a party first comes to the document: one of them, when recorded, comes before its first signing. */
const COMES_TO_THE_DOCUMENT: ReadonlySet<StandardEventKind | "custom"> = new Set(["sent", "viewed", "consented"]);

/**
 * A party comes to the document before it signs — its first signing being
 * the earlier of its checked signatures and the host's `signed` events — and
 * nothing is signed after completion. Views after signing, or after
 * completion, are what signing tools record, and pass.
 */
function checkOrder(timeline: readonly TimedEvent[], signatures: readonly Signature[]): CertificateRefusal | null {
  const firstSigning = new Map<string, number>();
  const signedAt = (party: string, at: number) => firstSigning.set(party, Math.min(at, firstSigning.get(party) ?? Infinity));
  for (const { field, at } of signatures) signedAt(field.role, at);
  for (const { event, at } of timeline) if (event.kind === "signed" && event.party !== undefined) signedAt(event.party, at);

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

function labelsOf(overrides: CertificateInput["labels"]): CertificateLabels {
  const { eventKinds, ...rest } = overrides ?? {};
  return { ...DEFAULT_CERTIFICATE_LABELS, ...rest, eventKinds: { ...DEFAULT_CERTIFICATE_LABELS.eventKinds, ...eventKinds } };
}

/** An instant as ISO 8601 in UTC, to the second. */
const isoUtc = (at: number): string => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");

/** An instant as a reader reads it in UTC: `2026-11-14 22:30:00 UTC`. */
const readableUtc = (at: number): string => `${isoUtc(at).replace("T", " ").replace("Z", "")} UTC`;

/** A full `signedAt` as its signer gave it, in their own offset: `2026-11-15 01:30:00 (UTC+03:00)`. */
function asSigned(signedAt: string): string {
  const [day = "", time = ""] = signedAt.split("T");
  const zone = /(Z|[+-]\d{2}:\d{2})$/.exec(time)?.[0] ?? "";
  return `${day} ${time.slice(0, time.length - zone.length)} (UTC${zone === "Z" ? "+00:00" : zone})`;
}

/**
 * A drawing's size in `box`, keeping its own proportions — as the canvas and
 * the executed PDF fit it. The box itself when its size cannot be read.
 */
function fitted(src: string, box: { width: number; height: number }): { width: number; height: number } {
  const own = drawingSize(src);
  if (!own) return box;
  const scale = Math.min(box.width / own.width, box.height / own.height);
  return { width: own.width * scale, height: own.height * scale };
}

// ── The document ─────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const text = (words: string, bold = false): Json => ({ type: "text", text: words, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const heading = (level: number, words: string): Json => ({ type: "heading", attrs: { level }, content: [text(words)] });
const paragraph = (...content: Json[]): Json => ({ type: "paragraph", content });
const line = (label: string, value: string): Json => paragraph(text(`${label}: `, true), text(value));

function certificateDocument(
  verified: VerifiedFacts,
  signatures: readonly Signature[],
  record: CompletionRecord,
  timeline: readonly TimedEvent[],
  labels: CertificateLabels,
): Json {
  const nameOf = (role: string): string => record.parties.find((p) => p.role === role)?.name ?? role;

  // Headed by kind and role, never a person: a name is the host's word, kept to the record.
  const signatureBlocks = signatures.flatMap(({ field, spec, value, signedAt, at }) => [
    heading(3, `${spec.label} — ${field.role}`),
    value.kind === "image"
      ? paragraph({ type: "image", attrs: { src: value.src, ...fitted(value.src, spec.size) } })
      : paragraph(text(value.text)),
    line(labels.signed, `${asSigned(signedAt)} · ${readableUtc(at)}`),
  ]);

  const partyBlocks = record.parties.flatMap((party) => [
    heading(3, party.name),
    line(labels.role, party.role),
    ...([
      [labels.email, party.email],
      [labels.authentication, party.authentication],
      [labels.ip, party.ip],
      [labels.userAgent, party.userAgent],
    ] satisfies Array<[string, string | undefined]>).flatMap(([label, value]) => (value === undefined ? [] : [line(label, value)])),
  ]);

  const eventLines = timeline.map(({ event, at }) => {
    const what = event.kind === "custom" ? event.label : labels.eventKinds[event.kind];
    const who = event.party === undefined ? "" : ` — ${nameOf(event.party)}`;
    return paragraph(text(`${readableUtc(at)} — ${what}${who}`));
  });

  return {
    type: "doc",
    content: [
      heading(1, labels.title),
      heading(2, labels.verified),
      paragraph(text(labels.verifiedNote)),
      line(labels.contentHash, verified.contentHash),
      line(labels.artifactHash, verified.artifactHash),
      ...signatureBlocks,
      heading(2, `${labels.record} ${record.issuer}`),
      ...(record.title === undefined ? [] : [line(labels.documentTitle, record.title)]),
      ...(record.documentId === undefined ? [] : [line(labels.documentId, record.documentId)]),
      ...partyBlocks,
      heading(3, labels.events),
      ...eventLines,
    ],
  };
}
