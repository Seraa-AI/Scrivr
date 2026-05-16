/**
 * TrackChangesPanel — sidebar panel listing all pending tracked changes.
 *
 * Shows text insertions/deletions (grouped as "Replacement" when paired),
 * inline format changes (bold, italic, color…), block attribute changes
 * (alignment, heading level…), and structural changes (wrap, node insert/delete).
 *
 * Each row has Accept / Reject buttons. Header has Accept All / Reject All.
 */

import type { Editor } from "@scrivr/core";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
} from "@scrivr/plugins";
import type {
  TrackedChange,
  MarkChange,
  NodeAttrChange,
} from "@scrivr/plugins";
import { cx } from "../utils/classNames";
import { useTrackChangesPanel } from "../hooks/useTrackChangesPanel";
import type { TrackChangesDisplayItem } from "../hooks/useTrackChangesPanel";

function shortName(authorID: string): string {
  const name = authorID.split(":").pop() ?? authorID;
  return name.length > 22 ? name.slice(0, 22) + "…" : name;
}

function truncate(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

interface ChangeMeta {
  icon: string;
  label: string;
}

const MARK_ICONS: Record<string, string> = {
  bold: "B",
  italic: "I",
  underline: "U",
  strikethrough: "S",
  highlight: "H",
  color: "●",
  fontSize: "Aa",
  fontFamily: "Ff",
  link: "↗",
};

const MARK_LABELS: Record<string, string> = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strikethrough: "Strikethrough",
  highlight: "Highlight",
  color: "Color",
  fontSize: "Font Size",
  fontFamily: "Font Family",
  link: "Link",
};

const ATTR_LABELS: Record<string, string> = {
  align: "Alignment",
  level: "Heading level",
  fontFamily: "Font",
  fontSize: "Font size",
  indent: "Indent",
};

function getChangeMeta(change: TrackedChange): ChangeMeta {
  const op = change.dataTracked.operation;

  if (change.type === "text-change") {
    if (op === CHANGE_OPERATION.insert)
      return {
        icon: "+",
        label: "Insertion",
      };
    return {
      icon: "−",
      label: "Deletion",
    };
  }

  if (change.type === "mark-change") {
    const mc = change as MarkChange;
    const name = mc.mark.type.name;
    const isRemoval = op === CHANGE_OPERATION.delete;
    return {
      icon: MARK_ICONS[name] ?? "M",
      label: `${MARK_LABELS[name] ?? name} ${isRemoval ? "removed" : "added"}`,
    };
  }

  if (change.type === "node-attr-change") {
    return {
      icon: "≡",
      label: "Style changed",
    };
  }

  if (change.type === "wrap-change") {
    return {
      icon: "⊞",
      label: "Structure",
    };
  }

  if (change.type === "node-change") {
    if (op === CHANGE_OPERATION.insert)
      return {
        icon: "□+",
        label: "Block added",
      };
    if (op === CHANGE_OPERATION.delete)
      return {
        icon: "□−",
        label: "Block removed",
      };
    return {
      icon: "□",
      label: "Block changed",
    };
  }

  if (change.type === "reference-change") {
    return {
      icon: "↗",
      label: "Reference",
    };
  }

  return {
    icon: "?",
    label: op ?? "Change",
  };
}

/** Describe what changed in a NodeAttrChange. */
function describeAttrChange(change: NodeAttrChange): string {
  const old = change.oldAttrs
  const next = change.newAttrs
  const parts: string[] = [];
  const allKeys = new Set([...Object.keys(old), ...Object.keys(next)]);

  for (const key of allKeys) {
    if (key === "nodeId" || key === "dataTracked") continue;
    if (old[key] !== next[key]) {
      const label = ATTR_LABELS[key] ?? key;
      const from = old[key] == null ? "none" : String(old[key]);
      const to = next[key] == null ? "none" : String(next[key]);
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


export interface TrackChangesPanelProps {
  editor: Editor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  emptyClassName?: string | undefined;
}

export function TrackChangesPanel({
  editor,
  className,
  itemClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
  emptyClassName,
}: TrackChangesPanelProps) {
  const panel = useTrackChangesPanel(editor);

  return (
    <aside
      className={cx("scrivr-track-panel", className)}
      style={{
        width: 300,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 44,
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          className={cx("scrivr-menu-title", titleClassName)}
          data-part="title"
          style={{
          }}
        >
          Track Changes
        </span>
        {panel.changes.length > 0 && (
          <span
            className={cx("scrivr-menu-icon", iconClassName)}
            data-part="icon"
            style={{
            }}
          >
            {panel.changes.length}
          </span>
        )}

        {!panel.isEmpty && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
            <button className={cx("scrivr-menu-item", itemClassName)} onClick={panel.rejectAll} style={actionBtn}>
              Reject all
            </button>
            <button className={cx("scrivr-menu-item", itemClassName)} onClick={panel.acceptAll} style={actionBtn}>
              Accept all
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: panel.isEmpty ? 0 : "6px 0",
        }}
      >
        {panel.isEmpty ? (
          <div
            className={cx("scrivr-menu-empty", emptyClassName)}
            data-empty
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 8,
            }}
          >
            <span className={cx("scrivr-menu-icon", iconClassName)} data-part="icon">Done</span>
            <span
              className={cx("scrivr-menu-description", descriptionClassName)}
              data-part="description"
              style={{
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              No pending changes
            </span>
          </div>
        ) : (
          panel.items.map((item, i) =>
            item.kind === "replacement" ? (
              <ReplacementRow key={i} item={item} editor={editor} />
            ) : (
              <SingleRow key={i} change={item.change} editor={editor} />
            ),
          )
        )}
      </div>
    </aside>
  );
}

function ReplacementRow({
  item,
  editor,
}: {
  item: Extract<TrackChangesDisplayItem, { kind: "replacement" }>;
  editor: Editor | null;
}) {
  const { deleteChange: del, insertChange: ins, ids, authorID } = item;

  return (
    <ChangeRow
      meta={{
        icon: "↔",
        label: "Replacement",
      }}
      authorID={authorID}
      onAccept={() =>
        editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, ids)
      }
      onReject={() =>
        editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, ids)
      }
    >
      <div style={previewLine}>
        <span style={prefixLabel}>Removing</span>
        <em style={{ fontStyle: "italic" }}>"{truncate(del.text)}"</em>
      </div>
      <div style={previewLine}>
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
  const meta = getChangeMeta(change);
  const authorID = change.dataTracked.authorID;

  function accept() {
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, [change.id]);
  }
  function reject() {
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, [change.id]);
  }

  let preview: React.ReactNode = null;

  if (change.type === "text-change") {
    const tc = change
    const isDelete = tc.dataTracked.operation === CHANGE_OPERATION.delete;
    preview = (
      <div
        style={previewLine}
      >
        <span style={prefixLabel}>{isDelete ? "Removing" : "Adding"}</span>
        <em>"{truncate(tc.text)}"</em>
      </div>
    );
  } else if (change.type === "mark-change") {
    const desc = describeMarkChange(change);
    if (desc) {
      preview = <div style={previewLine}>{desc}</div>;
    }
  } else if (change.type === "node-attr-change") {
    const desc = describeAttrChange(change);
    preview = <div style={previewLine}>{desc}</div>;
  } else if (change.type === "wrap-change") {
    const wc = change
    preview = (
      <div style={previewLine}>
        Wrapped in <em>{wc.wrapperNode}</em>
      </div>
    );
  } else if (change.type === "node-change") {
    const nc = change
    preview = (
      <div
        style={previewLine}
      >
        {nc.node.type.name}
      </div>
    );
  }

  return (
    <ChangeRow
      meta={meta}
      authorID={authorID}
      onAccept={accept}
      onReject={reject}
    >
      {preview}
    </ChangeRow>
  );
}

function ChangeRow({
  meta,
  authorID,
  onAccept,
  onReject,
  children,
}: {
  meta: ChangeMeta;
  authorID: string;
  onAccept: () => void;
  onReject: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      {/* Top row: badge + author + buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          {meta.icon} {meta.label}
        </span>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {shortName(authorID)}
        </span>
        <button
          onClick={onReject}
          title="Reject"
          style={iconBtn}
        >
          ✗
        </button>
        <button
          onClick={onAccept}
          title="Accept"
          style={iconBtn}
        >
          ✓
        </button>
      </div>

      {/* Preview */}
      {children}
    </div>
  );
}

const previewLine: React.CSSProperties = {
  lineHeight: 1.5,
  wordBreak: "break-word",
  display: "flex",
  gap: 5,
  alignItems: "baseline",
};

const prefixLabel: React.CSSProperties = {
  textTransform: "uppercase",
  flexShrink: 0,
};

const iconBtn: React.CSSProperties = {
  border: "none",
  width: 22,
  height: 22,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  padding: 0,
};

const actionBtn: React.CSSProperties = {
  border: "none",
  cursor: "pointer",
  flexShrink: 0,
};
