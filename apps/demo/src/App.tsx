import { useState } from "react";
import {
  useCanvasEditor,
  Canvas,
  useEditorState,
  StarterKit,
  Collaboration,
  CollaborationCursor,
  defaultPageConfig,
  LinkPopover,
  SlashMenu,
} from "@inscribe/react";
import type { EditorStateContext } from "@inscribe/react";
import { PdfExport } from "@inscribe/export";
import { TrackChanges, AiToolkit } from "@inscribe/plugins";
import { Toolbar } from "./Toolbar";
import { BubbleMenuBar } from "./BubbleMenuBar";
import { FloatingMenuBar } from "./FloatingMenuBar";
import { ModeSwitcher } from "./ModeSwitcher";
import { TrackChangesPopover } from "./TrackChangesPopover";
import { ChatPanel } from "./ChatPanel";

// ── Room + user identity from URL params ──────────────────────────────────────
// Open the same URL in two tabs to collaborate.
//   ?room=my-doc           — share document named "my-doc"
//   ?room=my-doc&user=Bob  — custom display name
//   ?color=%23ef4444       — custom cursor colour (URL-encoded hex)

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

// Guard against SSR (TanStack Start runs this on the server where window is absent)
function getParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

function makeIdentity() {
  const room = getParam("room") ?? "default";
  const userName = getParam("user") ?? `User ${Math.floor(Math.random() * 100)}`;
  const userColor = getParam("color") ?? COLORS[Math.floor(Math.random() * COLORS.length)]!;
  const wsUrl = (import.meta as unknown as { env: Record<string, string> }).env.VITE_WS_URL ?? "ws://localhost:1234";
  return { room, userName, userColor, wsUrl };
}

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
  // Lazy init — runs once on the client, never on the server
  const [{ room, userName, userColor, extensions }] = useState(() => {
    const identity = makeIdentity();
    return {
      ...identity,
      extensions: [
        StarterKit.configure({ history: false }), // Y.js undo replaces PM history
        Collaboration.configure({ url: identity.wsUrl, name: identity.room }),
        CollaborationCursor.configure({ user: { name: identity.userName, color: identity.userColor } }),
        PdfExport.configure({ filename: identity.room }),
        TrackChanges.configure({ userID: identity.userName, canAcceptReject: true }),
        AiToolkit,
      ],
    };
  });

  const editor = useCanvasEditor({ extensions, pageConfig: defaultPageConfig });

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

      <div style={styles.toolbarRow}>
        <Toolbar
          items={editor?.toolbarItems ?? []}
          activeMarks={toolbar.activeMarks}
          activeMarkAttrs={toolbar.activeMarkAttrs}
          blockType={toolbar.blockType}
          blockAttrs={toolbar.blockAttrs}
          onCommand={(cmd, args) => editor?.commands[cmd]?.(...(args ?? []))}
        />
        <div style={styles.modeSwitcherWrap}>
          <ModeSwitcher editor={editor} />
        </div>
      </div>

      <div style={styles.body}>
        <main style={styles.main}>
          <Canvas editor={editor} style={styles.canvas} />
        </main>
        <ChatPanel editor={editor} />
      </div>

      <BubbleMenuBar editor={editor} />
      <FloatingMenuBar editor={editor} />
      <SlashMenu editor={editor} />
      <LinkPopover editor={editor} />
      <TrackChangesPopover editor={editor} />
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
  toolbarRow: {
    display: "flex",
    alignItems: "stretch",
    flexShrink: 0,
  },
  modeSwitcherWrap: {
    marginLeft: "auto",
    padding: "0 8px",
    display: "flex",
    alignItems: "center",
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
    flexShrink: 0,
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
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
