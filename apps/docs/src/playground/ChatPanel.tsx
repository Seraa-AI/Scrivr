import { useRef, useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage, DataUIPart } from "ai";
import type { Editor } from "@inscribe/core";
import { getAiToolkit, applyDiffAsSuggestion, applyMultiBlockDiff } from "@inscribe/plugins";
import type { ToolOutputData } from "../routes/api/ai";

// ── Typed data layer ─────────────────────────────────────────────────────────
type AppDataTypes = { tool_result: ToolOutputData };
type AppUIMessage = UIMessage<unknown, AppDataTypes>;

interface ChatPanelProps {
  editor: Editor | null;
}

// ── Document context ────────────────────────────────────────────────────────

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

// ── Component ───────────────────────────────────────────────────────────────

export function ChatPanel({ editor }: ChatPanelProps) {
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
      applyDiffAsSuggestion(ed.getState(), (tr) => ed._applyTransaction(tr), {
        nodeId,
        proposedText,
        authorID: "AI Assistant",
      });
      return;
    }

    if (toolType === "edit_section") {
      const { edits } = output as { edits?: Array<{ nodeId: string; proposedText: string }> };
      if (!edits?.length) return;
      applyMultiBlockDiff(ed.getState(), (tr) => ed._applyTransaction(tr), {
        blocks: edits,
        authorID: "AI Assistant",
      });
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
    console.log(text, isLoading)
    if (!text || isLoading) return;
    if (editorRef.current) {
      const s = editorRef.current.getState().selection;
      pendingSelection.current = { from: s.from, to: s.to };
    }
    console.log("Subbimting")
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
    <aside className="w-[300px] shrink-0 flex flex-col bg-white border-l border-[#e8eaed] overflow-hidden">
      {/* Header */}
      <div className="flex items-center h-11 px-3.5 bg-white border-b border-[#e8eaed] shrink-0 gap-2">
        <span className="text-[13px] font-semibold text-gray-900 tracking-tight">AI Assistant</span>
        <span className="ml-auto text-[11px] font-medium bg-indigo-50 text-indigo-500 border border-indigo-200 rounded-full px-2 py-px tracking-wide">
          Claude
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 pt-3.5 pb-1.5 flex flex-col gap-2.5">
        {messages.length === 0 && (
          <p className="text-[12px] text-gray-400 text-center mt-8 leading-relaxed px-2">
            Ask anything — Claude has your document context and can edit text directly.
          </p>
        )}

        {messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}

        {isLoading && (
          <div className="self-start bg-gray-50 border border-[#e8eaed] rounded-[12px_12px_12px_3px] px-3 py-2 max-w-[92%] text-[13px] leading-relaxed">
            <span className="text-[12px] text-gray-400 italic">Thinking…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-3 py-2.5 border-t border-[#e8eaed] flex flex-col gap-1.5 shrink-0 bg-white">
        {selectionPreview && (
          <div className="flex items-start gap-1.5 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1.5 text-[11px] leading-snug">
            <span className="font-bold text-indigo-500 uppercase tracking-wider shrink-0 text-[10px] pt-px">
              Selection
            </span>
            <span className="text-indigo-700 italic overflow-hidden text-ellipsis whitespace-nowrap">
              {selectionPreview}
            </span>
          </div>
        )}
        <textarea
          ref={inputRef}
          className="w-full resize-none border border-[#e8eaed] rounded-lg px-2.5 py-2 text-[13px] font-[inherit] outline-none leading-relaxed box-border bg-gray-50 text-gray-900 placeholder:text-gray-400 disabled:opacity-50"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Claude… (Enter to send)"
          rows={3}
          disabled={isLoading}
        />
        <button
          className="self-end bg-indigo-500 hover:bg-indigo-600 text-white border-none rounded-lg px-4 py-1.5 text-[13px] font-semibold cursor-pointer tracking-tight transition-colors disabled:opacity-40"
          onClick={submit}
          disabled={isLoading || !inputValue.trim()}
        >
          Send
        </button>
      </div>
    </aside>
  );
}

// ── Per-message row ─────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: UIMessage }) {
  if (msg.role === "user") {
    return (
      <div className="self-end bg-indigo-500 text-white rounded-[12px_12px_3px_12px] px-3 py-2 max-w-[85%] text-[13px] leading-relaxed ml-auto">
        {msg.parts.map((part, i) =>
          part.type === "text" ? (
            <div key={i} className="whitespace-pre-wrap wrap-break-word">{part.text}</div>
          ) : null,
        )}
      </div>
    );
  }

  return (
    <div className="self-start bg-gray-50 border border-[#e8eaed] rounded-[12px_12px_12px_3px] px-3 py-2 max-w-[92%] text-[13px] leading-relaxed flex flex-col gap-2">
      {msg.parts.map((part, i) => {
        if (part.type === "text") {
          return <div key={i} className="whitespace-pre-wrap wrap-break-word text-gray-800">{part.text}</div>;
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

// ── Suggestion card ─────────────────────────────────────────────────────────

function SuggestionCard({ label, text }: { label: string; text: string }) {
  if (!text) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">{label}</span>
        <span className="text-[12px] text-gray-400 italic">Generating…</span>
      </div>
    );
  }
  return (
    <div className="bg-white border border-emerald-200 rounded-lg px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 rounded-full px-2 py-px tracking-wide">
          Added to document
        </span>
      </div>
      <pre className="m-0 text-[12px] leading-relaxed text-gray-700 whitespace-pre-wrap wrap-break-word bg-gray-50 rounded px-2 py-1.5 max-h-[120px] overflow-y-auto font-[inherit]">
        {text}
      </pre>
    </div>
  );
}
