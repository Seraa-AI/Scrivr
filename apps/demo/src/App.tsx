import {
  useCanvasEditor,
  Canvas,
  useEditorState,
  StarterKit,
  Collaboration,
  CollaborationCursor,
  defaultPageConfig,
} from "@inscribe/react";
import type { EditorStateContext } from "@inscribe/react";
import { PdfExport } from "@inscribe/export";
import { Toolbar } from "./Toolbar";

// ── Room + user identity from URL params ──────────────────────────────────────
// Open the same URL in two tabs to collaborate.
//   ?room=my-doc           — share document named "my-doc"
//   ?room=my-doc&user=Bob  — custom display name
//   ?color=%23ef4444       — custom cursor colour (URL-encoded hex)

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

function getParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

const room = getParam("room") ?? "default";
const userName = getParam("user") ?? `User ${Math.floor(Math.random() * 100)}`;
const userColor = getParam("color") ?? COLORS[Math.floor(Math.random() * COLORS.length)]!;
const wsUrl = (import.meta as unknown as { env: Record<string, string> }).env.VITE_WS_URL ?? "ws://localhost:1234";

const EXTENSIONS = [
  StarterKit.configure({ history: false }), // Y.js undo replaces PM history
  Collaboration.configure({ url: wsUrl, name: room }),
  CollaborationCursor.configure({ user: { name: userName, color: userColor } }),
  PdfExport.configure({ filename: room }),
];

interface ToolbarSlice {
  activeMarks: string[];
  activeMarkAttrs: Record<string, Record<string, unknown>>;
  blockType: string;
  blockAttrs: Record<string, unknown>;
}

function selectToolbar(ctx: EditorStateContext): ToolbarSlice {
  const { blockType, blockAttrs } = ctx.editor.getBlockInfo();
  return {
    activeMarks: ctx.editor.getActiveMarks(),
    activeMarkAttrs: ctx.editor.getActiveMarkAttrs(),
    blockType,
    blockAttrs: blockAttrs as Record<string, unknown>,
  };
}

const EMPTY_TOOLBAR: ToolbarSlice = {
  activeMarks: [],
  activeMarkAttrs: {},
  blockType: "paragraph",
  blockAttrs: {},
};

export function App() {
  const editor = useCanvasEditor({ extensions: EXTENSIONS, pageConfig: defaultPageConfig });

  // deepEqual is the default — handles string[], nested objects correctly.
  const toolbar = useEditorState({ editor, selector: selectToolbar }) ?? EMPTY_TOOLBAR;

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <span style={styles.title}>inscribe</span>
        <span style={styles.badge}>dev</span>
        <span style={styles.room}>
          <span style={{ ...styles.dot, background: userColor }} />
          {userName} · {room}
        </span>
      </header>

      <Toolbar
        items={editor?.toolbarItems ?? []}
        activeMarks={toolbar.activeMarks}
        activeMarkAttrs={toolbar.activeMarkAttrs}
        blockType={toolbar.blockType}
        blockAttrs={toolbar.blockAttrs}
        onCommand={(cmd, args) => editor?.commands[cmd]?.(...(args ?? []))}
      />

      <main style={styles.main}>
        <Canvas editor={editor} style={styles.canvas} />
      </main>
    </div>
  );
}

const styles = {
  shell: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    background: "#f1f5f9",
  },
  header: {
    background: "#0f172a",
    color: "#e2e8f0",
    padding: "10px 24px",
    display: "flex",
    alignItems: "center",
    gap: 16,
    flexShrink: 0,
  },
  title: { fontFamily: "monospace", fontSize: 15, fontWeight: 600 },
  room: {
    marginLeft: "auto",
    fontSize: 12,
    color: "#94a3b8",
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "monospace",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  badge: {
    fontSize: 11,
    background: "#1e40af",
    color: "#bfdbfe",
    padding: "2px 8px",
    borderRadius: 4,
    fontFamily: "monospace",
  },
  main: {
    flex: 1,
    overflow: "auto",
    padding: 40,
    display: "flex",
    justifyContent: "center",
  },
  canvas: {
    position: "relative" as const,
  },
} as const;
