// @vitest-environment happy-dom
/**
 * The certificate of completion: issued with the executed PDF from one
 * printing, so it can only describe the document beside it — what Scrivr
 * checked, kept apart from the host's own record of the signing.
 */
import { describe, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { crc32 } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { writeFileSync } from "node:fs";
import { HeaderFooter } from "@scrivr/plugins";
import {
  BUILT_IN_FIELD_KINDS,
  Field,
  Extension,
  ServerEditor,
  StarterKit,
  TextBlockStrategy,
  TextMeasurer,
  createSnapshot,
  hashArtifact,
  type FieldKinds,
  type FieldValue,
  type SealedSnapshot,
  type TextMeasureContext,
} from "@scrivr/core";
// Through the package barrel: what a host imports.
import {
  DEFAULT_CERTIFICATE_LABELS,
  bundleCertificate,
  exportCompletionCertificate,
  exportExecutedPdf,
  type CertificateContent,
  type CertificateNode,
  type CertificateLabels,
  type CertificateParts,
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
import { createDefaultImageResolver, type ImageBytes } from "../fetchImage";

const measureContext = (ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext => ctx;
const measurer = () => new TextMeasurer({ lineHeightMultiplier: 1.2, context: measureContext(createCanvas(800, 600).getContext("2d")) });
/** A drawing as a signature pad gives one, `width × height`. */
const drawingOf = (width: number, height: number) => `data:image/png;base64,${createCanvas(width, height).toBuffer("image/png").toString("base64")}`;
/** A real PNG whose header says it is 0 pixels wide: valid bytes, no area. */
const zeroWidthPng = (): string => {
  const bytes = createCanvas(20, 10).toBuffer("image/png");
  bytes.writeUInt32BE(0, 16);
  // The IHDR chunk's checksum covers its type and data, bytes 12 to 28.
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return `data:image/png;base64,${bytes.toString("base64")}`;
};
/** Opens as a PNG, but is no image: the PDF cannot embed it. */
const brokenPng = "data:image/png;base64,iVBORw0KGgoAAAAAAAA";

/** A signer field with its kind's size, as inserting one gives it. */
const knownKinds: FieldKinds = BUILT_IN_FIELD_KINDS;
/** A signer field sized as inserting it would size it; a kind no one knows keeps the schema's default. */
const field = (id: string, role: string, kind: string, required = true) => ({
  type: "field",
  attrs: { nodeId: id, kind, fill: "signer", role, required, ...knownKinds[kind]?.size },
});

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
    // Headed by its kind alone: the section and the party already say it is the host's record.
    expect(lines).toContain("Signature: 2026-11-15 01:30:00 (UTC+03:00) · 2026-11-14 22:30:00 UTC");
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

    expect(lines.filter((line) => / UTC — /.test(line))).toEqual([
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

describe("a host's own content on the certificate", () => {
  const logo = drawingOf(120, 40);

  it("adds the host's blocks above the title and after the record, and leaves what was verified as it was", async () => {
    const plain = await issued();
    const { executed, certificate } = await issued(signed, {
      content: () => ({
        before: [{ image: logo, width: 120, height: 40 }, { paragraph: "Acme Sign — completion record" }],
        after: [{ title: "Electronic record and signature disclosure", level: 3 }, { paragraph: "The parties agreed to sign electronically." }],
      }),
    });
    const lines = linesOf(certificate.content);

    expect(lines.indexOf("Acme Sign — completion record")).toBeLessThan(lines.indexOf("Certificate of completion"));
    expect(lines.at(-1)).toBe("The parties agreed to sign electronically.");
    expect(imagesOf(certificate.content)[0]?.["src"]).toBe(logo);
    // Each printing is its own PDF, stamped when it was made: the same section, with this issuing's hash.
    const asIssuedHere = (line: string) => line.replace(plain.executed.artifactHash, executed.artifactHash);
    expect(section(lines, VERIFIED, RECORD)).toEqual(section(linesOf(plain.certificate.content), VERIFIED, RECORD).map(asIssuedHere));
  });

  it("lets the host replace the record's body, still under its own name — given Scrivr's blocks to change", async () => {
    const { certificate } = await issued(signed, {
      // Drop the IP address lines; keep the rest as Scrivr laid it out.
      content: ({ record }) => ({ record: record.filter((block) => !("label" in block && block.label === "IP address")) }),
    });
    const lines = linesOf(certificate.content);

    expect(lines).toContain(RECORD);
    expect(lines.join("\n")).not.toContain("203.0.113.7");
    expect(lines.join("\n")).toContain("ada@example.com");
  });

  it("hands the host the facts it checked and the host's own record, to lay out its own way", async () => {
    let seen: { contentHash: string; issuer: string } | null = null;
    const { certificate } = await issued(signed, {
      content: ({ verified, signingRecord }) => {
        seen = { contentHash: verified.contentHash, issuer: signingRecord.issuer };
        return { record: [{ paragraph: `${signingRecord.parties.length} parties signed.` }] };
      },
    });

    expect(seen).toEqual({ contentHash: certificate.verified.contentHash, issuer: "Acme Sign" });
    expect(linesOf(certificate.content)).toContain("2 parties signed.");
  });

  it("hands the host the labels in use, so it finds its own words in Scrivr's blocks — a translation too", async () => {
    const { certificate } = await issued(signed, {
      labels: { ip: "Adresse IP" },
      content: ({ record, labels }) => ({ record: record.filter((block) => !("label" in block && block.label === labels.ip)) }),
    });

    expect(linesOf(certificate.content).join("\n")).not.toContain("203.0.113.7");
  });

  it("cannot change what was verified: the hook sees the facts, never the ones printed or kept", async () => {
    const { executed, certificate } = await issued(signed, {
      content: ({ verified, labels }) => {
        try {
          Reflect.set(verified, "artifactHash", "sha256:forged");
          Reflect.set(verified.signatures, 0, { fieldId: "forged", role: "client", kind: "signature" });
          Reflect.set(labels, "record", "Signing record — forged by");
        } catch {
          // Frozen: a write may throw, or be ignored.
        }
        return {};
      },
    });

    expect(certificate.verified.artifactHash).toBe(executed.artifactHash);
    expect(certificate.verified.signatures[0]?.fieldId).toBe("client-sig");
    expect(linesOf(certificate.content).join("\n")).not.toContain("forged");
    expect(linesOf(certificate.content)).toContain(RECORD);
  });

  it("says so in its types: what was verified, and the labels it is printed under, are read-only", () => {
    // Never called: tsc is the check, failing if any of these writes compiles.
    const tamper = (verified: VerifiedFacts, labels: CertificateParts["labels"]) => {
      // @ts-expect-error the executed PDF's hash is read-only
      verified.artifactHash = "sha256:forged";
      // @ts-expect-error the signatures are read-only
      verified.signatures.push({ fieldId: "forged", role: "client", kind: "signature" });
      // @ts-expect-error each signature is read-only
      verified.signatures[0]!.role = "forged";
      // @ts-expect-error the labels are read-only
      labels.record = "Signing record — forged by";
    };

    expect(tamper).toBeTypeOf("function");
  });

  it("still refuses a record that does not fit the document, whatever the host prints", async () => {
    const parties = record().parties.filter((p) => p.role !== "vendor");
    const refusal = await refusalOf(signed, { record: record({ parties }), content: () => ({ record: [] }) });

    expect(refusal).toEqual({ reason: "missing-party", role: "vendor" });
  });
});

describe("exportCompletionCertificate refuses", () => {
  it("refuses a custom signature printer, while ordinary executed export still supports it", async () => {
    const print = vi.fn(() => true);
    const editorOptions = { extensions: [StarterKit, Field.configure({ print })], textMeasurer: measurer() };
    expect(await refusalOf(signed, { editorOptions })).toEqual({ reason: "unverified-signature-print", fieldId: "client-sig" });
    expect(print).toHaveBeenCalled();
    expect((await exportExecutedPdf(await sealed(), signed, { editorOptions })).ok).toBe(true);
  });

  it("accepts a print hook that delegates signatures to the standard renderer", async () => {
    const print = vi.fn(() => false);
    const result = await issued(signed, { editorOptions: { extensions: [StarterKit, Field.configure({ print })], textMeasurer: measurer() } });
    expect(print).toHaveBeenCalled();
    expect(result.certificate.verified.signatures).toHaveLength(2);
  });

  it("refuses a replacement field export handler that bypasses Field's printer", async () => {
    const override = Extension.create({ name: "customFieldExport", addExports: () => ({ pdf: { nodes: { field: () => {} } } }) });
    expect(await refusalOf(signed, { editorOptions: { extensions: [StarterKit, Field, override], textMeasurer: measurer() } }))
      .toEqual({ reason: "unverified-signature-print", fieldId: "client-sig" });
  });

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

describe("exportCompletionCertificate refuses a record it could not print honestly", () => {
  it("one with no issuer to attribute it to", async () => {
    expect(await refusalOf(signed, { record: record({ issuer: "  " }) })).toEqual({ reason: "unnamed-issuer" });
  });

  it("two parties for one role — whose signature would it be?", async () => {
    const parties: CompletionParty[] = [...record().parties, { role: "client", name: "Someone else" }];
    expect(await refusalOf(signed, { record: record({ parties }) })).toEqual({ reason: "duplicate-party", role: "client" });
  });

  it("an event no certificate can name: a step of the host's own with no label", async () => {
    const blank: CompletionEvent = { at: "2026-11-14T20:30:00Z", kind: "custom", label: " ", party: "client" };
    const events: CompletionEvent[] = [...record().events.slice(0, 2), blank, ...record().events.slice(2)];
    expect(await refusalOf(signed, { record: record({ events }) })).toEqual({ reason: "unknown-event", event: blank });
  });

  it("a drawing with no area: it would print nothing, so it answers nothing", async () => {
    const flat: FieldValue = { kind: "image", src: zeroWidthPng(), signedAt: "2026-11-15T01:30:00+03:00" };
    const refusal = await refusalOf({ ...signed, "client-sig": flat });
    // And with no signature to date it, the date signed is blank too.
    expect(refusal?.reason === "unanswered-fields" && refusal.missing.map((f) => f.id)).toEqual(["client-sig", "client-date"]);
  });
});

describe("exportCompletionCertificate prints a signature as the executed PDF does", () => {
  it("returns a self-contained viewer document with the resolver's bytes, also embedded in both PDFs", async () => {
    const canvas = createCanvas(60, 20);
    const context = canvas.getContext("2d");
    context.fillStyle = "red";
    context.fillRect(0, 0, 60, 20);
    const bytes = new Uint8Array(canvas.toBuffer("image/png"));
    const resolvedUrl = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    const resolveImage = vi.fn(async (): Promise<ImageBytes> => ({ bytes, format: "png" }));
    const result = await issued(signed, { resolveImage });
    expect(imagesOf(result.certificate.content)[0]?.["src"]).toBe(resolvedUrl);
    expect(resolveImage).toHaveBeenCalledTimes(1);
    // Read the returned document with the default resolver, as a viewer would.
    expect(await createDefaultImageResolver()(resolvedUrl)).toEqual({ bytes, format: "png" });
    // Both PDFs embedded the resolved 60px image, not the input's 240px drawing.
    for (const pdf of [result.executed.pdf, result.certificate.pdf]) {
      const loaded = await PDFDocument.load(pdf);
      const images = loaded.context.enumerateIndirectObjects().filter(([, object]) => String(object).includes("/Subtype /Image"));
      expect(images.some(([, object]) => String(object).includes("/Width 60"))).toBe(true);
      expect(images.some(([, object]) => String(object).includes("/Width 240"))).toBe(false);
    }
  });

  /** The drawing the certificate shows for a 3:1 signature in a field of this size. */
  const shownIn = async (size: { width: unknown; height: unknown }) => {
    const author = new ServerEditor({
      extensions: [StarterKit, Field],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "field", attrs: { nodeId: "sig", kind: "signature", fill: "signer", role: "client", required: true, ...size } }] }],
      },
    });
    const sealedOne = await createSnapshot(author.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client"] });
    if (!sealedOne.ok) throw new Error(sealedOne.refusal.reason);
    const result = await exportCompletionCertificate(
      sealedOne.snapshot,
      { sig: { kind: "image", src: drawing, signedAt: "2026-11-15T09:00:00Z" } },
      options({ record: record({ parties: [{ role: "client", name: "Ada" }], events: [] }) }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.refusal));
    const image = imagesOf(result.certificate.content)[0];
    return { width: Number(image?.["width"]), height: Number(image?.["height"]) };
  };

  it("from the very drawing the executed PDF embedded: the host's resolver is asked once, for both", async () => {
    const resolveImage = vi.fn(createDefaultImageResolver());
    await issued(signed, { resolveImage });

    expect(resolveImage.mock.calls.filter(([src]) => src === drawing)).toHaveLength(1);
  });

  it("in the field's own box, not its kind's default", async () => {
    // A 3:1 drawing in a 300 × 60 box: 60 high sets the scale, so 180 × 60.
    const { width, height } = await shownIn({ width: 300, height: 60 });

    expect(width).toBeCloseTo(180, 6);
    expect(height).toBeCloseTo(60, 6);
  });

  it("in its kind's box when the field has no size of its own, as the page lays it out", async () => {
    // A 3:1 drawing in the signature's 180 × 44: 44 high sets the scale, so 132 × 44.
    for (const unsized of [0, Number.NaN, "wide"]) {
      const { width, height } = await shownIn({ width: unsized, height: unsized });

      expect(width).toBeCloseTo(132, 6);
      expect(height).toBeCloseTo(44, 6);
    }
  });

  it("from the drawing as the executed PDF embedded it — the cleaned URL, not the one the host gave", async () => {
    const client: FieldValue = { kind: "image", src: `  ${drawing}\n`, signedAt: "2026-11-15T01:30:00+03:00" };
    const { certificate } = await issued({ ...signed, "client-sig": client });

    expect(imagesOf(certificate.content)[0]?.["src"]).toBe(drawing);
  });
});

describe("the guide's own example", () => {
  // The record apps/docs/content/docs/guides/certificate.mdx shows a host — kept here so the guide never shows one that is refused.
  const guideRecord: CompletionRecord = {
    issuer: "Acme Sign",
    title: "Master Services Agreement",
    documentId: "AGR-2026-0042",
    parties: [
      { role: "client", name: "Ada Lovelace", email: "ada@example.com", authentication: "Email code" },
      { role: "provider", name: "Northwind Studio" },
      { role: "legal-cc", name: "Legal team" },
    ],
    events: [
      { at: "2026-11-15T08:00:00Z", kind: "sent", party: "client" },
      { at: "2026-11-15T08:00:00Z", kind: "sent", party: "provider" },
      { at: "2026-11-15T09:30:00Z", kind: "custom", label: "Identity verified", party: "client" },
      { at: "2026-11-15T12:44:10+03:00", kind: "signed", party: "client" },
      { at: "2026-11-15T10:02:00Z", kind: "signed", party: "provider" },
      { at: "2026-11-15T10:02:05Z", kind: "completed" },
    ],
  };

  it("is issued", async () => {
    const author = new ServerEditor({
      extensions: [StarterKit, Field],
      content: { type: "doc", content: [{ type: "paragraph", content: [field("c", "client", "signature"), field("p", "provider", "signature")] }] },
    });
    const sealedGuide = await createSnapshot(author.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client", "provider"] });
    if (!sealedGuide.ok) throw new Error(sealedGuide.refusal.reason);
    const result = await exportCompletionCertificate(
      sealedGuide.snapshot,
      {
        c: { kind: "text", text: "Ada Lovelace", signedAt: "2026-11-15T12:44:10+03:00" },
        p: { kind: "text", text: "Northwind Studio", signedAt: "2026-11-15T10:02:00Z" },
      },
      options({ record: guideRecord }),
    );

    expect(result.ok ? null : result.refusal).toBeNull();
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
    const hook = (parts: CertificateParts): CertificateContent => ({ record: parts.record });
    expect(hook({ record: [], verified, labels, signingRecord: record() })).toEqual({ record: [] });

    expect([signature?.role, labels.eventKinds[kind], refusal.reason]).toEqual(["client", "Sent", "unknown-field-kind"]);
  });
});

/** Bug class: a host's own certificate that drops, repeats or rewrites what was checked. */
describe("a certificate the host lays out", () => {
  const text = (value: string, marks?: Record<string, unknown>[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
  const paragraph = (...content: Record<string, unknown>[]) => ({ type: "paragraph", content });
  const heading = (level: number, value: string) => ({ type: "heading", attrs: { level }, content: [text(value)] });
  const layout = (body: readonly CertificateNode[], attrs?: Record<string, unknown>) => ({ content: () => ({ body, ...(attrs ? { attrs } : {}) }) });

  const body: CertificateNode[] = [
    paragraph(text("Certificate of completion")),
    heading(1, "Document signing completed"),
    { slot: "record" },
    heading(3, "Ada Lovelace"),
    { slot: "signature", role: "client" },
    heading(3, "Grace Hopper"),
    heading(2, "Activity history"),
    { slot: "verified" },
  ];

  it("lays out the host's body around Scrivr's parts, integrity last", async () => {
    const lines = linesOf((await issued(signed, layout(body))).certificate.content);
    expect(lines[0]).toBe("Certificate of completion");
    expect(lines.indexOf(`${DEFAULT_CERTIFICATE_LABELS.record} Acme Sign`)).toBe(2);
    expect(lines.indexOf(DEFAULT_CERTIFICATE_LABELS.verified)).toBeGreaterThan(lines.indexOf("Activity history"));
  });

  it("prints each signature once: in its role's slot, else in Verified at issue", async () => {
    const lines = linesOf((await issued(signed, layout(body))).certificate.content);
    const ada = lines.indexOf("Ada Lovelace");
    // The client's drawn signature sits in Ada's card; the vendor's, with no slot, under what was checked.
    expect(lines[ada + 1]).toBe("Signature");
    expect(lines.filter((line) => line === "Grace Hopper")).toHaveLength(2); // her card's heading, and her typed signature
    expect(lines.indexOf("Grace Hopper", ada)).toBeLessThan(lines.indexOf(DEFAULT_CERTIFICATE_LABELS.verified));
    expect(lines.lastIndexOf("Grace Hopper")).toBeGreaterThan(lines.indexOf(DEFAULT_CERTIFICATE_LABELS.verified));
  });

  it("refuses a body that leaves out, or repeats, what must be printed once", async () => {
    const without = (slot: string) => body.filter((node) => !("slot" in node && node.slot === slot));
    expect(await refusalOf(signed, layout(without("verified")))).toEqual({ reason: "verified-slot" });
    expect(await refusalOf(signed, layout([...body, { slot: "verified" }]))).toEqual({ reason: "verified-slot" });
    expect(await refusalOf(signed, layout(without("record")))).toEqual({ reason: "record-slot" });
    expect(await refusalOf(signed, layout([...body, { slot: "signature", role: "client" }])))
      .toEqual({ reason: "duplicate-signature-slot", role: "client" });
  });

  it("refuses a body its own schema does not accept, rather than dropping what it cannot read", async () => {
    const refusal = await refusalOf(signed, layout([{ type: "eyebrow", content: [text("Certificate")] }, ...body]));
    expect(refusal?.reason).toBe("invalid-content");
  });

  it("refuses a setup with nothing to print what was checked in", async () => {
    const editorOptions = { extensions: [StarterKit.configure({ heading: false }), Field], textMeasurer: measurer() };
    expect((await refusalOf(signed, { editorOptions }))?.reason).toBe("unprintable-certificate");
  });

  it("prints in the host's own setup: its extensions, tables, colour, links and page chrome", async () => {
    // A host's own block, built as core's own are: laid out as text, drawn as its lines.
    const Eyebrow = Extension.create({
      name: "eyebrow",
      addNodes: () => ({ eyebrow: { group: "block", content: "inline*", attrs: { nodeId: { default: null } }, toDOM: () => ["p", 0] } }),
      addLayoutHandlers: () => ({ eyebrow: TextBlockStrategy }),
      addBlockStyles: () => ({ eyebrow: { font: "bold 10px", spaceBefore: 0, spaceAfter: 6, align: "left" as const } }),
      addExports: () => ({ pdf: { nodes: { eyebrow: (block, ctx) => ctx.draw.lines(block, ctx) } } }),
    });
    const cell = (value: string) => ({ type: "tableCell", content: [paragraph(text(value))] });
    const row = (...values: string[]) => ({ type: "tableRow", content: values.map(cell) });
    const muted = [{ type: "color", attrs: { color: "#6b7280" } }];
    const footer = { content: { type: "doc", content: [paragraph(text("AGR-2026-0042 · page "), { type: "pageNumber" })] } };
    const editorOptions = {
      extensions: [StarterKit.configure({ table: true }), Field, Eyebrow, HeaderFooter],
      textMeasurer: measurer(),
    };
    const result = await issued(signed, {
      editorOptions,
      ...layout([
        { type: "eyebrow", content: [text("CERTIFICATE OF COMPLETION", muted)] },
        heading(1, "Document signing completed"),
        paragraph(text("All required signatures received", muted)),
        { type: "table", content: [row("Document", "Master Services Agreement"), row("Certificate ID", "AGR-2026-0042")] },
        { slot: "record" },
        heading(3, "Ada Lovelace"),
        paragraph(text("ada@example.com", muted)),
        { slot: "signature", role: "client" },
        heading(3, "Grace Hopper"),
        { slot: "signature", role: "vendor" },
        heading(2, "Activity history"),
        { type: "table", content: [row("Sent", "14 Nov 2026"), row("Completed", "15 Nov 2026")] },
        { slot: "verified" },
        paragraph(text("Verify at "), text("seraa.ai/verify", [{ type: "link", attrs: { href: "https://seraa.ai/verify" } }])),
      ], { headerFooter: { enabled: true, differentFirstPage: false, differentOddEven: false, defaultFooter: footer } }),
    });
    const lines = linesOf(result.certificate.content);
    expect(lines[0]).toBe("CERTIFICATE OF COMPLETION");
    expect(lines.at(-1)).toBe("Verify at seraa.ai/verify");
    // Every signature is in its signer's card, so none is left under what was checked.
    const verified = lines.indexOf(DEFAULT_CERTIFICATE_LABELS.verified);
    expect(lines.slice(verified)).not.toContain("Signature");
    const pdf = await PDFDocument.load(result.certificate.pdf);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    if (process.env.CERTIFICATE_OUT) writeFileSync(process.env.CERTIFICATE_OUT, result.certificate.pdf);
  });
});
