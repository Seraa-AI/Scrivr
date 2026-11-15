// @vitest-environment happy-dom
/**
 * The certificate of completion, printed: its own PDF naming the executed
 * record by hash — and, for a host that wants one file, the two bundled.
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
  buildCompletionCertificate,
  createSnapshot,
  hashArtifact,
  type CompletionCertificate,
  type FieldValue,
  type TextMeasureContext,
} from "@scrivr/core";
import { bundleCertificate, exportCompletionCertificate, exportExecutedPdf, type CertificatePdfOptions } from "../index";
import { recordDrawOps } from "./opLog";

const measureContext = (ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext => ctx;
const measurer = () => new TextMeasurer({ lineHeightMultiplier: 1.2, context: measureContext(createCanvas(800, 600).getContext("2d")) });
const signature = `data:image/png;base64,${createCanvas(40, 20).toBuffer("image/png").toString("base64")}`;

/** A one-signature agreement, sealed, signed and executed — and its certificate. */
async function signing(): Promise<{ executed: Uint8Array; certificate: CompletionCertificate }> {
  const author = new ServerEditor({
    extensions: [StarterKit, Field],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Terms. Signed: " }, { type: "field", attrs: { nodeId: "sig", kind: "signature", fill: "signer", role: "client", required: true } }] },
      ],
    },
  });
  const sealed = await createSnapshot(author.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client"] });
  if (!sealed.ok) throw new Error(sealed.refusal.reason);
  const values: Record<string, FieldValue> = { sig: { kind: "image", src: signature, signedAt: "2026-11-15T09:00:00Z" } };
  const executed = await exportExecutedPdf(sealed.snapshot, values, { editorOptions: { extensions: [StarterKit, Field], textMeasurer: measurer() } });
  if (!executed.ok) throw new Error(executed.refusal.reason);
  const built = await buildCompletionCertificate({
    snapshot: sealed.snapshot,
    // Issued from exactly what the executed PDF printed.
    executed,
    extensions: [StarterKit, Field],
    record: {
      issuer: "Acme Sign",
      parties: [{ role: "client", name: "Ada Lovelace" }],
      events: [
        { at: "2026-11-15T08:00:00Z", kind: "sent", party: "client" },
        { at: "2026-11-15T09:00:00Z", kind: "signed", party: "client" },
        { at: "2026-11-15T09:00:01Z", kind: "completed" },
      ],
    },
  });
  if (!built.ok) throw new Error(built.refusal.reason);
  return { executed: executed.pdf, certificate: built.certificate };
}

const printing = (): CertificatePdfOptions => ({ editorOptions: { extensions: [StarterKit], textMeasurer: measurer() } });

describe("exportCompletionCertificate", () => {
  it("prints the certificate, with the hash of the bytes it returns", async () => {
    const { certificate } = await signing();
    const issued = await exportCompletionCertificate(certificate, printing());

    expect(issued.certificateHash).toBe(await hashArtifact(issued.pdf));
  });

  it("prints the hashes it verified, and the drawn signature", async () => {
    const { certificate } = await signing();
    const ops = await recordDrawOps(async () => {
      await exportCompletionCertificate(certificate, printing());
    });
    // A hash may be broken across lines: read the words as printed, joined.
    const words = ops.filter((op) => op.op === "text").map((op) => String(op["value"])).join("");

    expect(words).toContain(certificate.verified.contentHash);
    expect(words).toContain(certificate.verified.artifactHash);
    expect(ops.some((op) => op.op === "image")).toBe(true);
  });
});

describe("bundleCertificate", () => {
  it("puts the executed record's pages first and the certificate's after, under a hash of their own", async () => {
    const { executed, certificate } = await signing();
    const issued = await exportCompletionCertificate(certificate, printing());
    const bundled = await bundleCertificate(executed, issued.pdf);

    const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();
    expect(await pages(bundled.pdf)).toBe((await pages(executed)) + (await pages(issued.pdf)));
    expect(bundled.bundleHash).toBe(await hashArtifact(bundled.pdf));
    expect(bundled.bundleHash).not.toBe(certificate.verified.artifactHash);
  });
});
