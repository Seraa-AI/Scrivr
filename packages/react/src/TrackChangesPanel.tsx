/**
 * TrackChangesPanel — sidebar panel listing all pending tracked changes.
 *
 * Shows text insertions/deletions (grouped as "Replacement" when paired),
 * inline format changes (bold, italic, color…), block attribute changes
 * (alignment, heading level…), and structural changes (wrap, node insert/delete).
 *
 * Each row has Accept / Reject buttons. Header has Accept All / Reject All.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@scrivr/core";
import {
  trackChangesPluginKey,
  CHANGE_OPERATION,
  CHANGE_STATUS,
} from "@scrivr/plugins";
import type {
  TrackedChange,
  TextChange,
  MarkChange,
  NodeAttrChange,
} from "@scrivr/plugins";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A display-ready item — either a paired replacement or a single change.
 */
type DisplayItem =
  | {
      kind:         "replacement";
      deleteChange: TextChange;
      insertChange: TextChange;
      ids:          string[];
      authorID:     string;
    }
  | {
      kind:   "single";
      change: TrackedChange;
    };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Group text changes that share a groupId into replacement pairs. */
function buildDisplayItems(changes: TrackedChange[]): DisplayItem[] {
  const byGroupId = new Map<string, TrackedChange[]>();
  const ungrouped: TrackedChange[] = [];

  for (const c of changes) {
    const gid = (c.dataTracked as Record<string, unknown>).groupId as string | undefined;
    if (gid) {
      if (!byGroupId.has(gid)) byGroupId.set(gid, []);
      byGroupId.get(gid)!.push(c);
    } else {
      ungrouped.push(c);
    }
  }

  const items: DisplayItem[] = [];

  for (const group of byGroupId.values()) {
    const del = group.find(
      c => c.type === "text-change" && c.dataTracked.operation === CHANGE_OPERATION.delete,
    ) as TextChange | undefined;
    const ins = group.find(
      c => c.type === "text-change" && c.dataTracked.operation === CHANGE_OPERATION.insert,
    ) as TextChange | undefined;

    if (del && ins) {
      items.push({
        kind:         "replacement",
        deleteChange: del,
        insertChange: ins,
        ids:          group.map(c => c.id),
        authorID:     del.dataTracked.authorID,
      });
    } else {
      group.forEach(c => items.push({ kind: "single", change: c }));
    }
  }

  ungrouped.forEach(c => items.push({ kind: "single", change: c }));

  // Sort by earliest document position
  items.sort((a, b) => {
    const af = a.kind === "replacement"
      ? Math.min(a.deleteChange.from, a.insertChange.from)
      : a.change.from;
    const bf = b.kind === "replacement"
      ? Math.min(b.deleteChange.from, b.insertChange.from)
      : b.change.from;
    return af - bf;
  });

  return items;
}

function shortName(authorID: string): string {
  const name = authorID.split(":").pop() ?? authorID;
  return name.length > 22 ? name.slice(0, 22) + "…" : name;
}

function truncate(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ── Change metadata ────────────────────────────────────────────────────────────

interface ChangeMeta {
  icon:    string;
  label:   string;
  color:   string;
  bgColor: string;
}

const MARK_ICONS: Record<string, string> = {
  bold:          "B",
  italic:        "I",
  underline:     "U",
  strikethrough: "S",
  highlight:     "H",
  color:         "●",
  font_size:     "Aa",
  font_family:   "Ff",
  link:          "↗",
};

const MARK_LABELS: Record<string, string> = {
  bold:          "Bold",
  italic:        "Italic",
  underline:     "Underline",
  strikethrough: "Strikethrough",
  highlight:     "Highlight",
  color:         "Color",
  font_size:     "Font Size",
  font_family:   "Font Family",
  link:          "Link",
};

const ATTR_LABELS: Record<string, string> = {
  align:      "Alignment",
  level:      "Heading level",
  fontFamily: "Font",
  fontSize:   "Font size",
  indent:     "Indent",
};

function getChangeMeta(change: TrackedChange): ChangeMeta {
  const op = change.dataTracked.operation;

  if (change.type === "text-change") {
    if (op === CHANGE_OPERATION.insert)
      return { icon: "+", label: "Insertion", color: "#15803d", bgColor: "#dcfce7" };
    return { icon: "−", label: "Deletion", color: "#b91c1c", bgColor: "#fee2e2" };
  }

  if (change.type === "mark-change") {
    const mc = change as MarkChange;
    const name = mc.mark.type.name;
    const isRemoval = op === CHANGE_OPERATION.delete;
    return {
      icon:    MARK_ICONS[name] ?? "M",
      label:   `${MARK_LABELS[name] ?? name} ${isRemoval ? "removed" : "added"}`,
      color:   "#6d28d9",
      bgColor: "#ede9fe",
    };
  }

  if (change.type === "node-attr-change") {
    return { icon: "≡", label: "Style changed", color: "#0369a1", bgColor: "#e0f2fe" };
  }

  if (change.type === "wrap-change") {
    return { icon: "⊞", label: "Structure", color: "#92400e", bgColor: "#fef3c7" };
  }

  if (change.type === "node-change") {
    if (op === CHANGE_OPERATION.insert)
      return { icon: "□+", label: "Block added", color: "#15803d", bgColor: "#dcfce7" };
    if (op === CHANGE_OPERATION.delete)
      return { icon: "□−", label: "Block removed", color: "#b91c1c", bgColor: "#fee2e2" };
    return { icon: "□", label: "Block changed", color: "#64748b", bgColor: "#f1f5f9" };
  }

  if (change.type === "reference-change") {
    return { icon: "↗", label: "Reference", color: "#0369a1", bgColor: "#e0f2fe" };
  }

  return { icon: "?", label: op ?? "Change", color: "#64748b", bgColor: "#f1f5f9" };
}

/** Describe what changed in a NodeAttrChange. */
function describeAttrChange(change: NodeAttrChange): string {
  const old = change.oldAttrs as Record<string, unknown>;
  const next = change.newAttrs as Record<string, unknown>;
  const parts: string[] = [];
  const allKeys = new Set([...Object.keys(old), ...Object.keys(next)]);

  for (const key of allKeys) {
    if (key === "nodeId" || key === "dataTracked") continue;
    if (old[key] !== next[key]) {
      const label = ATTR_LABELS[key] ?? key;
      const from  = old[key] == null ? "none" : String(old[key]);
      const to    = next[key] == null ? "none" : String(next[key]);
      parts.push(`${label}: ${from} → ${to}`);
    }
  }

  return parts.join(" · ");
}

/** Describe a MarkChange for display. */
function describeMarkChange(change: MarkChange): string {
  const text = (change.node as { text?: string }).text;
  const colorAttr = (change.mark.attrs as Record<string, unknown>).color;
  if (colorAttr && typeof colorAttr === "string") {
    return text ? `"${truncate(text)}" → ${colorAttr}` : colorAttr;
  }
  return text ? `"${truncate(text)}"` : "";
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TrackChangesPanelProps {
  editor: Editor | null;
}

export function TrackChangesPanel({ editor }: TrackChangesPanelProps) {
  const [changes, setChanges] = useState<TrackedChange[]>([]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const pluginState = trackChangesPluginKey.getState(editor.getState());
      const all = pluginState?.changeSet?.changes ?? [];
      setChanges(all.filter(c => c.dataTracked.status === CHANGE_STATUS.pending));
    };
    update();
    return editor.subscribe(update);
  }, [editor]);

  const items   = buildDisplayItems(changes);
  const allIds  = changes.map(c => c.id);
  const isEmpty = items.length === 0;

  function acceptAll() {
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, allIds);
  }
  function rejectAll() {
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, allIds);
  }

  return (
    <aside style={{
      width:       300,
      flexShrink:  0,
      display:     "flex",
      flexDirection: "column",
      background:  "#fff",
      borderLeft:  "1px solid #e8eaed",
      overflow:    "hidden",
    }}>
      {/* Header */}
      <div style={{
        display:     "flex",
        alignItems:  "center",
        height:      44,
        padding:     "0 14px",
        borderBottom:"1px solid #e8eaed",
        gap:         8,
        flexShrink:  0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", letterSpacing: "-0.01em" }}>
          Track Changes
        </span>
        {changes.length > 0 && (
          <span style={{
            fontSize:     11,
            fontWeight:   600,
            background:   "#6366f1",
            color:        "#fff",
            borderRadius: 99,
            padding:      "1px 7px",
          }}>
            {changes.length}
          </span>
        )}

        {!isEmpty && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
            <button onClick={rejectAll} style={actionBtn("#f1f5f9", "#64748b")}>
              Reject all
            </button>
            <button onClick={acceptAll} style={actionBtn("#dcfce7", "#15803d")}>
              Accept all
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{
        flex:      1,
        overflowY: "auto",
        padding:   isEmpty ? 0 : "6px 0",
      }}>
        {isEmpty ? (
          <div style={{
            display:       "flex",
            flexDirection: "column",
            alignItems:    "center",
            justifyContent:"center",
            height:        "100%",
            gap:           8,
            padding:       24,
          }}>
            <span style={{ fontSize: 28 }}>✓</span>
            <span style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", lineHeight: 1.5 }}>
              No pending changes
            </span>
          </div>
        ) : (
          items.map((item, i) =>
            item.kind === "replacement"
              ? <ReplacementRow key={i} item={item} editor={editor} />
              : <SingleRow     key={i} change={item.change} editor={editor} />,
          )
        )}
      </div>
    </aside>
  );
}

// ── Row components ────────────────────────────────────────────────────────────

function ReplacementRow({
  item,
  editor,
}: {
  item: Extract<DisplayItem, { kind: "replacement" }>;
  editor: Editor | null;
}) {
  const { deleteChange: del, insertChange: ins, ids, authorID } = item;

  return (
    <ChangeRow
      meta={{ icon: "↔", label: "Replacement", color: "#6d28d9", bgColor: "#ede9fe" }}
      authorID={authorID}
      onAccept={() => editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, ids)}
      onReject={() => editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, ids)}
    >
      <div style={previewLine("#fee2e2", "#b91c1c")}>
        <span style={prefixLabel}>Removing</span>
        <em style={{ fontStyle: "italic" }}>"{truncate(del.text)}"</em>
      </div>
      <div style={previewLine("#f0fdf4", "#15803d")}>
        <span style={prefixLabel}>Adding</span>
        <em style={{ fontStyle: "italic" }}>"{truncate(ins.text)}"</em>
      </div>
    </ChangeRow>
  );
}

function SingleRow({
  change,
  editor,
}: {
  change: TrackedChange;
  editor: Editor | null;
}) {
  const meta     = getChangeMeta(change);
  const authorID = change.dataTracked.authorID;

  function accept() {
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, [change.id]);
  }
  function reject() {
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, [change.id]);
  }

  let preview: React.ReactNode = null;

  if (change.type === "text-change") {
    const tc = change as TextChange;
    const isDelete = tc.dataTracked.operation === CHANGE_OPERATION.delete;
    preview = (
      <div style={previewLine(isDelete ? "#fee2e2" : "#f0fdf4", isDelete ? "#b91c1c" : "#15803d")}>
        <span style={prefixLabel}>{isDelete ? "Removing" : "Adding"}</span>
        <em>"{truncate(tc.text)}"</em>
      </div>
    );
  } else if (change.type === "mark-change") {
    const desc = describeMarkChange(change as MarkChange);
    if (desc) {
      preview = (
        <div style={previewLine("#ede9fe", "#6d28d9")}>
          {desc}
        </div>
      );
    }
  } else if (change.type === "node-attr-change") {
    const desc = describeAttrChange(change as NodeAttrChange);
    preview = (
      <div style={previewLine("#e0f2fe", "#0369a1")}>
        {desc}
      </div>
    );
  } else if (change.type === "wrap-change") {
    const wc = change as { wrapperNode: string };
    preview = (
      <div style={previewLine("#fef3c7", "#92400e")}>
        Wrapped in <em>{wc.wrapperNode}</em>
      </div>
    );
  } else if (change.type === "node-change") {
    const nc = change as { node: { type: { name: string } } };
    preview = (
      <div style={previewLine(
        meta.color === "#15803d" ? "#f0fdf4" : "#fee2e2",
        meta.color,
      )}>
        {nc.node.type.name}
      </div>
    );
  }

  return (
    <ChangeRow meta={meta} authorID={authorID} onAccept={accept} onReject={reject}>
      {preview}
    </ChangeRow>
  );
}

// ── Shared row shell ──────────────────────────────────────────────────────────

function ChangeRow({
  meta,
  authorID,
  onAccept,
  onReject,
  children,
}: {
  meta:     ChangeMeta;
  authorID: string;
  onAccept: () => void;
  onReject: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      padding:       "8px 14px",
      borderBottom:  "1px solid #f1f5f9",
      display:       "flex",
      flexDirection: "column",
      gap:           5,
    }}>
      {/* Top row: badge + author + buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          display:      "inline-flex",
          alignItems:   "center",
          gap:          3,
          padding:      "2px 6px",
          borderRadius: 99,
          fontSize:     10,
          fontWeight:   700,
          color:        meta.color,
          background:   meta.bgColor,
          flexShrink:   0,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
        }}>
          {meta.icon} {meta.label}
        </span>
        <span style={{
          fontSize:    11,
          color:       "#6b7280",
          flex:        1,
          overflow:    "hidden",
          textOverflow:"ellipsis",
          whiteSpace:  "nowrap",
        }}>
          {shortName(authorID)}
        </span>
        <button
          onClick={onReject}
          title="Reject"
          style={iconBtn("#fee2e2", "#b91c1c")}
        >
          ✗
        </button>
        <button
          onClick={onAccept}
          title="Accept"
          style={iconBtn("#dcfce7", "#15803d")}
        >
          ✓
        </button>
      </div>

      {/* Preview */}
      {children}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function previewLine(bg: string, color: string): React.CSSProperties {
  return {
    background:   bg,
    color,
    borderRadius: 4,
    padding:      "3px 7px",
    fontSize:     11,
    lineHeight:   1.5,
    fontFamily:   "Georgia, 'Times New Roman', serif",
    wordBreak:    "break-word",
    display:      "flex",
    gap:          5,
    alignItems:   "baseline",
  };
}

const prefixLabel: React.CSSProperties = {
  fontSize:      10,
  fontWeight:    600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  flexShrink:    0,
  fontFamily:    "system-ui, sans-serif",
};

function iconBtn(bg: string, color: string): React.CSSProperties {
  return {
    background:   bg,
    color,
    border:       "none",
    borderRadius: 4,
    width:        22,
    height:       22,
    cursor:       "pointer",
    fontSize:     12,
    fontWeight:   700,
    display:      "flex",
    alignItems:   "center",
    justifyContent:"center",
    flexShrink:   0,
    padding:      0,
  };
}

function actionBtn(bg: string, color: string): React.CSSProperties {
  return {
    background:   bg,
    color,
    border:       "none",
    borderRadius: 5,
    padding:      "3px 9px",
    cursor:       "pointer",
    fontSize:     11,
    fontWeight:   600,
    flexShrink:   0,
  };
}
