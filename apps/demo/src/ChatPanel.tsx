import { useRef, useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import type { Editor } from "@inscribe/core";
import { buildParagraphContexts, applyDiffAsSuggestion } from "@inscribe/plugins";

interface ChatPanelProps {
  editor: Editor | null;
}

function getDocContext(editor: Editor | null): {
  context?: string;
  paragraphContexts?: ReturnType<typeof buildParagraphContexts>;
} {
  if (!editor) return {};
  // Prefer structured paragraph contexts (used by edit_paragraph tool).
  // Fall back to plain text for selection context.
  const paragraphContexts = buildParagraphContexts(editor);
  if (paragraphContexts.length > 0) {
    const state = editor.getState();
    const { from, to } = state.selection;
    const selected = from !== to ? state.doc.textBetween(from, to, "\n") : undefined;
    const result: { paragraphContexts: typeof paragraphContexts; context?: string } = { paragraphContexts };
    if (selected) result.context = selected;
    return result;
  }
  const state = editor.getState();
  const { from, to } = state.selection;
  const selected = from !== to ? state.doc.textBetween(from, to, "\n") : "";
  const fallback = selected || state.doc.textContent.slice(0, 600);
  const result: { context?: string } = {};
  if (fallback) result.context = fallback;
  return result;
}

export function ChatPanel({ editor }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Stable transport — injects current document context on every request
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai",
        fetch: async (input, init) => {
          const body = JSON.parse((init?.body as string) ?? "{}");
          const docCtx = getDocContext(editorRef.current);
          Object.assign(body, docCtx);
          return fetch(input, { ...init, body: JSON.stringify(body) });
        },
      }),
    [],
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";

  const [inputValue, setInputValue] = useState("");

  // Track which tool call IDs have already been applied to the document.
  const appliedToolCalls = useRef(new Set<string>());
  // Capture the selection at the time the user hits Send, so we know where to insert.
  const pendingSelection = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-apply AI tool results as tracked changes the moment they arrive.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts) {
        const p = part as {
          type: string;
          toolCallId?: string;
          output?: { text?: string; nodeId?: string; proposedText?: string };
        };
        if (!p.toolCallId) continue;
        if (appliedToolCalls.current.has(p.toolCallId)) continue;

        if (p.type === "tool-edit_paragraph") {
          const { nodeId, proposedText } = p.output ?? {};
          if (!nodeId || !proposedText) continue;
          appliedToolCalls.current.add(p.toolCallId);
          const state = ed.getState();
          applyDiffAsSuggestion(state, (tr) => ed._applyTransaction(tr), {
            nodeId,
            proposedText,
            authorID: "AI Assistant",
          });
          continue;
        }

        const isInsert = p.type === "tool-insert_text";
        const isReplace = p.type === "tool-replace_selection";
        if (!(isInsert || isReplace)) continue;
        if (!p.output?.text) continue;

        appliedToolCalls.current.add(p.toolCallId);

        const state = ed.getState();
        const sel = pendingSelection.current ?? { from: state.selection.from, to: state.selection.from };
        const from = sel.from;
        const to = isReplace && sel.from !== sel.to ? sel.to : sel.from;

        // Route through TrackChanges.insertAsSuggestion so the edit always
        // appears as a pending suggestion regardless of tracking mode.
        ed.commands["insertAsSuggestion"]?.(p.output.text, from, to, "AI Assistant");
      }
    }
  }, [messages]);

  function submit() {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    // Snapshot the current selection before sending — used when applying the suggestion.
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
    <aside style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>AI Assistant</span>
        <span style={styles.headerBadge}>Claude</span>
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            Ask anything — Claude has your document context and can insert text directly.
          </div>
        )}

        {messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}

        {isLoading && (
          <div style={styles.aiBubble}>
            <span style={styles.thinking}>Thinking…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div style={styles.inputArea}>
        <textarea
          ref={inputRef}
          style={styles.textarea}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Claude… (Enter to send, Shift+Enter for newline)"
          rows={3}
          disabled={isLoading}
        />
        <button
          style={{ ...styles.sendBtn, opacity: isLoading || !inputValue.trim() ? 0.5 : 1 }}
          onClick={submit}
          disabled={isLoading || !inputValue.trim()}
        >
          Send
        </button>
      </div>
    </aside>
  );
}

// ── Per-message row ────────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: UIMessage }) {
  if (msg.role === "user") {
    return (
      <div style={styles.userBubble}>
        {msg.parts.map((part, i) =>
          part.type === "text" ? (
            <div key={i} style={styles.bubbleText}>
              {part.text}
            </div>
          ) : null,
        )}
      </div>
    );
  }

  return (
    <div style={styles.aiBubble}>
      {msg.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div key={i} style={styles.bubbleText}>
              {part.text}
            </div>
          );
        }

        if (part.type === "tool-edit_paragraph") {
          const p = part as { type: string; output?: { nodeId?: string; proposedText?: string } };
          return (
            <SuggestionCard
              key={i}
              label="Edit paragraph"
              text={p.output?.proposedText ?? ""}
            />
          );
        }

        if (part.type === "tool-insert_text" || part.type === "tool-replace_selection") {
          const isInsert = part.type === "tool-insert_text";
          const p = part as { type: string; output?: { text?: string } };
          const text = p.output?.text ?? "";
          return (
            <SuggestionCard
              key={i}
              label={isInsert ? "Insert suggestion" : "Replace suggestion"}
              text={text}
            />
          );
        }

        return null;
      })}
    </div>
  );
}

// ── Suggestion card ────────────────────────────────────────────────────────────

function SuggestionCard({ label, text }: { label: string; text: string }) {
  if (!text) {
    return (
      <div style={styles.toolPending}>
        <span style={styles.toolLabel}>{label}</span>
        <span style={styles.thinking}>Generating…</span>
      </div>
    );
  }

  return (
    <div style={styles.toolCard}>
      <div style={styles.toolCardHeader}>
        <span style={styles.toolLabel}>{label}</span>
        <span style={styles.suggestionBadge}>Added to document</span>
      </div>
      <pre style={styles.toolText}>{text}</pre>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  panel: {
    width: 320,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column" as const,
    background: "#fff",
    borderLeft: "1px solid #e2e8f0",
    overflow: "hidden",
  },
  header: {
    padding: "10px 14px",
    background: "#0f172a",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  headerTitle: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "monospace",
  },
  headerBadge: {
    fontSize: 10,
    background: "#7c3aed",
    color: "#ede9fe",
    padding: "2px 7px",
    borderRadius: 4,
    fontFamily: "monospace",
    marginLeft: "auto",
  },
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "12px 12px 4px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  },
  empty: {
    color: "#94a3b8",
    fontSize: 12,
    textAlign: "center" as const,
    marginTop: 24,
    lineHeight: 1.6,
  },
  userBubble: {
    alignSelf: "flex-end" as const,
    background: "#1e40af",
    color: "#fff",
    borderRadius: "12px 12px 2px 12px",
    padding: "8px 12px",
    maxWidth: "85%",
    fontSize: 13,
    lineHeight: 1.5,
    marginLeft: "auto",
  },
  aiBubble: {
    alignSelf: "flex-start" as const,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px 12px 12px 2px",
    padding: "8px 12px",
    maxWidth: "92%",
    fontSize: 13,
    lineHeight: 1.5,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  bubbleText: {
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  thinking: {
    color: "#94a3b8",
    fontSize: 12,
    fontStyle: "italic" as const,
  },
  toolCard: {
    background: "#fff",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  toolCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between" as const,
  },
  suggestionBadge: {
    fontSize: 10,
    background: "#dcfce7",
    color: "#15803d",
    padding: "2px 6px",
    borderRadius: 4,
    fontWeight: 600,
    fontFamily: "monospace",
  },
  toolPending: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "4px 0",
  },
  toolLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#7c3aed",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  toolText: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#1e293b",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    background: "#f1f5f9",
    borderRadius: 4,
    padding: "6px 8px",
    maxHeight: 120,
    overflowY: "auto" as const,
  },
  inputArea: {
    padding: "10px 12px",
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    flexShrink: 0,
  },
  textarea: {
    width: "100%",
    resize: "none" as const,
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    lineHeight: 1.5,
    boxSizing: "border-box" as const,
    background: "#f8fafc",
  },
  sendBtn: {
    background: "#1e40af",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "7px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    alignSelf: "flex-end" as const,
  },
} as const;

