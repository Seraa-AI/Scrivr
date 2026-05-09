import { useRef, useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage, DataUIPart } from "ai";
import type { Editor } from "@scrivr/core";
import { getAiToolkit } from "@scrivr/plugins";
import type { ToolOutputData } from "../routes/api/ai";

type AppDataTypes = { tool_result: ToolOutputData };
type AppUIMessage = UIMessage<unknown, AppDataTypes>;

interface ChatPanelProps {
  editor: Editor | null;
  hideBorder?: boolean;
}

function getDocContext(editor: Editor | null): {
  blocks?: Array<{ nodeId: string; text: string }>;
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

  const blocks = hasSelection ? ai.getBlocks(from, to) : ai.getBlocks();
  return blocks.length > 0 ? { blocks } : {};
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

  const { messages, sendMessage, status } = useChat<AppUIMessage>({
    transport,
    onData: applyToolResult,
  });
  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
