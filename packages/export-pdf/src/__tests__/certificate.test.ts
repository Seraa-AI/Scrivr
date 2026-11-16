// @vitest-environment happy-dom
/**
 * The certificate of completion: issued with the executed PDF from one
 * printing, so it can only describe the document beside it — what Scrivr
 * checked, kept apart from the host's own record of the signing.
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import {
  BUILT_IN_FIELD_KINDS,
  Field,
  ServerEditor,
  StarterKit,
  TextMeasurer,
  createSnapshot,
  hashArtifact,
  type FieldValue,
  type SealedSnapshot,
  type TextMeasureContext,
} from "@scrivr/core";
// Through the package barrel: what a host imports.
import {
  DEFAULT_CERTIFICATE_LABELS,
  bundleCertificate,
  exportCompletionCertificate,
  type CertificateLabels,
  type CertificateRefusal,
  type CompletionCertificateOptions,
  type CompletionCertificateResult,
  type CompletionEvent,
  type CompletionParty,
  type CompletionRecord,
  type StandardEventKind,
  type VerifiedFacts,
  type VerifiedSignature,
} from "../index";
import { recordDrawOps } from "./opLog";

const measureContext = (ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext => ctx;
const measurer = () => new TextMeasurer({ lineHeightMultiplier: 1.2, context: measureContext(createCanvas(800, 600).getContext("2d")) });
/** A drawing as a signature pad gives one, `width × height`. */
const drawingOf = (width: number, height: number) => `data:image/png;base64,${createCanvas(width, height).toBuffer("image/png").toString("base64")}`;
/** Opens as a PNG, but is no image: the PDF cannot embed it. */
const brokenPng = "data:image/png;base64,iVBORw0KGgoAAAAAAAA";

const field = (id: string, role: string, kind: string, required = true) => ({ type: "field", attrs: { nodeId: id, kind, fill: "signer", role, required } });

let sealedOnce: Promise<SealedSnapshot> | null = null;
/** A client signature with its date signed, and a vendor signature — sealed for both. */
const sealed = (): Promise<SealedSnapshot> =>
  (sealedOnce ??= (async () => {
    const author = new ServerEditor({
      extensions: [StarterKit, Field],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Terms." }] },
          { type: "paragraph", content: [field("client-sig", "client", "signature"), field("client-date", "client", "dateSigned")] },
          { type: "paragraph", content: [field("vendor-sig", "vendor", "signature"), field("vendor-initials", "vendor", "initials", false)] },
        ],
      },
    });
    const result = await createSnapshot(author.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client", "vendor"] });
    if (!result.ok) throw new Error(result.refusal.reason);
    return result.snapshot;
  })());

const drawing = drawingOf(240, 80);
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

const options = (overrides: Partial<CompletionCertificateOptions> = {}): CompletionCertificateOptions => ({
  editorOptions: { extensions: [StarterKit, Field], textMeasurer: measurer() },
  record: record(),
  ...overrides,
});

async function issue(values: Record<string, FieldValue> = signed, overrides: Partial<CompletionCertificateOptions> = {}): Promise<CompletionCertificateResult> {
  return exportCompletionCertificate(await sealed(), values, options(overrides));
}

async function issued(values: Record<string, FieldValue> = signed, overrides: Partial<CompletionCertificateOptions> = {}) {
  const result = await issue(values, overrides);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  return result;
}

const refusalOf = async (values: Record<string, FieldValue> = signed, overrides: Partial<CompletionCertificateOptions> = {}) => {
  const result = await issue(values, overrides);
  return result.ok ? null : result.refusal;
};

/** The certificate's top-level blocks as the words they read. */
const linesOf = (content: unknown): string[] => {
  const textOf = (node: unknown): string => {
    if (typeof node !== "object" || node === null) return "";
    if ("text" in node && typeof node.text === "string") return node.text;
    return "content" in node && Array.isArray(node.content) ? node.content.map(textOf).join("") : "";
  };
  return typeof content === "object" && content !== null && "content" in content && Array.isArray(content.content) ? content.content.map(textOf) : [];
};

/** Every image node's attributes, in document order. */
const imagesOf = (node: unknown): Array<Record<string, unknown>> => {
  if (typeof node !== "object" || node === null) return [];
  const own =
    "type" in node && node.type === "image" && "attrs" in node && typeof node.attrs === "object" && node.attrs !== null
      ? [Object.fromEntries(Object.entries(node.attrs))]
      : [];
  return [...own, ...("content" in node && Array.isArray(node.content) ? node.content.flatMap(imagesOf) : [])];
};

const VERIFIED = "Verified at issue";
const RECORD = "Signing record — as recorded by Acme Sign";
const section = (lines: string[], from: string, to: string): string[] => lines.slice(lines.indexOf(from), lines.indexOf(to));

describe("exportCompletionCertificate", () => {
  it("issues the executed PDF and its certificate together, the certificate naming that PDF's hash", async () => {
    const { executed, certificate } = await issued();

    expect(executed.artifactHash).toBe(await hashArtifact(executed.pdf));
    expect(certificate.certificateHash).toBe(await hashArtifact(certificate.pdf));
    expect(certificate.verified.contentHash).toBe((await sealed()).contentHash);
    expect(certificate.verified.artifactHash).toBe(executed.artifactHash);
    const verified = section(linesOf(certificate.content), VERIFIED, RECORD).join("\n");
    expect(verified).toContain(certificate.verified.contentHash);
    expect(verified).toContain(executed.artifactHash);
  });

  it("prints its hashes and the drawn signature", async () => {
    let result: CompletionCertificateResult | undefined;
    const ops = await recordDrawOps(async () => {
      result = await issue();
    });
    if (!result?.ok) throw new Error("refused");
    // A hash may be broken across lines: read the words as printed, joined.
    const words = ops.filter((op) => op.op === "text").map((op) => String(op["value"])).join("");
    expect(words).toContain(result.certificate.verified.artifactHash);
    expect(ops.filter((op) => op.op === "image").length).toBeGreaterThanOrEqual(2);
  });

  it("lists each signature the executed PDF printed, by field, role and kind", async () => {
    const { certificate } = await issued();

    expect(certificate.verified.signatures).toEqual([
      { fieldId: "client-sig", role: "client", kind: "signature" },
      { fieldId: "vendor-sig", role: "vendor", kind: "signature" },
    ]);
  });

  it("shows no signature the executed PDF did not print: a drawing it could not embed is not there", async () => {
    const broken: FieldValue = { kind: "image", src: brokenPng, signedAt: "2026-11-15T09:00:00Z" };
    const values = { ...signed, "vendor-initials": broken };
    const { certificate } = await issued(values);

    expect(imagesOf(certificate.content).map((image) => image["src"])).toEqual([drawing]);
  });

  it("shows a drawn signature in its own proportions, fitted to its box as the executed PDF fits it", async () => {
    // A 3:1 drawing in the 180×44 signature box: 44 high sets the scale, so 132 × 44.
    const image = imagesOf((await issued()).certificate.content)[0];

    expect(image?.["width"]).toBeCloseTo(132, 6);
    expect(image?.["height"]).toBeCloseTo(44, 6);
  });

  it("keeps when each signature was given to the host's record, beside its party — the PDF never prints it", async () => {
    const lines = linesOf((await issued()).certificate.content);
    const verified = section(lines, VERIFIED, RECORD).join("\n");

    expect(verified).not.toContain("2026-11-15 01:30:00");
    // 01:30 at +03:00 is still the 14th in UTC; the signer's day is the 15th.
    expect(lines).toContain("Signature recorded (Signature): 2026-11-15 01:30:00 (UTC+03:00) · 2026-11-14 22:30:00 UTC");
  });

  it("records a signature on the day the executed PDF's date-signed field prints", async () => {
    let result: CompletionCertificateResult | undefined;
    const ops = await recordDrawOps(async () => {
      result = await issue();
    });
    if (!result?.ok) throw new Error("refused");
    const printed = ops.filter((op) => op.op === "text").map((op) => String(op["value"])).join(" ");

    // The executed PDF's date signed, in the default format, and the certificate's recorded day.
    expect(printed).toContain("15 November 2026");
    expect(linesOf(result.certificate.content).join("\n")).toContain("2026-11-15 01:30:00 (UTC+03:00)");
  });

  it("keeps everything the host supplied out of what was verified", async () => {
    const lines = linesOf((await issued()).certificate.content);
    const verified = section(lines, VERIFIED, RECORD).join("\n");

    for (const hostFact of ["ada@example.com", "203.0.113.7", "Email code", "Identity verified", "Ada Lovelace"]) {
      expect(verified).not.toContain(hostFact);
      expect(lines.join("\n")).toContain(hostFact);
    }
  });

  it("prints only what the host gave: nothing for a detail left out, or left blank", async () => {
    const parties: CompletionParty[] = [
      { role: "client", name: "", email: "", ip: "   " },
      { role: "vendor", name: "Grace Hopper" },
    ];
    const { certificate } = await issued(signed, { record: record({ parties, title: "", documentId: "" }) });
    const lines = linesOf(certificate.content);

    // A party with no name is headed by its role.
    expect(lines).toContain("client");
    expect(lines.some((line) => line.startsWith("Email") || line.startsWith("IP address") || line.startsWith("Document"))).toBe(false);
    // And the document opens: no empty text anywhere in it.
    expect(() => new ServerEditor({ extensions: [StarterKit], content: certificate.content })).not.toThrow();
  });

  it("lists the events in the order they happened, each in UTC, a host's own step by its label", async () => {
    const lines = linesOf((await issued()).certificate.content);

    expect(lines.filter((line) => / UTC — /.test(line) && !line.startsWith("Signature recorded"))).toEqual([
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
    expect((await issued(signed, { record: record({ events }) })).certificate.verified.signatures).toHaveLength(2);
  });

  it("lists a party with no fields of their own — a copy sent to someone who does not sign", async () => {
    const parties: CompletionParty[] = [...record().parties, { role: "cc", name: "Legal team", email: "legal@example.com" }];
    const events: CompletionEvent[] = [{ at: "2026-11-14T20:00:00Z", kind: "sent", party: "cc" }, ...record().events];
    const lines = linesOf((await issued(signed, { record: record({ parties, events }) })).certificate.content);

    expect(lines).toContain("Legal team");
    expect(lines).toContain("2026-11-14 20:00:00 UTC — Sent — Legal team");
  });

  it("speaks the host's language when given its labels, and keeps a default for a label left blank", async () => {
    const labels = { title: "Certificat d'achèvement", verified: "Vérifié à l'émission", events: "" };
    const lines = linesOf((await issued(signed, { labels })).certificate.content);

    expect(lines).toContain("Certificat d'achèvement");
    expect(lines).toContain("Vérifié à l'émission");
    expect(lines).toContain("Events");
  });
});

describe("exportCompletionCertificate refuses", () => {
  it("as the executed PDF does: an altered snapshot, an incomplete signing", async () => {
    const snapshot = await sealed();
    const altered = await exportCompletionCertificate({ ...snapshot, content: snapshot.content.replace("Terms.", "Terms!") }, signed, options());
    expect(altered.ok ? null : altered.refusal).toEqual({ reason: "snapshot-altered" });

    const client = signed["client-sig"];
    if (!client) throw new Error("no client signature");
    const incomplete = await refusalOf({ "client-sig": client });
    expect(incomplete?.reason === "unanswered-fields" && incomplete.missing.map((f) => f.id)).toEqual(["vendor-sig"]);
  });

  it("a field whose kind the editor setup does not know — it could not tell a signature from text", async () => {
    // Sealed where a "stamp" kind was registered; printed where it is not.
    const author = new ServerEditor({ extensions: [StarterKit, Field], content: { type: "doc", content: [{ type: "paragraph", content: [field("stamp", "client", "stamp")] }] } });
    const stamped = await createSnapshot(author.getState().doc, { kinds: { ...BUILT_IN_FIELD_KINDS, stamp: { label: "Stamp", size: { width: 60, height: 60 } } }, assignedRoles: ["client"] });
    if (!stamped.ok) throw new Error(stamped.refusal.reason);
    const result = await exportCompletionCertificate(stamped.snapshot, { stamp: { kind: "text", text: "ok" } }, options({ record: record({ parties: [{ role: "client", name: "Ada" }], events: [] }) }));
    expect(result.ok ? null : result.refusal).toEqual({ reason: "unknown-field-kind", kind: "stamp" });
  });

  it("an event naming a role no party plays", async () => {
    const events: CompletionEvent[] = [...record().events.slice(0, -1), { at: "2026-11-15T09:00:01Z", kind: "viewed", party: "notary" }, ...record().events.slice(-1)];
    expect(await refusalOf(signed, { record: record({ events }) })).toEqual({ reason: "unknown-party", role: "notary" });
  });

  it("a role with fields and no party", async () => {
    const parties = record().parties.filter((p) => p.role !== "vendor");
    expect(await refusalOf(signed, { record: record({ parties }) })).toEqual({ reason: "missing-party", role: "vendor" });
  });

  it("an event whose time names no zone", async () => {
    const events: CompletionEvent[] = [{ at: "2026-11-14T20:00:00", kind: "sent", party: "client" }, ...record().events.slice(1)];
    expect(await refusalOf(signed, { record: record({ events }) })).toEqual({ reason: "unzoned-time", at: "2026-11-14T20:00:00" });
  });

  it("a signature dated with a day and no time — the certificate would invent the instant", async () => {
    const vendor: FieldValue = { kind: "text", text: "Grace Hopper", signedAt: "2026-11-15" };
    expect(await refusalOf({ ...signed, "vendor-sig": vendor })).toEqual({ reason: "unzoned-time", at: "2026-11-15" });
  });

  it("a signature with no time given", async () => {
    const vendor: FieldValue = { kind: "text", text: "Grace Hopper" };
    expect(await refusalOf({ ...signed, "vendor-sig": vendor })).toEqual({ reason: "undated-signature", fieldId: "vendor-sig" });
  });

  it("a signature given after the signing was completed", async () => {
    const vendor: FieldValue = { kind: "text", text: "Grace Hopper", signedAt: "2026-11-15T10:00:00Z" };
    expect(await refusalOf({ ...signed, "vendor-sig": vendor })).toEqual({ reason: "signed-after-completed", fieldId: "vendor-sig" });
  });

  it("a party whose first sight of the document comes after they signed it", async () => {
    // The record says the client first saw it hours after the signature the PDF printed.
    const events: CompletionEvent[] = [
      { at: "2026-11-15T08:00:00Z", kind: "sent", party: "client" },
      { at: "2026-11-14T20:00:00Z", kind: "sent", party: "vendor" },
      { at: "2026-11-15T09:00:05Z", kind: "completed" },
    ];
    expect(await refusalOf(signed, { record: record({ events }) })).toEqual({ reason: "events-out-of-order", event: events[0] });
  });

  it("a signing recorded after completion", async () => {
    const events: CompletionEvent[] = [...record().events, { at: "2026-11-16T00:00:00Z", kind: "signed", party: "vendor" }];
    expect(await refusalOf(signed, { record: record({ events }) })).toEqual({ reason: "events-out-of-order", event: events.at(-1) });
  });
});

describe("bundleCertificate", () => {
  it("puts the executed record's pages first and the certificate's after, under a hash of their own", async () => {
    const { executed, certificate } = await issued();
    const bundled = await bundleCertificate(executed.pdf, certificate.pdf);

    const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();
    expect(await pages(bundled.pdf)).toBe((await pages(executed.pdf)) + (await pages(certificate.pdf)));
    expect(bundled.bundleHash).toBe(await hashArtifact(bundled.pdf));
  });
});

describe("the certificate's contract", () => {
  it("keeps its default labels as they are: a host overrides them per certificate, never for everyone", () => {
    expect(Object.isFrozen(DEFAULT_CERTIFICATE_LABELS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CERTIFICATE_LABELS.eventKinds)).toBe(true);
  });

  it("names every shape a host handles, through the package", async () => {
    const { certificate } = await issued();
    const verified: VerifiedFacts = certificate.verified;
    const signature: VerifiedSignature | undefined = verified.signatures[0];
    const kind: StandardEventKind = "sent";
    const labels: CertificateLabels = DEFAULT_CERTIFICATE_LABELS;
    const refusal: CertificateRefusal = { reason: "unknown-field-kind", kind: "stamp" };

    expect([signature?.role, labels.eventKinds[kind], refusal.reason]).toEqual(["client", "Sent", "unknown-field-kind"]);
  });
});
