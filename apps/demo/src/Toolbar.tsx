import type { ToolbarItemSpec } from "@inscribe/core";

interface ToolbarProps {
  items: ToolbarItemSpec[];
  activeMarks: string[];
  activeMarkAttrs: Record<string, Record<string, unknown>>;
  blockType: string;
  blockAttrs: Record<string, unknown>;
  onCommand: (cmd: string, args?: unknown[]) => void;
}

/**
 * Toolbar — data-driven toolbar rendered from extension ToolbarItemSpecs.
 *
 * Groups are derived from item.group — a divider is inserted whenever the
 * group name changes. Two special groups are rendered as <select> dropdowns
 * instead of individual buttons:
 *   "size"   — font size picker
 *   "family" — font family picker
 *
 * Uses onMouseDown + e.preventDefault() so clicks don't blur the hidden
 * textarea and break keyboard input.
 */
export function Toolbar({ items, activeMarks, activeMarkAttrs, blockType, blockAttrs, onCommand }: ToolbarProps) {
  // Split items into ordered groups, preserving first-seen order
  const groupOrder: string[] = [];
  const groupMap = new Map<string, ToolbarItemSpec[]>();
  for (const item of items) {
    const g = item.group ?? "misc";
    if (!groupMap.has(g)) { groupMap.set(g, []); groupOrder.push(g); }
    groupMap.get(g)!.push(item);
  }

  return (
    <div style={styles.bar}>
      {groupOrder.map((group, gi) => (
        <div key={group} style={styles.group}>
          {/* Divider before every group except the first */}
          {gi > 0 && <div style={styles.divider} />}

          {/* Font size → compact select */}
          {group === "size" ? (
            <SizeSelect
              items={groupMap.get(group)!}
              activeMarkAttrs={activeMarkAttrs}
              onCommand={onCommand}
            />
          ) : group === "family" ? (
            <FamilySelect
              items={groupMap.get(group)!}
              activeMarkAttrs={activeMarkAttrs}
              blockAttrs={blockAttrs}
              onCommand={onCommand}
            />
          ) : (
            groupMap.get(group)!.map((item) => {
              const active = item.isActive(activeMarks, blockType, blockAttrs, activeMarkAttrs);
              return (
                <button
                  key={`${item.command}:${JSON.stringify(item.args)}`}
                  style={{ ...styles.btn, ...(active ? styles.btnActive : {}) }}
                  onMouseDown={(e) => { e.preventDefault(); onCommand(item.command, item.args); }}
                  title={item.title}
                  aria-pressed={active}
                >
                  <span style={{ ...styles.label, ...item.labelStyle }}>{item.label}</span>
                </button>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

// ── Size dropdown ─────────────────────────────────────────────────────────────

function SizeSelect({ items, activeMarkAttrs, onCommand }: {
  items: ToolbarItemSpec[];
  activeMarkAttrs: Record<string, Record<string, unknown>>;
  onCommand: (cmd: string, args?: unknown[]) => void;
}) {
  const activeSize = activeMarkAttrs["font_size"]?.["size"];
  const value = typeof activeSize === "number" ? String(activeSize) : "";
  // Pasted content may have non-preset sizes (e.g. 15px from 11pt Google Docs).
  // Inject a custom option so the select reflects the actual current size.
  const presetValues = new Set(items.map((i) => String(i.args?.[0])));
  const hasCustomSize = value !== "" && !presetValues.has(value);

  return (
    <select
      style={styles.select}
      value={value}
      onChange={(e) => {
        const item = items.find((i) => String(i.args?.[0]) === e.target.value);
        if (item) onCommand(item.command, item.args);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title="Font size"
    >
      <option value="" disabled>Size</option>
      {hasCustomSize && (
        <option value={value}>{value}</option>
      )}
      {items.map((item) => (
        <option key={String(item.args?.[0])} value={String(item.args?.[0])}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

// ── Family dropdown ───────────────────────────────────────────────────────────

function FamilySelect({ items, activeMarkAttrs, blockAttrs, onCommand }: {
  items: ToolbarItemSpec[];
  activeMarkAttrs: Record<string, Record<string, unknown>>;
  blockAttrs: Record<string, unknown>;
  onCommand: (cmd: string, args?: unknown[]) => void;
}) {
  // Inline font_family mark wins (character-level override).
  // Fall back to block-level fontFamily attr (set by setBlockFontFamily).
  const inlineFamily = activeMarkAttrs["font_family"]?.["family"];
  const blockFamily  = blockAttrs["fontFamily"];
  const activeFamily = typeof inlineFamily === "string" ? inlineFamily
                     : typeof blockFamily  === "string" ? blockFamily
                     : null;
  const value = activeFamily ?? "";

  return (
    <select
      style={{ ...styles.select, width: 130, fontFamily: value || "inherit" }}
      value={value}
      onChange={(e) => {
        const item = items.find((i) => i.args?.[0] === e.target.value);
        if (item) onCommand(item.command, item.args);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title="Font family"
    >
      <option value="" disabled>Font</option>
      {items.map((item) => {
        const family = item.args?.[0] as string;
        return (
          <option key={family} value={family} style={{ fontFamily: family }}>
            {item.label}
          </option>
        );
      })}
    </select>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  bar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: 2,
    padding: "4px 8px",
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
    flexShrink: 0,
    minHeight: 38,
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  divider: {
    width: 1,
    height: 20,
    background: "#e2e8f0",
    margin: "0 4px",
    flexShrink: 0,
  },
  btn: {
    minWidth: 28,
    height: 28,
    padding: "0 5px",
    border: "1px solid transparent",
    borderRadius: 4,
    background: "transparent",
    cursor: "pointer",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#374151",
    userSelect: "none" as const,
  },
  btnActive: {
    background: "#dbeafe",
    border: "1px solid #93c5fd",
    color: "#1d4ed8",
  },
  label: {
    lineHeight: 1,
    pointerEvents: "none" as const,
  },
  select: {
    height: 28,
    width: 64,
    padding: "0 4px",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    background: "#f8fafc",
    fontSize: 13,
    color: "#374151",
    cursor: "pointer",
    outline: "none",
  },
} as const;
