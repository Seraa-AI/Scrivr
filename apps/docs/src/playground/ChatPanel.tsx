import { useRef, useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage, DataUIPart } from "ai";
import type { Editor } from "@scrivr/core";
import { findLiveNodeById, getAiToolkit, parseSemanticEdits } from "@scrivr/ai";
import type { DocUnit, ToolOutputData } from "../routes/api/ai";
import { clearAgentDebug, downloadAgentDebug, recordEdit, recordThread } from "./agentDebug";

type AppDataTypes = { tool_result: ToolOutputData };
type AppUIMessage = UIMessage<unknown, AppDataTypes>;

interface ChatPanelProps {
  editor: Editor | null;
  hideBorder?: boolean;
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function getDocContext(editor: Editor | null): {
  units?: DocUnit[];
  context?: string;
} {
  if (!editor) return {};

  const ai = getAiToolkit(editor);
  if (!ai) {
    const text = editor.getState().doc.textContent.slice(0, 600);
    return text ? { context: text } : {};
  }

  const state = editor.getState();
  const { from, to } = state.selection;
  const hasSelection = from !== to;

  // The rich view carries the ids of list items and table cells, which
  // structural edits address; a host sends the agent the same.
  const units: DocUnit[] = (hasSelection ? ai.getRichBlocks(from, to) : ai.getRichBlocks()).map((unit) => ({
    id: unit.id,
    type: unit.type,
    text: unit.text,
    ...(unit.headingLevel ? { headingLevel: unit.headingLevel } : {}),
    ...(unit.parts ? { parts: unit.parts.map((part) => ({ nodeId: part.nodeId, text: part.text })) } : {}),
    ...(unit.image ? { image: unit.image } : {}),
    ...(findLiveNodeById(state.doc, unit.id) ? {} : { proposedForDeletion: true }),
    ...(unit.changes ? {
      changes: unit.changes.map(({ type, text, id, at, authorId, oldAttrs, image }) => ({
        type,
        text,
        ...(id ? { id } : {}),
        ...(at !== undefined ? { at } : {}),
        ...(authorId ? { authorId } : {}),
        ...(oldAttrs ? { oldAttrs } : {}),
        ...(image ? { image: image.src } : {}),
      })),
    } : {}),
  }));
  return units.length > 0 ? { units } : {};
}

export function ChatPanel({ editor, hideBorder }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const [selectionPreview, setSelectionPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const state = editor.getState();
      const { from, to } = state.selection;
      if (from !== to) {
        const text = state.doc.textBetween(from, to, " ");
        setSelectionPreview(text.length > 120 ? text.slice(0, 120) + "…" : text);
      } else {
        setSelectionPreview(null);
      }
    };
    update();
    return editor.subscribe(update);
  }, [editor]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai",
        fetch: async (input, init) => {
          const body = JSON.parse((init?.body as string) ?? "{}");
          Object.assign(body, getDocContext(editorRef.current));
          return fetch(input, { ...init, body: JSON.stringify(body) });
        },
      }),
    [],
  );

  const [inputValue, setInputValue] = useState("");
  const [lastEdit, setLastEdit] = useState<string | null>(null);
  const pendingSelection = useRef<{ from: number; to: number } | null>(null);

  function applyToolResult(dataPart: DataUIPart<AppDataTypes>) {
    if (dataPart.type !== "data-tool_result") return;
    const ed = editorRef.current;
    if (!ed) return;

    const { toolType, output } = dataPart.data;

    if (toolType === "edit_paragraph") {
      const { nodeId, proposedText } = output as { nodeId?: string; proposedText?: string };
      if (!nodeId || !proposedText) return;
      const ai = getAiToolkit(ed);
      const suggestion = ai?.suggestions?.compute({
        blocks: [{ nodeId, proposedText }],
        authorID: "AI Assistant",
      });
      if (suggestion) ai?.suggestions?.show(suggestion);
      return;
    }

    if (toolType === "edit_section") {
      const { edits } = output as { edits?: Array<{ nodeId: string; proposedText: string }> };
      if (!edits?.length) return;
      const ai = getAiToolkit(ed);
      const suggestion = ai?.suggestions?.compute({
        blocks: edits,
        authorID: "AI Assistant",
      });
      if (suggestion) ai?.suggestions?.show(suggestion);
      return;
    }

    if (toolType === "edit_document") {
      // What a host does with an agent's batch: validate it against the
      // protocol, apply it as tracked changes, and report what landed.
      const ai = getAiToolkit(ed);
      if (!ai) return;
      const parsed = parseSemanticEdits(output["edits"]);
      const result = ai.applySemanticEdits(parsed.edits);
      const parts = [
        `changed ${result.changed.join(", ") || "nothing"}`,
        result.rejected.length ? `rejected ${result.rejected.join(", ")}` : "",
        result.notFound.length ? `not found ${result.notFound.join(", ")}` : "",
        result.stale.length ? `stale ${result.stale.join(", ")}` : "",
        parsed.rejected.length ? `invalid ${parsed.rejected.map((r) => r.error).join("; ")}` : "",
      ].filter(Boolean);
      setLastEdit(parts.join(" · "));
      recordEdit({
        at: new Date().toISOString(),
        toolCallId: dataPart.data.toolCallId,
        edits: parsed.edits,
        invalid: parsed.rejected,
        result: { applied: result.applied, changed: result.changed, rejected: result.rejected, notFound: result.notFound, stale: result.stale },
      });
      return;
    }

    if (toolType === "review_changes") {
      // A host decides whether an agent may review (`canAcceptReject`); the
      // outcome says what happened, or why not.
      const ai = getAiToolkit(ed);
      if (!ai) return;
      const outcome = ai.reviewChanges({ accepted: stringList(output["accepted"]), rejected: stringList(output["rejected"]) });
      setLastEdit(outcome.status === "applied"
        ? `accepted ${outcome.accepted.join(", ") || "nothing"} · rejected ${outcome.rejected.join(", ") || "nothing"}`
        : `review ${outcome.status}: ${outcome.reason}`);
      return;
    }

    const isInsert  = toolType === "insert_text";
    const isReplace = toolType === "replace_selection";
    if (!(isInsert || isReplace)) return;
    const { text } = output as { text?: string };
    if (!text) return;

    const state = ed.getState();
    const sel   = pendingSelection.current ?? { from: state.selection.from, to: state.selection.from };
    const from  = sel.from;
    const to    = isReplace && sel.from !== sel.to ? sel.to : sel.from;
    ed.commands["insertAsSuggestion"]?.(text, from, to, "AI Assistant");
  }

  const { messages, sendMessage, status, setMessages } = useChat<AppUIMessage>({
    transport,
    onData: applyToolResult,
  });
  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    // A fresh page starts with no messages; keep the last run's record until there is a new one.
    if (messages.length > 0) recordThread(messages);
  }, [messages]);

  function submit() {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    if (editorRef.current) {
      const s = editorRef.current.getState().selection;
      pendingSelection.current = { from: s.from, to: s.to };
    }
    sendMessage({ text });
    setInputValue("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <aside
      className="w-full flex-1 flex flex-col overflow-hidden"
      style={{
        background: "var(--app-surface)",
        ...(hideBorder ? {} : { borderLeft: "1px solid var(--app-border)" }),
      }}
    >
      {/* Header */}
      <div
        className="flex items-center h-11 px-3.5 border-b shrink-0 gap-2"
        style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
      >
        <span className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--app-text)" }}>
          AI Assistant
        </span>
        <span
          className="ml-auto text-[11px] font-medium border rounded-full px-2 py-px tracking-wide"
          style={{
            background: "var(--app-accent-soft-bg)",
            borderColor: "var(--app-accent-soft-border)",
            color: "var(--app-accent-soft-fg)",
          }}
        >
          Claude
        </span>
        <button
          type="button"
          className="text-[11px] border rounded px-1.5 py-px"
          style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
          title="Download the document, its pending changes, the agent thread and every batch it applied"
          onClick={() => downloadAgentDebug(editorRef.current)}
        >
          Export
        </button>
        <button
          type="button"
          className="text-[11px] border rounded px-1.5 py-px"
          style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
          title="Start a new thread and forget the recorded one"
          onClick={() => {
            setMessages([]);
            setLastEdit(null);
            clearAgentDebug();
          }}
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 pt-3.5 pb-1.5 flex flex-col gap-2.5">
        {messages.length === 0 && (
          <p
            className="text-[12px] text-center mt-8 leading-relaxed px-2"
            style={{ color: "var(--app-text-faint)" }}
          >
            Ask anything — Claude has your document context and can edit text directly.
          </p>
        )}

        {messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}

        {isLoading && (
          <div
            className="self-start border rounded-[12px_12px_12px_3px] px-3 py-2 max-w-[92%] text-[13px] leading-relaxed"
            style={{ background: "var(--app-surface-2)", borderColor: "var(--app-border)" }}
          >
            <span className="text-[12px] italic" style={{ color: "var(--app-text-faint)" }}>
              Thinking…
            </span>
          </div>
        )}

        {lastEdit && (
          <div className="text-[11px] leading-snug px-1" style={{ color: "var(--app-text-muted)" }}>
            Agent edit: {lastEdit}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="px-3 py-2.5 border-t flex flex-col gap-1.5 shrink-0"
        style={{ borderColor: "var(--app-border)", background: "var(--app-surface)" }}
      >
        {selectionPreview && (
          <div
            className="flex items-start gap-1.5 border rounded-md px-2 py-1.5 text-[11px] leading-snug"
            style={{
              background: "var(--app-accent-soft-bg)",
              borderColor: "var(--app-accent-soft-border)",
            }}
          >
            <span
              className="font-bold uppercase tracking-wider shrink-0 text-[10px] pt-px"
              style={{ color: "var(--app-accent)" }}
            >
              Selection
            </span>
            <span
              className="italic overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ color: "var(--app-accent-soft-fg)" }}
            >
              {selectionPreview}
            </span>
          </div>
        )}
        <textarea
          ref={inputRef}
          className="w-full resize-none border rounded-lg px-2.5 py-2 text-[13px] font-[inherit] outline-none leading-relaxed box-border disabled:opacity-50"
          style={{
            borderColor: "var(--app-border)",
            background: "var(--app-surface-2)",
            color: "var(--app-text)",
          }}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Claude… (Enter to send)"
          rows={3}
          disabled={isLoading}
        />
        <button
          className="self-end border-none rounded-lg px-4 py-1.5 text-[13px] font-semibold cursor-pointer tracking-tight transition-colors disabled:opacity-40"
          style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--app-accent-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--app-accent)";
          }}
          onClick={submit}
          disabled={isLoading || !inputValue.trim()}
        >
          Send
        </button>
      </div>
    </aside>
  );
}

function MessageRow({ msg }: { msg: UIMessage }) {
  if (msg.role === "user") {
    return (
      <div
        className="self-end rounded-[12px_12px_3px_12px] px-3 py-2 max-w-[85%] text-[13px] leading-relaxed ml-auto"
        style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}
      >
        {msg.parts.map((part, i) =>
          part.type === "text" ? (
            <div key={i} className="whitespace-pre-wrap wrap-break-word">{part.text}</div>
          ) : null,
        )}
      </div>
    );
  }

  return (
    <div
      className="self-start border rounded-[12px_12px_12px_3px] px-3 py-2 max-w-[92%] text-[13px] leading-relaxed flex flex-col gap-2"
      style={{ background: "var(--app-surface-2)", borderColor: "var(--app-border)" }}
    >
      {msg.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div
              key={i}
              className="whitespace-pre-wrap wrap-break-word"
              style={{ color: "var(--app-text)" }}
            >
              {part.text}
            </div>
          );
        }

        if (part.type === "tool-edit_paragraph") {
          const p = part as { type: string; output?: { proposedText?: string } };
          return <SuggestionCard key={i} label="Edit paragraph" text={p.output?.proposedText ?? ""} />;
        }

        if (part.type === "tool-edit_section") {
          const p = part as { type: string; output?: { edits?: Array<{ nodeId: string; proposedText: string }> } };
          const count = p.output?.edits?.length ?? 0;
          const preview = p.output?.edits?.map((e) => e.proposedText).join("\n\n") ?? "";
          return (
            <SuggestionCard
              key={i}
              label={`Edit section (${count} paragraph${count !== 1 ? "s" : ""})`}
              text={preview}
            />
          );
        }

        if (part.type === "tool-insert_text" || part.type === "tool-replace_selection") {
          const isInsert = part.type === "tool-insert_text";
          const p = part as { type: string; output?: { text?: string } };
          return (
            <SuggestionCard
              key={i}
              label={isInsert ? "Insert suggestion" : "Replace suggestion"}
              text={p.output?.text ?? ""}
            />
          );
        }

        return null;
      })}
    </div>
  );
}
  
function SuggestionCard({ label, text }: { label: string; text: string }) {
  if (!text) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--app-accent)" }}
        >
          {label}
        </span>
        <span className="text-[12px] italic" style={{ color: "var(--app-text-faint)" }}>
          Generating…
        </span>
      </div>
    );
  }
  return (
    <div
      className="border rounded-lg px-2.5 py-2 flex flex-col gap-1.5"
      style={{
        background: "var(--app-surface)",
        borderColor: "var(--app-accent-soft-border)",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--app-accent)" }}
        >
          {label}
        </span>
        <span
          className="text-[10px] font-semibold rounded-full px-2 py-px tracking-wide"
          style={{
            background: "var(--app-accent-soft-bg)",
            color: "var(--app-accent-soft-fg)",
          }}
        >
          Review in editor
        </span>
      </div>
      <pre
        className="m-0 text-[12px] leading-relaxed whitespace-pre-wrap wrap-break-word rounded px-2 py-1.5 max-h-[120px] overflow-y-auto font-[inherit]"
        style={{ background: "var(--app-surface-2)", color: "var(--app-text-muted)" }}
      >
        {text}
      </pre>
    </div>
  );
}
