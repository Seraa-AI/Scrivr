import type { Editor } from "@scrivr/core";
import { ROLE_LABEL, SIGNING_ROLES } from "./signingDemo";

const SIGNER_KINDS = ["signature", "initials", "date", "name", "title", "email", "checkbox", "dropdown"] as const;

const TERMS = [
  { id: "net-15", label: "Net 15" },
  { id: "net-30", label: "Net 30" },
];

/** Every way the playground inserts a field, keyed by the `<option>` that asks for it. */
const INSERTS: Record<string, { label: string; run: (editor: Editor) => boolean }> = {
  ...Object.fromEntries(
    SIGNING_ROLES.flatMap((role) =>
      SIGNER_KINDS.map((kind) => [
        `${role}:${kind}`,
        {
          label: `${ROLE_LABEL[role]} · ${kind}`,
          run: (editor: Editor) =>
            editor.commands.insertField({
              kind,
              fill: "signer",
              role,
              required: true,
              ...(kind === "dropdown" ? { options: TERMS } : {}),
            }),
        },
      ]),
    ),
  ),
  "author:text": {
    label: "Text the author fills",
    run: (editor) => editor.commands.insertFieldRange({ kind: "text", prompt: "Type here" }),
  },
  "author:block": {
    label: "Block around the selection",
    run: (editor) => editor.commands.insertFieldBlock({ kind: "text", prompt: "Section" }),
  },
};

/** Inserts a field at the caret — how an author places what signers will complete. */
export function FieldInsertMenu({ editor }: { editor: Editor | null }) {
  return (
    <select
      aria-label="Insert field"
      value=""
      disabled={!editor}
      onChange={(e) => {
        const insert = INSERTS[e.target.value];
        if (!editor || !insert) return;
        insert.run(editor);
        editor.focus();
      }}
      className="hidden h-[28px] w-[120px] shrink-0 rounded-md border px-1.5 text-[12px] md:block"
      style={{ background: "var(--app-surface)", borderColor: "var(--app-border)", color: "var(--app-text)" }}
    >
      <option value="" disabled>
        Insert field…
      </option>
      {Object.entries(INSERTS).map(([key, { label }]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}
