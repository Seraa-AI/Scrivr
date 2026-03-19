import { useRef, useEffect, useState, useCallback } from "react";
import { EditorState } from "prosemirror-state";
import { Editor, setupCanvas, clearCanvas } from "@canvas-editor/core";

// A4 at 96dpi — logical CSS pixels
const PAGE_W = 794;
const PAGE_H = 1123;
const MARGIN = 72; // ~1 inch

// Stored across renders — set once in useEffect
let canvasDpr = 1;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [docState, setDocState] = useState<DocStats>({ text: "", blocks: 0, chars: 0 });

  const render = useCallback((state: EditorState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    clearCanvas(ctx, PAGE_W, PAGE_H, canvasDpr);

    // Page margin guides
    ctx.strokeStyle = "#dbeafe";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(MARGIN, MARGIN, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2);
    ctx.setLineDash([]);

    // Status line
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px 'SF Mono', 'Fira Code', monospace";
    ctx.fillText("Layout engine not yet built — document model is live.", MARGIN, MARGIN + 20);

    // Render text content with basic word wrap
    const text = state.doc.textContent;
    if (text) {
      ctx.fillStyle = "#1e293b";
      ctx.font = "15px Georgia, 'Times New Roman', serif";

      const words = text.split(" ");
      let line = "";
      let y = MARGIN + 56;
      const maxWidth = PAGE_W - MARGIN * 2;

      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, MARGIN, y);
          line = word;
          y += 24;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, MARGIN, y);
    }

    setDocState({
      text: state.doc.textContent,
      blocks: state.doc.childCount,
      chars: state.doc.textContent.length,
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // One-time high-DPI setup
    const { dpr } = setupCanvas(canvas, { width: PAGE_W, height: PAGE_H });
    canvasDpr = dpr;

    const editor = new Editor({ onChange: render });
    editorRef.current = editor;
    editor.mount(container);
    render(editor.getState());

    return () => editor.destroy();
  }, [render]);

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <span style={styles.title}>canvas-editor</span>
        <span style={styles.badge}>Phase 1 — model connected</span>
      </header>

      <div style={styles.body}>
        <main style={styles.main}>
          <div
            ref={containerRef}
            style={styles.pageWrapper}
            onClick={() => editorRef.current?.focus()}
          >
            {/* No width/height here — setupCanvas writes them as inline styles */}
            <canvas ref={canvasRef} style={styles.canvas} />
          </div>
        </main>

        <aside style={styles.sidebar}>
          <h3 style={styles.sidebarTitle}>Doc State</h3>
          <StatRow label="Blocks" value={docState.blocks} />
          <StatRow label="Characters" value={docState.chars} />

          <h3 style={{ ...styles.sidebarTitle, marginTop: 24 }}>Raw text</h3>
          <pre style={styles.pre}>
            {docState.text || <span style={{ color: "#64748b" }}>(empty)</span>}
          </pre>

          <h3 style={{ ...styles.sidebarTitle, marginTop: 24 }}>Keyboard</h3>
          <kbd style={styles.kbd}>Type</kbd> to insert<br />
          <kbd style={styles.kbd}>Backspace</kbd> delete<br />
          <kbd style={styles.kbd}>Enter</kbd> split block<br />
          <kbd style={styles.kbd}>⌘Z</kbd> undo<br />
          <kbd style={styles.kbd}>⌘⇧Z</kbd> redo
        </aside>
      </div>
    </div>
  );
}

interface DocStats { text: string; blocks: number; chars: number }

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.statRow}>
      <span style={styles.statLabel}>{label}</span>
      <span style={styles.statValue}>{value}</span>
    </div>
  );
}

const styles = {
  shell: { display: "flex", flexDirection: "column" as const, height: "100vh", background: "#f8fafc" },
  header: {
    background: "#0f172a", color: "#e2e8f0",
    padding: "10px 24px", display: "flex", alignItems: "center", gap: 16,
  },
  title: { fontFamily: "monospace", fontSize: 15, fontWeight: 600 },
  badge: {
    fontSize: 11, background: "#1e40af", color: "#bfdbfe",
    padding: "2px 8px", borderRadius: 4, fontFamily: "monospace",
  },
  body: { flex: 1, display: "flex", overflow: "hidden" },
  main: {
    flex: 1, overflow: "auto", padding: 40,
    display: "flex", justifyContent: "center", alignItems: "flex-start",
  },
  pageWrapper: {
    position: "relative" as const,
    boxShadow: "0 4px 32px rgba(0,0,0,0.12)",
    cursor: "text",
    userSelect: "none" as const,
  },
  canvas: { display: "block", background: "#fff" },
  sidebar: {
    width: 260, borderLeft: "1px solid #e2e8f0",
    background: "#fff", padding: 20, overflow: "auto",
    fontSize: 13, fontFamily: "monospace",
  },
  sidebarTitle: {
    fontSize: 11, color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: 1, margin: "0 0 10px",
  },
  statRow: {
    display: "flex", justifyContent: "space-between",
    padding: "4px 0", borderBottom: "1px solid #f1f5f9",
  },
  statLabel: { color: "#64748b" },
  statValue: { color: "#0f172a", fontWeight: 600 },
  pre: {
    background: "#f8fafc", border: "1px solid #e2e8f0",
    borderRadius: 4, padding: 10, fontSize: 12,
    whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const,
    minHeight: 60, margin: 0,
  },
  kbd: {
    display: "inline-block", background: "#f1f5f9",
    border: "1px solid #cbd5e1", borderRadius: 3,
    padding: "1px 5px", fontSize: 11, marginRight: 4, marginBottom: 6,
  },
} as const;
