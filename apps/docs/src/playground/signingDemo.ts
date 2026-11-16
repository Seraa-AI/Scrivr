/**
 * An agreement for exercising a signing by hand: author it, review it, seal
 * it, then sign it as each party.
 *
 * It holds every shape of field — text the author fills, a templated block,
 * and boxes two signers complete — and one of Alice's suggestions still
 * pending, so the first attempt to seal is refused until it is reviewed.
 *
 * Reach it from the content switch in the playground header, or with
 * `?demo=signing`.
 */

import { BUILT_IN_FIELD_KINDS, type BuiltInFieldKind } from "@scrivr/core";

/** The roles this agreement's fields name, and so the ones a seal assigns. */
export const SIGNING_ROLES = ["provider", "client"] as const;
export type SigningRole = (typeof SIGNING_ROLES)[number];

export const ROLE_LABEL: Readonly<Record<string, string>> = { provider: "Provider", client: "Client" };

const text = (value: string) => ({ type: "text", text: value });

const bold = (value: string) => ({ type: "text", text: value, marks: [{ type: "bold" }] });

const p = (...content: unknown[]) => ({
  type: "paragraph",
  attrs: { align: "left" },
  content: content.length ? content : undefined,
});

const h = (level: number, value: string) => ({ type: "heading", attrs: { level }, content: [text(value)] });

/** Text the author fills; `value` absent leaves the prompt showing. */
const authorText = (id: string, prompt: string, value?: string) => ({
  type: "text",
  text: value ?? prompt,
  marks: [{ type: "fieldRange", attrs: { nodeId: id, kind: "text", prompt, placeholder: value === undefined } }],
});

/** A box a signer completes, sized as `insertField` sizes its kind. */
const signer = (id: string, kind: BuiltInFieldKind, role: SigningRole, extra: Record<string, unknown> = {}) => ({
  type: "field",
  attrs: { nodeId: id, kind, fill: "signer", role, required: true, ...BUILT_IN_FIELD_KINDS[kind].size, ...extra },
});

/** Alice's pending suggestion — the reason the first seal is refused. */
const aliceInserted = (value: string) => ({
  type: "text",
  text: value,
  marks: [
    {
      type: "trackedInsert",
      attrs: {
        dataTracked: {
          id: "signing-demo-change-1",
          authorID: "alice",
          operation: "insert",
          status: "pending",
          createdAt: 1_760_000_000_000,
          updatedAt: 1_760_000_000_000,
        },
      },
    },
  ],
});

const clause = (heading: string, ...paragraphs: string[]) => [h(2, heading), ...paragraphs.map((t) => p(text(t)))];

export const SIGNING_DEMO_DOC = {
  type: "doc",
  content: [
    h(1, "Services Agreement"),
    p(
      text("This agreement is made between "),
      authorText("signing-provider-name", "Provider name", "Northwind Studio"),
      text(" (the Provider) and "),
      authorText("signing-client-name", "Client name"),
      text(" (the Client)."),
    ),
    h(2, "1. Services"),
    p(
      text("The Provider will design and build the Client's website as described in Schedule A"),
      aliceInserted(", including two rounds of revisions"),
      text(". The Provider will keep the Client informed of progress at least once a week."),
    ),
    h(2, "2. Fees and payment"),
    p(
      text("The Client will pay the fees set out in Schedule A. Invoices are payable on terms of "),
      signer("signing-terms", "dropdown", "client", {
        options: [
          { id: "net-15", label: "Net 15" },
          { id: "net-30", label: "Net 30" },
          { id: "net-60", label: "Net 60" },
        ],
      }),
      text(" from the date of invoice."),
    ),
    h(2, "3. Special terms"),
    {
      type: "fieldBlock",
      attrs: { nodeId: "signing-special-terms", kind: "text", prompt: "Special terms" },
      content: [p(text("None."))],
    },
    ...clause(
      "4. Term",
      "This agreement starts on the date the last party signs it and continues until the services are complete, unless ended earlier under clause 8.",
    ),
    ...clause(
      "5. Confidentiality",
      "Each party will keep the other's confidential information secret and use it only to perform this agreement. This obligation survives the end of the agreement for three years.",
      "Confidential information does not include information that is public through no fault of the receiving party, or that the receiving party already held without restriction.",
    ),
    ...clause(
      "6. Intellectual property",
      "On payment in full, the Provider assigns to the Client all rights in the work made specifically for the Client. The Provider keeps its pre-existing tools and know-how, and grants the Client a licence to use them as part of the work.",
    ),
    ...clause(
      "7. Warranties",
      "The Provider will perform the services with reasonable skill and care. Except as stated in this agreement, no other warranties are given.",
    ),
    ...clause(
      "8. Termination",
      "Either party may end this agreement with thirty days' written notice. The Client will pay for work done up to the date it ends.",
      "Either party may end this agreement at once if the other materially breaches it and does not put the breach right within fourteen days of being asked to.",
    ),
    ...clause(
      "9. Governing law",
      "This agreement is governed by the law of the place where the Provider has its principal office, and the courts there have exclusive jurisdiction.",
    ),
    h(2, "10. Acknowledgement"),
    p(
      signer("signing-ack", "checkbox", "client"),
      text(" The Client has read this agreement and agrees to its terms. Initials: "),
      signer("signing-client-initials", "initials", "client"),
    ),
    h(2, "Signatures"),
    p(bold("For the Provider")),
    p(signer("signing-provider-signature", "signature", "provider")),
    p(text("Name: "), signer("signing-provider-signer-name", "name", "provider")),
    p(text("Title: "), signer("signing-provider-title", "title", "provider")),
    p(text("Date: "), signer("signing-provider-date", "dateSigned", "provider")),
    p(bold("For the Client")),
    p(signer("signing-client-signature", "signature", "client")),
    p(text("Name: "), signer("signing-client-signer-name", "name", "client")),
    p(text("Email: "), signer("signing-client-email", "email", "client", { required: false })),
    p(text("Date: "), signer("signing-client-date", "dateSigned", "client")),
  ],
};
