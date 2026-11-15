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
import { isSigningKind, parseSignedAt, signedAtOf, type FieldKinds, type FieldValue } from "../extensions/built-in/fieldKinds";
import { hashArtifact, verifySnapshot, type SealedSnapshot } from "./snapshot";

/** The steps every signing has, which a certificate orders and labels itself. */
export type StandardEventKind = "sent" | "viewed" | "consented" | "signed" | "declined" | "completed";

/** One line of the host's record: when, what, and whose. A `custom` step is the host's own, shown by its label. */
export type CompletionEvent =
  | { at: string; kind: StandardEventKind; party?: string }
  | { at: string; kind: "custom"; label: string; party?: string };

/** A party as the host identified them. Only `role` and `name` are needed; nothing absent is printed. */
export interface CompletionParty {
  /** The role the party completed fields for, as the snapshot's fields name it. */
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
  eventKinds: Record<StandardEventKind, string>;
}

export const DEFAULT_CERTIFICATE_LABELS: CertificateLabels = {
  title: "Certificate of completion",
  verified: "Verified at issue",
  verifiedNote: "Each line in this section was checked against the document when this certificate was issued.",
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
  eventKinds: { sent: "Sent", viewed: "Viewed", consented: "Consented", signed: "Signed", declined: "Declined", completed: "Completed" },
};

export interface CertificateInput {
  /** The sealed snapshot the signing was over; its fields are read from its verified content. */
  snapshot: Pick<SealedSnapshot, "content" | "contentHash">;
  /** The values the executed PDF printed. */
  values: Readonly<Record<string, FieldValue>>;
  /** The executed PDF's bytes — hashed here, so the certificate names the file it was given. */
  executed: Uint8Array;
  record: CompletionRecord;
  /** The setup the signers saw: `Field` with the same kinds and date format, as `exportExecutedPdf` was given. */
  extensions: Extension[];
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
  /** Not complete: required fields the executed record would print blank. */
  | { reason: "unanswered-fields"; missing: SignerFieldDescriptor[] }
  /** A party or an event names a role no field carries. */
  | { reason: "unknown-party"; role: string }
  /** A role with fields has no party in the record. */
  | { reason: "missing-party"; role: string }
  /** A time that is not an instant with a zone — read elsewhere, it would name another moment. */
  | { reason: "unzoned-time"; at: string }
  /** A signature with no `signedAt`: the certificate could not say when it was given. */
  | { reason: "undated-signature"; fieldId: string }
  | { reason: "signed-after-completed"; fieldId: string }
  /** A party's signing before they were sent or viewed it, or anything after completion. */
  | { reason: "events-out-of-order"; event: CompletionEvent };

/** A certificate as a Scrivr document, ready to show or print, with what it checked. */
export interface CompletionCertificate {
  content: Record<string, unknown>;
  verified: VerifiedFacts;
}

export type CertificateResult = { ok: true; certificate: CompletionCertificate } | { ok: false; refusal: CertificateRefusal };

/**
 * A certificate of completion for a signing, as a document. Its first section
 * holds only what was checked in this call — the snapshot against its hash,
 * the executed PDF's bytes hashed, every signature answered with its time —
 * and the host's record follows under the issuer's name, printed as given.
 *
 * Reads the fields and the values on record as `exportExecutedPdf` does: from
 * the verified content, in an editor with the signers' extensions, so what is
 * checked complete is what printed. Refuses rather than certify an altered
 * snapshot, an incomplete signing, or a record that disagrees with the
 * document or with time. Throws when `Field` is not among `extensions`.
 */
export async function buildCompletionCertificate(input: CertificateInput): Promise<CertificateResult> {
  const { snapshot, record } = input;
  if (!(await verifySnapshot(snapshot.content, snapshot.contentHash))) return refuse({ reason: "snapshot-altered" });
  // Matched by name, as the extension manager identifies extensions.
  if (!flattenExtensions(input.extensions).some((extension) => extension.name === Field.name)) {
    throw new Error("buildCompletionCertificate needs Field among extensions: only Field reads a field or holds its value");
  }

  const editor = new ServerEditor({ extensions: input.extensions, content: documentJson(snapshot.content), sealed: true });
  try {
    if (!replaceFieldValues(editor, { ...input.values })) throw new Error("buildCompletionCertificate could not hold the field values: a plugin refused them");
    const kinds = fieldKindsOf(editor);
    const fields = listSignerFields(editor.getState().doc);
    const onRecord = valuesOnRecordOf(editor);

    const missing = fields.filter((f) => f.required && !isFieldAnswered(f, onRecord[f.id], kinds));
    if (missing.length > 0) return refuse({ reason: "unanswered-fields", missing });

    const partyRefusal = checkParties(fields, onRecord, kinds, record);
    if (partyRefusal) return refuse(partyRefusal);

    const signatures: VerifiedSignature[] = [];
    for (const f of fields) {
      const value = onRecord[f.id];
      if (!isSigningKind(kinds, f.kind) || !isFieldAnswered(f, value, kinds)) continue;
      const given = value && "signedAt" in value ? value.signedAt : undefined;
      if (given === undefined) return refuse({ reason: "undated-signature", fieldId: f.id });
      const signedAt = signedAtOf(value);
      const at = signedAt === null ? null : parseSignedAt(signedAt);
      if (signedAt === null || at === null) return refuse({ reason: "unzoned-time", at: given });
      signatures.push({ fieldId: f.id, role: f.role, kind: f.kind, signedAt, utc: isoUtc(at) });
    }

    const timeline = timelineOf(record.events);
    if (!Array.isArray(timeline)) return refuse(timeline);
    const orderRefusal = checkOrder(timeline, signatures);
    if (orderRefusal) return refuse(orderRefusal);

    const verified: VerifiedFacts = { contentHash: snapshot.contentHash, artifactHash: await hashArtifact(input.executed), signatures };
    const labels = labelsOf(input.labels);
    return { ok: true, certificate: { content: certificateDocument(verified, onRecord, kinds, record, timeline, labels), verified } };
  } finally {
    editor.destroy();
  }
}

const refuse = (refusal: CertificateRefusal): CertificateResult => ({ ok: false, refusal });

/** Every party names a role the document carries, and every role that signed or must sign has a party. */
function checkParties(
  fields: readonly SignerFieldDescriptor[],
  onRecord: Readonly<Record<string, FieldValue>>,
  kinds: FieldKinds,
  record: CompletionRecord,
): CertificateRefusal | null {
  const roles = new Set(fields.map((f) => f.role));
  const named = [...record.parties.map((p) => p.role), ...record.events.flatMap((e) => (e.party === undefined ? [] : [e.party]))];
  const unknown = named.find((role) => !roles.has(role));
  if (unknown !== undefined) return { reason: "unknown-party", role: unknown };
  const parties = new Set(record.parties.map((p) => p.role));
  const unrepresented = fields.find((f) => (f.required || isFieldAnswered(f, onRecord[f.id], kinds)) && !parties.has(f.role));
  return unrepresented ? { reason: "missing-party", role: unrepresented.role } : null;
}

interface TimedEvent {
  event: CompletionEvent;
  at: number;
}

/** The events by time, or the first whose time is not an instant with a zone — a bare day is not one. */
function timelineOf(events: readonly CompletionEvent[]): TimedEvent[] | CertificateRefusal {
  const timed: TimedEvent[] = [];
  for (const event of events) {
    const at = event.at.includes("T") ? parseSignedAt(event.at) : null;
    if (at === null) return { reason: "unzoned-time", at: event.at };
    timed.push({ event, at });
  }
  return timed.sort((a, b) => a.at - b.at);
}

/** A party signs only after it was sent, viewed or consented to; nothing — no signature either — follows completion. */
function checkOrder(timeline: readonly TimedEvent[], signatures: readonly VerifiedSignature[]): CertificateRefusal | null {
  const firstSigned = new Map<string, number>();
  for (const { event, at } of timeline) {
    if (event.kind === "signed" && event.party !== undefined && !firstSigned.has(event.party)) firstSigned.set(event.party, at);
  }
  const before = ["sent", "viewed", "consented"];
  const early = timeline.find(({ event, at }) => before.includes(event.kind) && event.party !== undefined && at > (firstSigned.get(event.party) ?? Infinity));
  if (early) return { reason: "events-out-of-order", event: early.event };

  const completed = timeline.find(({ event }) => event.kind === "completed");
  if (!completed) return null;
  const after = timeline.find(({ at }) => at > completed.at);
  if (after) return { reason: "events-out-of-order", event: after.event };
  const late = signatures.find((s) => (parseSignedAt(s.signedAt) ?? -Infinity) > completed.at);
  return late ? { reason: "signed-after-completed", fieldId: late.fieldId } : null;
}

function labelsOf(overrides: CertificateInput["labels"]): CertificateLabels {
  const { eventKinds, ...rest } = overrides ?? {};
  return { ...DEFAULT_CERTIFICATE_LABELS, ...rest, eventKinds: { ...DEFAULT_CERTIFICATE_LABELS.eventKinds, ...eventKinds } };
}

/** An instant as ISO 8601 in UTC, to the second. */
const isoUtc = (at: number): string => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");

/** An instant as a reader reads it in UTC: `2026-11-14 22:30:00 UTC`. */
const readableUtc = (at: number): string => `${isoUtc(at).replace("T", " ").replace("Z", "")} UTC`;

/** A `signedAt` as its signer gave it, in their own offset: `2026-11-15 01:30:00 (UTC+03:00)`; a bare day as itself. */
function asSigned(signedAt: string): string {
  const [day, time] = signedAt.split("T");
  if (time === undefined) return signedAt;
  const zone = /(Z|[+-]\d{2}:\d{2})$/.exec(time)?.[0] ?? "Z";
  return `${day} ${time.slice(0, time.length - zone.length)} (UTC${zone === "Z" ? "+00:00" : zone})`;
}

// ── The document ─────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const text = (words: string, bold = false): Json => ({ type: "text", text: words, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const heading = (level: number, words: string): Json => ({ type: "heading", attrs: { level }, content: [text(words)] });
const paragraph = (...content: Json[]): Json => ({ type: "paragraph", content });
const line = (label: string, value: string): Json => paragraph(text(`${label}: `, true), text(value));

function certificateDocument(
  verified: VerifiedFacts,
  onRecord: Readonly<Record<string, FieldValue>>,
  kinds: FieldKinds,
  record: CompletionRecord,
  timeline: readonly TimedEvent[],
  labels: CertificateLabels,
): Json {
  const nameOf = (role: string): string => record.parties.find((p) => p.role === role)?.name ?? role;

  const signatureBlocks = verified.signatures.flatMap((signature) => {
    const value = onRecord[signature.fieldId];
    const kind = kinds[signature.kind];
    const shown =
      value?.kind === "image"
        ? paragraph({ type: "image", attrs: { src: value.src, width: kind?.size.width ?? 180, height: kind?.size.height ?? 44 } })
        : paragraph(text(value?.kind === "text" ? value.text : ""));
    const at = parseSignedAt(signature.signedAt) ?? 0;
    return [
      heading(3, `${kind?.label ?? signature.kind} — ${signature.role}`),
      shown,
      line(labels.signed, `${asSigned(signature.signedAt)} · ${readableUtc(at)}`),
    ];
  });

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

/** The snapshot's document object: copied, not cast — content is untrusted until parsed. */
function documentJson(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("A snapshot's content is a document object");
  return Object.fromEntries(Object.entries(parsed));
}
