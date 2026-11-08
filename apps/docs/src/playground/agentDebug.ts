/**
 * Debugging the playground agent the way a host would: what the agent was
 * asked and said, each batch it sent, what applying the batch did, and the
 * document it left. Reach it from the console as `window.scrivrDebug`, or the
 * chat panel's Export button.
 *
 * The record lives in this browser only, kept across reloads so a run can be
 * inspected after the page is refreshed.
 */

import type { Editor } from "@scrivr/core";
import { getAiToolkit } from "@scrivr/ai";
import { findChanges } from "@scrivr/plugins";

/** One `edit_document` batch: what the agent sent, and what applying it did. */
export interface AgentEditRecord {
  at: string;
  toolCallId: string;
  edits: unknown[];
  invalid: Array<{ index: number; error: string }>;
  result: { applied: boolean; changed: string[]; rejected: string[]; notFound: string[]; stale: string[] };
}

interface AgentDebugRecord {
  thread: unknown[];
  edits: AgentEditRecord[];
}

const STORAGE_KEY = "scrivr-playground-agent-debug";

function isAgentEditRecord(value: unknown): value is AgentEditRecord {
  return typeof value === "object" && value !== null &&
    "at" in value && typeof value.at === "string" &&
    "toolCallId" in value && typeof value.toolCallId === "string" &&
    "edits" in value && Array.isArray(value.edits) &&
    "invalid" in value && Array.isArray(value.invalid) &&
    "result" in value && typeof value.result === "object" && value.result !== null;
}

function load(): AgentDebugRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && "thread" in parsed && "edits" in parsed &&
      Array.isArray(parsed.thread) && Array.isArray(parsed.edits)) {
      return { thread: parsed.thread, edits: parsed.edits.filter(isAgentEditRecord) };
    }
  } catch {
    // Storage can be unavailable or hold something else; start empty.
  }
  return { thread: [], edits: [] };
}

let record = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Debug only: a full or blocked store just means nothing survives a reload.
  }
}

/** The chat as it stands — every message and tool part the agent exchanged. */
export function recordThread(messages: unknown[]) {
  record = { ...record, thread: messages };
  save();
}

export function recordEdit(entry: AgentEditRecord) {
  record = { ...record, edits: [...record.edits, entry] };
  save();
}

export function clearAgentDebug() {
  record = { thread: [], edits: [] };
  save();
}

/** The document and the agent's record, as one serializable snapshot. */
export function agentDebugSnapshot(editor: Editor | null) {
  const state = editor?.getState();
  const ai = editor ? getAiToolkit(editor) : null;
  const changes = state ? findChanges(state).changes : [];
  return {
    exportedAt: new Date().toISOString(),
    document: {
      json: state?.doc.toJSON() ?? null,
      // Pending changes as CriticMarkup: {++added++}, {--removed--}.
      markdown: editor ? editor.getMarkdown() : null,
      // One unit per block, as the agent reads the document.
      units: ai ? ai.getRichBlocks() : null,
      changes: changes.map((change) => ({
        id: change.id,
        type: change.type,
        operation: change.dataTracked.operation,
        status: change.dataTracked.status,
        author: change.dataTracked.authorID,
        from: change.from,
        to: change.to,
        ...(change.dataTracked.moveNodeId ? { moveNodeId: change.dataTracked.moveNodeId } : {}),
      })),
    },
    agent: record,
  };
}

/** Saves the snapshot as a JSON file. */
export function downloadAgentDebug(editor: Editor | null) {
  const blob = new Blob([JSON.stringify(agentDebugSnapshot(editor), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `scrivr-agent-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Console handles: `scrivrEditor`, `scrivrAi`, and `scrivrDebug` with
 * `snapshot()`, `download()`, `markdown()` and `clear()`.
 */
export function installAgentDebug(editor: Editor | null) {
  if (typeof window === "undefined") return;
  Object.assign(window, {
    scrivrEditor: editor,
    scrivrAi: editor ? getAiToolkit(editor) : null,
    scrivrDebug: {
      snapshot: () => agentDebugSnapshot(editor),
      download: () => downloadAgentDebug(editor),
      markdown: () => agentDebugSnapshot(editor).document.markdown,
      clear: clearAgentDebug,
    },
  });
}
