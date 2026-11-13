import { useState } from "react";
import { BubbleMenu } from "@scrivr/react";
import type { Editor } from "@scrivr/react";
import { BUILT_IN_FIELD_KINDS, FieldChoiceSchema, defaultBubbleMenuShouldShow, fieldRoleColor, roleName, type FieldKindSpec } from "@scrivr/core";
import { NodeSelection, type EditorState, type Node as PmNode } from "@scrivr/core/pm";
import { ROLE_LABEL, SIGNING_ROLES } from "./signingDemo";
import { RemoveFormatting } from "lucide-react";

interface BubbleMenuBarProps {
  editor: Editor | null;
}

type Btn = {
  label: string;
  title: string;
  mark: string;
  action: (editor: Editor) => void;
};

const BUTTONS: Btn[] = [
  {
    label: "B",
    title: "Bold",
    mark: "bold",
    action: (e) => e.commands.toggleBold(),
  },
  {
    label: "I",
    title: "Italic",
    mark: "italic",
    action: (e) => e.commands.toggleItalic(),
  },
  {
    label: "U",
    title: "Underline",
    mark: "underline",
    action: (e) => e.commands.toggleUnderline(),
  },
  {
    label: "S",
    title: "Strikethrough",
    mark: "strikethrough",
    action: (e) => e.commands.toggleStrikethrough(),
  },
];

/** A field box selected whole. */
const selectedField = (state: EditorState) =>
  state.selection instanceof NodeSelection && state.selection.node.type.name === "field" ? state.selection : null;

/** An author's prompt selected whole — the caret landed in it, which takes all of it. */
const selectedPrompt = (state: EditorState): string | null => {
  const { from, to } = state.selection;
  const mark = state.doc.nodeAt(from)?.marks.find((m) => m.type.name === "fieldRange");
  if (!mark || mark.attrs["placeholder"] !== true) return null;
  const prompt = String(mark.attrs["prompt"]);
  return state.doc.textBetween(from, to) === prompt ? prompt : null;
};

const showFor = (state: EditorState) => selectedField(state) !== null || defaultBubbleMenuShouldShow(state);

export function BubbleMenuBar({ editor }: BubbleMenuBarProps) {
  const activeMarks: string[] = editor?.getActiveMarks() ?? [];
  const hasLink = activeMarks.includes("link");
  const state = editor?.getState();
  const field = state ? selectedField(state) : null;
  const prompt = state ? selectedPrompt(state) : null;

  return (
    <BubbleMenu editor={editor} className="bubble-menu-bar" shouldShow={showFor}>
      {field && editor ? (
        <FieldPanel key={field.from} editor={editor} pos={field.from} node={field.node} activeMarks={activeMarks} />
      ) : prompt !== null ? (
        <div className="flex items-center gap-2 bg-[var(--app-surface)] text-[var(--app-text)] border border-[var(--app-border)] rounded-[9px] px-2.5 py-1.5 text-[12px] text-[var(--app-text)] shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]">
          <span className="inline-block w-3" style={{ borderBottom: `2px dotted ${fieldRoleColor(null)}` }} />
          <span className="font-semibold text-[var(--app-text)]">{prompt}</span>
          <span className="text-[var(--app-text-muted)]">Type to fill it in — the author fills this before sealing</span>
        </div>
      ) : (
      <div className="flex items-center gap-0.5 bg-[var(--app-surface)] text-[var(--app-text)] border border-[var(--app-border)] rounded-[9px] px-1.5 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]">
        {BUTTONS.map(({ label, title, mark, action }) => (
          <button
            key={mark}
            title={title}
            onMouseDown={(e) => {
              e.preventDefault();
              if (editor) action(editor);
            }}
            className={[
              "px-2 py-1 rounded-md border-none text-[13px] leading-none cursor-pointer transition-colors duration-100",
              activeMarks.includes(mark)
                ? "bg-[var(--app-accent-soft-bg)] text-[var(--app-accent-soft-fg)]"
                : "bg-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text)]",
              label === "B" ? "font-bold" : "",
              label === "I" ? "italic" : "",
            ].join(" ")}
          >
            {label}
          </button>
        ))}

        <div className="w-px h-4 bg-[var(--app-border)] mx-1" />

        <button
          title={hasLink ? "Edit link" : "Insert link"}
          onMouseDown={(e) => {
            e.preventDefault();
            editor?.commands.setLink?.();
          }}
          className={[
            "px-2 py-1 rounded-md border-none text-[13px] leading-none cursor-pointer transition-colors duration-100",
            hasLink
              ? "bg-[var(--app-accent-soft-bg)] text-[var(--app-accent-soft-fg)]"
              : "bg-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text)]",
          ].join(" ")}
        >
          🔗
        </button>

        {hasLink && (
          <button
            title="Remove link"
            onMouseDown={(e) => {
              e.preventDefault();
              editor?.commands.unsetLink?.();
            }}
            className="px-2 py-1 rounded-md border-none text-[13px] leading-none cursor-pointer bg-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text)] transition-colors duration-100"
          >
            ⛓‍💥
          </button>
        )}

        <button
          title="Clear formatting"
          onMouseDown={(e) => {
            e.preventDefault();
            editor?.commands.clearFormatting();
          }}
          className="px-2 py-1 rounded-md border-none text-[13px] leading-none cursor-pointer bg-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text)] transition-colors duration-100"
        >
          <RemoveFormatting className="w-4 h-4" />
        </button>
      </div>
      )}
    </BubbleMenu>
  );
}

const KINDS: Readonly<Record<string, FieldKindSpec>> = BUILT_IN_FIELD_KINDS;

const chip = (on: boolean) =>
  [
    "px-2 py-1 rounded-md border-none text-[12px] leading-none cursor-pointer transition-colors duration-100",
    on ? "bg-[var(--app-accent-soft-bg)] text-[var(--app-accent-soft-fg)]" : "bg-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text)]",
  ].join(" ");

/**
 * What a selected field offers instead of text formatting: what it is, who
 * fills it, whether it must be filled, a dropdown's choices — and the bold and
 * italic its value is printed in.
 */
function FieldPanel({ editor, pos, node, activeMarks }: { editor: Editor; pos: number; node: PmNode; activeMarks: string[] }) {
  const kind = String(node.attrs["kind"]);
  const signer = node.attrs["fill"] === "signer";
  const role = typeof node.attrs["role"] === "string" ? node.attrs["role"] : null;
  const parsed = FieldChoiceSchema.array().safeParse(node.attrs["options"]);
  const choices = parsed.success ? parsed.data : [];
  const [choiceText, setChoiceText] = useState(() => choices.map((c) => c.label).join(", "));
  // Keep the field selected, so the panel stays open for the next change.
  const set = (attrs: Record<string, unknown>) => {
    editor.setNodeAttrs(pos, attrs);
    const { doc, tr } = editor.getState();
    editor.applyTransaction(tr.setSelection(NodeSelection.create(doc, pos)));
  };
  const saveChoices = () => {
    const labels = choiceText.split(",").map((label) => label.trim()).filter(Boolean);
    const ids = labels.map((label) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    if (labels.length > 0 && new Set(ids).size === ids.length) set({ options: labels.map((label, i) => ({ id: ids[i], label })) });
  };
  const hold = (e: { preventDefault(): void }) => e.preventDefault();

  return (
    <div className="flex flex-col gap-1.5 bg-[var(--app-surface)] text-[var(--app-text)] border border-[var(--app-border)] rounded-[9px] px-2.5 py-2 text-[12px] text-[var(--app-text)] shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-2">
        <span className="inline-block w-3" style={{ borderBottom: `2px dotted ${fieldRoleColor(signer ? role : null)}` }} />
        <span className="font-semibold text-[var(--app-text)]">{KINDS[kind]?.label || kind}</span>
        <span className="text-[var(--app-text-muted)]">{signer ? `${roleName(role)} fills this after sealing` : "The author fills this"}</span>
      </div>
      <div className="flex items-center gap-1">
        {signer && (
          <>
            <span className="mr-1 text-[var(--app-text-muted)]">Filled by</span>
            {SIGNING_ROLES.map((r) => (
              <button key={r} onMouseDown={(e) => { hold(e); set({ role: r }); }} className={chip(role === r)}>
                {ROLE_LABEL[r]}
              </button>
            ))}
            <div className="w-px h-4 bg-[var(--app-border)] mx-1" />
            <button onMouseDown={(e) => { hold(e); set({ required: node.attrs["required"] !== true }); }} className={chip(node.attrs["required"] === true)}>
              Required
            </button>
            <div className="w-px h-4 bg-[var(--app-border)] mx-1" />
          </>
        )}
        <button title="Bold value" onMouseDown={(e) => { hold(e); editor.commands.toggleBold(); }} className={`${chip(activeMarks.includes("bold"))} font-bold`}>
          B
        </button>
        <button title="Italic value" onMouseDown={(e) => { hold(e); editor.commands.toggleItalic(); }} className={`${chip(activeMarks.includes("italic"))} italic`}>
          I
        </button>
        <div className="w-px h-4 bg-[var(--app-border)] mx-1" />
        <button
          title="Remove field"
          onMouseDown={(e) => {
            hold(e);
            editor.applyTransaction(editor.getState().tr.deleteSelection());
          }}
          className={chip(false)}
        >
          Remove
        </button>
      </div>
      {KINDS[kind]?.control === "dropdown" && (
        <input
          value={choiceText}
          onChange={(e) => setChoiceText(e.target.value)}
          onBlur={saveChoices}
          onKeyDown={(e) => e.key === "Enter" && saveChoices()}
          placeholder="Choices, separated by commas"
          className="h-7 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-2)] px-2 text-[12px] text-[var(--app-text)] outline-none focus:border-[var(--app-accent)]"
        />
      )}
    </div>
  );
}
