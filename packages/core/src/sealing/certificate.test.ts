/**
 * The certificate of completion: what Scrivr checked against the document
 * when it was issued, kept apart from the host's own record of the signing.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { Field } from "../extensions/built-in/Field";
import { BUILT_IN_FIELD_KINDS, type FieldValue } from "../extensions/built-in/fieldKinds";
import { createSnapshot, hashArtifact } from "./snapshot";
// Through the package barrel: what a host imports.
import {
  DEFAULT_CERTIFICATE_LABELS,
  buildCompletionCertificate,
  type CertificateInput,
  type CertificateLabels,
  type CertificateRefusal,
  type CertificateResult,
  type CompletionCertificate,
  type CompletionEvent,
  type CompletionParty,
  type CompletionRecord,
  type StandardEventKind,
  type VerifiedFacts,
  type VerifiedSignature,
} from "../index";

const field = (id: string, role: string, kind: string, required = true) => ({
  type: "field",
  attrs: { nodeId: id, kind, fill: "signer", role, required },
});

const contract = new ServerEditor({
  extensions: [StarterKit, Field],
  content: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Terms." }] },
      { type: "paragraph", content: [field("client-sig", "client", "signature"), field("client-date", "client", "dateSigned")] },
      { type: "paragraph", content: [field("vendor-sig", "vendor", "signature")] },
    ],
  },
}).getState().doc;

const drawing = "data:image/png;base64,iVBORw0KGgo=";
const executedPdf = new TextEncoder().encode("%PDF-1.7 the executed record");

const signed: Record<string, FieldValue> = {
  "client-sig": { kind: "image", src: drawing, signedAt: "2026-11-15T01:30:00+03:00" },
  "vendor-sig": { kind: "text", text: "Grace Hopper", signedAt: "2026-11-15T09:00:00Z" },
};

const record = (overrides: Partial<CompletionRecord> = {}): CompletionRecord => ({
  documentId: "AGR-2026-0042",
  title: "Master Services Agreement",
  issuer: "Acme Sign",
  parties: [
    { role: "client", name: "Ada Lovelace", email: "ada@example.com", authentication: "Email code", ip: "203.0.113.7" },
    { role: "vendor", name: "Grace Hopper" },
  ],
  events: [
    { at: "2026-11-14T20:00:00Z", kind: "sent", party: "client" },
    { at: "2026-11-14T20:00:00Z", kind: "sent", party: "vendor" },
    { at: "2026-11-14T21:00:00Z", kind: "custom", label: "Identity verified", party: "client" },
    { at: "2026-11-15T01:29:00+03:00", kind: "signed", party: "client" },
    { at: "2026-11-15T09:00:00Z", kind: "signed", party: "vendor" },
    { at: "2026-11-15T09:00:05Z", kind: "completed" },
  ],
  ...overrides,
});

/** The executed PDF as `exportExecutedPdf` returns it: its bytes, and the values it printed. */
const printed = (values: Record<string, FieldValue>) => ({ pdf: executedPdf, values });

async function input(overrides: Partial<CertificateInput> = {}): Promise<CertificateInput> {
  const sealed = await createSnapshot(contract, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client", "vendor"] });
  if (!sealed.ok) throw new Error(`refused: ${sealed.refusal.reason}`);
  return { snapshot: sealed.snapshot, executed: printed(signed), record: record(), extensions: [StarterKit, Field], ...overrides };
}

async function issued(overrides: Partial<CertificateInput> = {}) {
  const result = await buildCompletionCertificate(await input(overrides));
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  return result.certificate;
}

/** The certificate's top-level blocks as the words they read. */
const linesOf = (content: unknown): string[] => {
  const textOf = (node: unknown): string => {
    if (typeof node !== "object" || node === null) return "";
    if ("text" in node && typeof node.text === "string") return node.text;
    return "content" in node && Array.isArray(node.content) ? node.content.map(textOf).join("") : "";
  };
  return typeof content === "object" && content !== null && "content" in content && Array.isArray(content.content)
    ? content.content.map(textOf)
    : [];
};

/** The lines between a heading and the next heading of the same words' section. */
const section = (lines: string[], from: string, to: string): string[] => lines.slice(lines.indexOf(from), lines.indexOf(to));

describe("buildCompletionCertificate", () => {
  it("states the hashes it checked: the agreed content's, and the executed document's as given", async () => {
    const certificate = await issued();
    const { snapshot } = await input();

    expect(certificate.verified.contentHash).toBe(snapshot.contentHash);
    expect(certificate.verified.artifactHash).toBe(await hashArtifact(executedPdf));
    const verified = section(linesOf(certificate.content), "Verified at issue", "Signing record — as recorded by Acme Sign");
    expect(verified.join("\n")).toContain(snapshot.contentHash);
    expect(verified.join("\n")).toContain(await hashArtifact(executedPdf));
  });

  it("lists each signature from the values the record printed, with when it was given", async () => {
    const { verified } = await issued();

    expect(verified.signatures).toEqual([
      { fieldId: "client-sig", role: "client", kind: "signature", signedAt: "2026-11-15T01:30:00+03:00", utc: "2026-11-14T22:30:00Z" },
      { fieldId: "vendor-sig", role: "vendor", kind: "signature", signedAt: "2026-11-15T09:00:00Z", utc: "2026-11-15T09:00:00Z" },
    ]);
  });

  it("shows a signature on the day its signer signed, the day the date-signed field printed, and in UTC", async () => {
    const lines = linesOf((await issued()).content).join("\n");

    // 01:30 at +03:00 is still the 14th in UTC; the signer's day is the 15th.
    expect(lines).toContain("2026-11-15 01:30:00 (UTC+03:00)");
    expect(lines).toContain("2026-11-14 22:30:00 UTC");
  });

  it("reprints a drawn signature as its drawing, and a typed one as its words", async () => {
    const { content } = await issued();
    const json = JSON.stringify(content);

    expect(json).toContain(drawing);
    expect(linesOf(content).join("\n")).toContain("Grace Hopper");
  });

  it("keeps everything the host supplied out of what was verified", async () => {
    const lines = linesOf((await issued()).content);
    const verified = section(lines, "Verified at issue", "Signing record — as recorded by Acme Sign").join("\n");

    for (const hostFact of ["ada@example.com", "203.0.113.7", "Email code", "Identity verified"]) {
      expect(verified).not.toContain(hostFact);
      expect(lines.join("\n")).toContain(hostFact);
    }
  });

  it("prints only what the host gave: no blank lines for a party's missing details", async () => {
    const lines = linesOf((await issued()).content);
    // The party's own block: from its heading in the record to the events.
    const vendor = lines.slice(lines.lastIndexOf("Grace Hopper"), lines.indexOf("Events"));

    expect(vendor.some((line) => line.startsWith("Email"))).toBe(false);
    expect(vendor.some((line) => line.startsWith("IP address"))).toBe(false);
  });

  it("lists the events in the order they happened, each in UTC, a host's own step by its label", async () => {
    const lines = linesOf((await issued()).content);
    const events = lines.filter((line) => / UTC — /.test(line));

    expect(events).toEqual([
      "2026-11-14 20:00:00 UTC — Sent — Ada Lovelace",
      "2026-11-14 20:00:00 UTC — Sent — Grace Hopper",
      "2026-11-14 21:00:00 UTC — Identity verified — Ada Lovelace",
      "2026-11-14 22:29:00 UTC — Signed — Ada Lovelace",
      "2026-11-15 09:00:00 UTC — Signed — Grace Hopper",
      "2026-11-15 09:00:05 UTC — Completed",
    ]);
  });

  it("takes a record as signing tools keep one: a party viewing again after signing, a copy viewed after completion", async () => {
    const events: CompletionEvent[] = [
      ...record().events,
      { at: "2026-11-15T08:00:00Z", kind: "viewed", party: "client" },
      { at: "2026-11-16T10:00:00Z", kind: "viewed", party: "vendor" },
    ];
    expect((await issued({ record: record({ events }) })).verified.signatures).toHaveLength(2);
  });

  it("lists a party with no fields of their own — a copy sent to someone who does not sign", async () => {
    const parties: CompletionParty[] = [...record().parties, { role: "cc", name: "Legal team", email: "legal@example.com" }];
    const events: CompletionEvent[] = [{ at: "2026-11-14T20:00:00Z", kind: "sent", party: "cc" }, ...record().events];
    const lines = linesOf((await issued({ record: record({ parties, events }) })).content);

    expect(lines).toContain("Legal team");
    expect(lines).toContain("2026-11-14 20:00:00 UTC — Sent — Legal team");
  });

  it("speaks the host's language when given its labels", async () => {
    const lines = linesOf((await issued({ labels: { title: "Certificat d'achèvement", verified: "Vérifié à l'émission" } })).content);

    expect(lines).toContain("Certificat d'achèvement");
    expect(lines).toContain("Vérifié à l'émission");
  });
});

describe("buildCompletionCertificate refuses", () => {
  const refusal = async (overrides: Partial<CertificateInput>) => {
    const result = await buildCompletionCertificate(await input(overrides));
    return result.ok ? null : result.refusal;
  };

  it("a snapshot that no longer matches its hash", async () => {
    const { snapshot } = await input();
    expect(await refusal({ snapshot: { ...snapshot, content: snapshot.content.replace("Terms.", "Terms!") } })).toEqual({ reason: "snapshot-altered" });
  });

  it("a signing that is not complete", async () => {
    const client = signed["client-sig"];
    if (!client) throw new Error("no client signature");
    const result = await refusal({ executed: printed({ "client-sig": client }) });
    expect(result?.reason).toBe("unanswered-fields");
    expect(result?.reason === "unanswered-fields" && result.missing.map((f) => f.id)).toEqual(["vendor-sig"]);
  });

  it("an event naming a role no party plays", async () => {
    const events: CompletionEvent[] = [...record().events.slice(0, -1), { at: "2026-11-15T09:00:01Z", kind: "viewed", party: "notary" }, ...record().events.slice(-1)];
    expect(await refusal({ record: record({ events }) })).toEqual({ reason: "unknown-party", role: "notary" });
  });

  it("a role with fields and no party", async () => {
    const parties = record().parties.filter((p) => p.role !== "vendor");
    expect(await refusal({ record: record({ parties }) })).toEqual({ reason: "missing-party", role: "vendor" });
  });

  it("an event whose time names no zone", async () => {
    const events: CompletionEvent[] = [{ at: "2026-11-14T20:00:00", kind: "sent", party: "client" }, ...record().events.slice(1)];
    expect(await refusal({ record: record({ events }) })).toEqual({ reason: "unzoned-time", at: "2026-11-14T20:00:00" });
  });

  it("a signature dated with a day and no time — the certificate would invent the instant", async () => {
    const vendor: FieldValue = { kind: "text", text: "Grace Hopper", signedAt: "2026-11-15" };
    expect(await refusal({ executed: printed({ ...signed, "vendor-sig": vendor }) })).toEqual({ reason: "unzoned-time", at: "2026-11-15" });
  });

  it("a signature with no time given", async () => {
    const vendor: FieldValue = { kind: "text", text: "Grace Hopper" };
    const values = { ...signed, "vendor-sig": vendor };
    expect(await refusal({ executed: printed(values) })).toEqual({ reason: "undated-signature", fieldId: "vendor-sig" });
  });

  it("a signature given after the signing was completed", async () => {
    const vendor: FieldValue = { kind: "text", text: "Grace Hopper", signedAt: "2026-11-15T10:00:00Z" };
    const values = { ...signed, "vendor-sig": vendor };
    expect(await refusal({ executed: printed(values) })).toEqual({ reason: "signed-after-completed", fieldId: "vendor-sig" });
  });

  it("a party whose first sight of the document comes after they signed it", async () => {
    // The record says the client first saw it hours after the signature Scrivr checked.
    const events: CompletionEvent[] = [
      { at: "2026-11-15T08:00:00Z", kind: "sent", party: "client" },
      { at: "2026-11-15T09:00:00Z", kind: "signed", party: "vendor" },
      { at: "2026-11-15T09:00:05Z", kind: "completed" },
    ];
    expect(await refusal({ record: record({ events }) })).toEqual({ reason: "events-out-of-order", event: events[0] });
  });

  it("a signing recorded after completion", async () => {
    const events: CompletionEvent[] = [...record().events, { at: "2026-11-16T00:00:00Z", kind: "signed", party: "vendor" }];
    expect(await refusal({ record: record({ events }) })).toEqual({ reason: "events-out-of-order", event: events.at(-1) });
  });
});

describe("the certificate's contract", () => {
  it("keeps its default labels as they are: a host overrides them per certificate, never for everyone", () => {
    expect(Object.isFrozen(DEFAULT_CERTIFICATE_LABELS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CERTIFICATE_LABELS.eventKinds)).toBe(true);
  });

  it("names every shape a host handles, through the package", async () => {
    const result: CertificateResult = await buildCompletionCertificate(await input());
    if (!result.ok) throw new Error("refused");
    const certificate: CompletionCertificate = result.certificate;
    const verified: VerifiedFacts = certificate.verified;
    const signature: VerifiedSignature | undefined = verified.signatures[0];
    const kind: StandardEventKind = "sent";
    const labels: CertificateLabels = DEFAULT_CERTIFICATE_LABELS;
    const refusal: CertificateRefusal = { reason: "snapshot-altered" };

    expect([signature?.role, labels.eventKinds[kind], refusal.reason]).toEqual(["client", "Sent", "snapshot-altered"]);
  });
});
