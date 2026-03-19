import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  Editor,
  EditorState,
  TextMeasurer,
  CharacterMap,
  layoutDocument,
  defaultPageConfig,
  createEditorState,
} from "@canvas-editor/core";
import { PageView } from "./PageView";
import { useVirtualPages } from "./useVirtualPages";
import type { LayoutPage } from "@canvas-editor/core";

const PAGE_GAP = 24;

// Shared instances — created once, live for the app lifetime
const measurer = new TextMeasurer({ lineHeightMultiplier: 1.2 });
const charMap = new CharacterMap();

// Initial layout from an empty doc
const initialLayout = layoutDocument(createEditorState().doc, {
  pageConfig: defaultPageConfig,
  measurer,
  previousVersion: 0,
});

export function App() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const versionRef = useRef(initialLayout.version);

  const [layout, setLayout] = useState(initialLayout);

  const getCurrentVersion = useCallback(() => versionRef.current, []);

  const onDocChange = useCallback((state: EditorState) => {
    charMap.clear();
    const next = layoutDocument(state.doc, {
      pageConfig: defaultPageConfig,
      measurer,
      previousVersion: versionRef.current,
    });
    versionRef.current = next.version;
    setLayout(next);
  }, []);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const editor = new Editor({ onChange: onDocChange });
    editorRef.current = editor;
    editor.mount(container);
    onDocChange(editor.getState());
    return () => editor.destroy();
  }, [onDocChange]);

  const { visiblePages, observePage } = useVirtualPages(layout.pages, 500);

  const stats = useMemo(() => ({
    pages: layout.pages.length,
    version: layout.version,
  }), [layout]);

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <span style={styles.title}>canvas-editor</span>
        <span style={styles.badge}>Phase 1 — virtual pages</span>
        <span style={styles.stat}>pages: {stats.pages}</span>
        <span style={styles.stat}>v{stats.version}</span>
      </header>

      <div style={styles.body}>
        <main
          ref={scrollRef}
          style={styles.main}
          onClick={() => editorRef.current?.focus()}
        >
          <div ref={editorContainerRef} style={styles.editorContainer} />

          <div style={styles.pageStack}>
            {layout.pages.map((page: LayoutPage) => (
              <PageView
                key={page.pageNumber}
                page={page}
                pageConfig={layout.pageConfig}
                layoutVersion={layout.version}
                currentVersion={getCurrentVersion}
                measurer={measurer}
                map={charMap}
                isVisible={visiblePages.has(page.pageNumber)}
                observeRef={observePage(page.pageNumber)}
                gap={PAGE_GAP}
              />
            ))}
          </div>
        </main>

        <aside style={styles.sidebar}>
          <h3 style={styles.sidebarTitle}>Layout</h3>
          <StatRow label="Pages" value={stats.pages} />
          <StatRow label="Version" value={stats.version} />
          <StatRow label="Visible" value={visiblePages.size} />

          <h3 style={{ ...styles.sidebarTitle, marginTop: 24 }}>Keyboard</h3>
          <kbd style={styles.kbd}>Type</kbd> insert<br />
          <kbd style={styles.kbd}>Backspace</kbd> delete<br />
          <kbd style={styles.kbd}>Enter</kbd> new block<br />
          <kbd style={styles.kbd}>⌘Z</kbd> undo<br />
          <kbd style={styles.kbd}>⌘⇧Z</kbd> redo
        </aside>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.statRow}>
      <span style={styles.statLabel}>{label}</span>
      <span style={styles.statValue}>{value}</span>
    </div>
  );
}

const styles = {
  shell: { display: "flex", flexDirection: "column" as const, height: "100vh", background: "#f1f5f9" },
  header: {
    background: "#0f172a", color: "#e2e8f0",
    padding: "10px 24px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0,
  },
  title: { fontFamily: "monospace", fontSize: 15, fontWeight: 600 },
  badge: { fontSize: 11, background: "#1e40af", color: "#bfdbfe", padding: "2px 8px", borderRadius: 4, fontFamily: "monospace" },
  stat: { fontSize: 11, color: "#64748b", fontFamily: "monospace" },
  body: { flex: 1, display: "flex", overflow: "hidden" },
  main: { flex: 1, overflow: "auto", padding: 40, cursor: "text" },
  editorContainer: { position: "absolute" as const, top: 0, left: 0, pointerEvents: "none" as const },
  pageStack: { display: "flex", flexDirection: "column" as const, alignItems: "center" },
  sidebar: {
    width: 220, borderLeft: "1px solid #e2e8f0", background: "#fff",
    padding: 20, overflow: "auto", fontSize: 13, fontFamily: "monospace", flexShrink: 0,
  },
  sidebarTitle: { fontSize: 11, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 1, margin: "0 0 10px" },
  statRow: { display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f1f5f9" },
  statLabel: { color: "#64748b" },
  statValue: { color: "#0f172a", fontWeight: 600 },
  kbd: { display: "inline-block", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 3, padding: "1px 5px", fontSize: 11, marginRight: 4, marginBottom: 6 },
} as const;
