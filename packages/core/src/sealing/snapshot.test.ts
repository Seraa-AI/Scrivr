/**
 * Sealing a revision into a snapshot: the exact bytes that were agreed, and
 * the hash that proves it. The hash is over the snapshot as stored, so
 * verifying it later never depends on how a later Scrivr would serialize.
 */
import { describe, expect, it, vi } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { Extension } from "../extensions/Extension";
import { StarterKit } from "../extensions/StarterKit";
import { Field } from "../extensions/built-in/Field";
import { createSnapshot, hashArtifact, verifySnapshot } from "./snapshot";

const para = (text: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});

const signerField = (role: string, required: boolean) => ({
  type: "field",
  attrs: { nodeId: `field-${role}`, kind: "signature", fill: "signer", role, required },
});

const docOf = (content: unknown[]) =>
  new ServerEditor({ extensions: [StarterKit, Field], content: { type: "doc", content } }).getState().doc;

const contract = docOf([para("Terms."), { type: "paragraph", content: [signerField("client", true), signerField("witness", false)] }]);

const sealed = async (doc = contract, assignedRoles = ["client"]) => {
  const result = await createSnapshot(doc, { assignedRoles });
  if (!result.ok) throw new Error(`refused: ${result.refusal.reason}`);
  return result.snapshot;
};

describe("createSnapshot", () => {
  it("hashes the snapshot it returns with SHA-256", async () => {
    const snapshot = await sealed();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot.content));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    expect(snapshot.contentHash).toBe(`sha256:${hex}`);
  });

  it("gives the same document the same bytes, however its JSON was ordered", async () => {
    const shuffled = docOf([
      { content: [{ text: "Terms.", type: "text" }], type: "paragraph" },
      { content: [signerField("client", true), signerField("witness", false)], type: "paragraph" },
    ]);

    expect((await sealed(shuffled)).contentHash).toBe((await sealed()).contentHash);
  });

  it("tells formatting apart — a bold word is a different agreement", async () => {
    const bold = docOf([para("Terms.", [{ type: "bold" }]), contract.child(1).toJSON()]);

    expect((await sealed(bold)).contentHash).not.toBe((await sealed()).contentHash);
  });

  it("covers the document's own attributes, where headers and footers live", async () => {
    const attr = Object.keys(contract.type.spec.attrs ?? {})[0];
    expect(attr).toBeDefined();
    const editor = new ServerEditor({ extensions: [StarterKit, Field], content: contract.toJSON() });
    editor.applyTransaction(editor.getState().tr.setDocAttribute(attr!, { changed: true }));

    expect((await sealed(editor.getState().doc)).contentHash).not.toBe((await sealed()).contentHash);
  });

  it("returns the signer fields with the hash, so the two cannot disagree", async () => {
    expect((await sealed()).fields).toEqual([
      { id: "field-client", role: "client", kind: "signature", required: true, options: [] },
      { id: "field-witness", role: "witness", kind: "signature", required: false, options: [] },
    ]);
  });

  it("refuses while a required role has nobody assigned", async () => {
    expect(await createSnapshot(contract, { assignedRoles: [] })).toEqual({
      ok: false,
      refusal: { reason: "unassigned-roles", missing: ["client"] },
    });
  });

  it("refuses a role no field carries — the field was removed after someone was invited", async () => {
    expect(await createSnapshot(contract, { assignedRoles: ["client", "guarantor"] })).toEqual({
      ok: false,
      refusal: { reason: "unknown-roles", unknown: ["guarantor"] },
    });
  });

  it("refuses while tracked changes are still pending", async () => {
    // A suggested image: node-level suggestions live on the node's own record.
    const redline = docOf([
      {
        type: "paragraph",
        content: [{ type: "image", attrs: { src: "data:image/png;base64,AA==", dataTracked: [{ id: "c1", status: "pending" }] } }],
      },
      contract.child(1).toJSON(),
    ]);

    expect(await createSnapshot(redline, { assignedRoles: ["client"] })).toEqual({
      ok: false,
      refusal: { reason: "pending-tracked-changes", count: 1 },
    });
  });

  it("refuses a signer field that cannot be told apart — no id, no role, or another field's id", async () => {
    const unnamed = { type: "field", attrs: { kind: "signature", fill: "signer", role: "client", required: true } };
    const roleless = { type: "field", attrs: { nodeId: "loose", kind: "signature", fill: "signer", required: true } };
    const refused = (fields: unknown[]) =>
      createSnapshot(docOf([para("Terms."), { type: "paragraph", content: fields }]), { assignedRoles: ["client"] });

    for (const fields of [[unnamed], [roleless], [signerField("client", true), signerField("client", true)]]) {
      expect(await refused(fields)).toEqual({ ok: false, refusal: { reason: "unidentified-fields", count: 1 } });
    }
  });

  it("runs a host's own checks — before Scrivr's and after them — and refuses with theirs", async () => {
    const ran: string[] = [];
    const approvedTemplate = () => {
      ran.push("before");
      return null;
    };
    const signingOrder = async ({ fields }: { fields: readonly { role: string }[] }) => {
      ran.push("after");
      return fields.some((f) => f.role === "client")
        ? { reason: "host" as const, code: "no-signing-order", message: "Put the client in the signing order." }
        : null;
    };

    const result = await createSnapshot(contract, { assignedRoles: ["client"], checks: { before: [approvedTemplate], after: [signingOrder] } });

    expect(result).toEqual({ ok: false, refusal: { reason: "host", code: "no-signing-order", message: "Put the client in the signing order." } });
    expect(ran).toEqual(["before", "after"]);
  });

  it("does not run a host's after-checks once its own checks have refused", async () => {
    const after = vi.fn(() => null);
    const result = await createSnapshot(contract, { assignedRoles: [], checks: { after: [after] } });

    expect(result.ok).toBe(false);
    expect(after).not.toHaveBeenCalled();
  });

  describe("over every part of the document, not only its body", () => {
    // A header or footer lives in the document's attributes, as a document of its own.
    const Chrome = Extension.create({ name: "chrome", addDocAttrs: () => ({ headerFooter: { default: null } }) });
    const withHeader = (header: unknown[]) =>
      new ServerEditor({
        extensions: [StarterKit, Field, Chrome],
        content: {
          type: "doc",
          attrs: { headerFooter: { enabled: true, defaultHeader: { content: { type: "doc", content: header } } } },
          content: [para("Terms."), contract.child(1).toJSON()],
        },
      }).getState().doc;

    it("refuses a prompt still showing in a header", async () => {
      const header = [para("Client name", [{ type: "fieldRange", attrs: { nodeId: "h1", kind: "text", prompt: "Client name", placeholder: true } }])];

      expect(await createSnapshot(withHeader(header), { assignedRoles: ["client"] })).toEqual({
        ok: false,
        refusal: { reason: "unfilled-fields", prompts: ["Client name"] },
      });
    });

    it("refuses a suggestion still pending in a footer or header", async () => {
      const header = [
        { type: "paragraph", content: [{ type: "image", attrs: { src: "data:image/png;base64,AA==", dataTracked: [{ id: "c9", status: "pending" }] } }] },
      ];

      expect(await createSnapshot(withHeader(header), { assignedRoles: ["client"] })).toEqual({
        ok: false,
        refusal: { reason: "pending-tracked-changes", count: 1 },
      });
    });

    it("refuses a signer field outside the body, which no signer could be shown to complete", async () => {
      const header = [{ type: "paragraph", content: [signerField("witness", true)] }];

      expect(await createSnapshot(withHeader(header), { assignedRoles: ["client", "witness"] })).toEqual({
        ok: false,
        refusal: { reason: "fields-outside-body", count: 1 },
      });
    });
  });

  it("refuses while text the author fills still shows its prompt", async () => {
    const range = (id: string, text: string, placeholder: boolean) =>
      para(text, [{ type: "fieldRange", attrs: { nodeId: id, kind: "text", prompt: "Client name", placeholder } }]);
    const unfilled = docOf([range("client-name", "Client name", true), contract.child(1).toJSON()]);
    const filled = docOf([range("client-name", "Ada Lovelace", false), contract.child(1).toJSON()]);

    expect(await createSnapshot(unfilled, { assignedRoles: ["client"] })).toEqual({
      ok: false,
      refusal: { reason: "unfilled-fields", prompts: ["Client name"] },
    });
    expect((await createSnapshot(filled, { assignedRoles: ["client"] })).ok).toBe(true);
  });
});

describe("verifySnapshot", () => {
  it("accepts the snapshot as sealed and rejects one edited since", async () => {
    const { content, contentHash } = await sealed();

    expect(await verifySnapshot(content, contentHash)).toBe(true);
    expect(await verifySnapshot(content.replace("Terms.", "Terms!"), contentHash)).toBe(false);
  });
});

describe("hashArtifact", () => {
  it("hashes exported bytes — the executed PDF, what was displayed", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);

    expect(await hashArtifact(bytes)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await hashArtifact(bytes)).not.toBe(await hashArtifact(new Uint8Array([37, 80, 68, 71])));
  });
});
