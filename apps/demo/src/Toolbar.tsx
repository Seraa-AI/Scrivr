interface ToolbarProps {
  activeMarks: string[];
  onToggleBold: () => void;
  onToggleItalic: () => void;
}

/**
 * Toolbar — bold / italic toggle buttons.
 *
 * Uses onMouseDown + e.preventDefault() so clicks do NOT blur the hidden
 * textarea. Without preventDefault the textarea would lose focus, the
 * blink timer would stop, and keyboard input would stop working.
 */
export function Toolbar({ activeMarks, onToggleBold, onToggleItalic }: ToolbarProps) {
  const boldActive = activeMarks.includes("bold");
  const italicActive = activeMarks.includes("italic");

  return (
    <div style={styles.bar}>
      <button
        style={{ ...styles.btn, ...(boldActive ? styles.btnActive : {}) }}
        onMouseDown={(e) => { e.preventDefault(); onToggleBold(); }}
        title="Bold (⌘B)"
        aria-pressed={boldActive}
      >
        <strong>B</strong>
      </button>
      <button
        style={{ ...styles.btn, ...(italicActive ? styles.btnActive : {}) }}
        onMouseDown={(e) => { e.preventDefault(); onToggleItalic(); }}
        title="Italic (⌘I)"
        aria-pressed={italicActive}
      >
        <em>I</em>
      </button>
    </div>
  );
}

const styles = {
  bar: {
    display: "flex",
    gap: 4,
    padding: "6px 8px",
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
    flexShrink: 0,
  },
  btn: {
    width: 28,
    height: 28,
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    background: "#f8fafc",
    cursor: "pointer",
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#0f172a",
    userSelect: "none" as const,
  },
  btnActive: {
    background: "#dbeafe",
    borderColor: "#3b82f6",
    color: "#1d4ed8",
  },
} as const;
