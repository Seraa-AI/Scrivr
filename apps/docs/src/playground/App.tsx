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
  ImageMenu,
} from "@inscribe/react";
import type { EditorStateContext } from "@inscribe/react";
import { PdfExport } from "@inscribe/export";
import { TrackChanges, AiToolkit } from "@inscribe/plugins";
import { Toolbar } from "./Toolbar";
import { BubbleMenuBar } from "./BubbleMenuBar";
import { FloatingMenuBar } from "./FloatingMenuBar";
import { ModeSwitcher } from "./ModeSwitcher";
import { TrackChangesPopover } from "@inscribe/react";
import { ChatPanel } from "./ChatPanel";

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

function getParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

function makeIdentity() {
  const room = getParam("room") ?? "default";
  const userName = getParam("user") ?? `User ${Math.floor(Math.random() * 100)}`;
  const userColor = getParam("color") ?? COLORS[Math.floor(Math.random() * COLORS.length)]!;
  const wsUrl = (import.meta as unknown as { env: Record<string, string> }).env.VITE_WS_URL ?? "ws://localhost:1235";
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
  const [{ room, userName, userColor, extensions }] = useState(() => {
    const identity = makeIdentity();
    return {
      ...identity,
      extensions: [
        StarterKit.configure({ history: false }),
        Collaboration.configure({ url: identity.wsUrl, name: identity.room }),
        CollaborationCursor.configure({ user: { name: identity.userName, color: identity.userColor } }),
        PdfExport.configure({ filename: identity.room }),
        TrackChanges.configure({ userID: identity.userName, canAcceptReject: true }),
        AiToolkit,
      ],
    };
  });

  const editor = useCanvasEditor({ extensions, pageConfig: defaultPageConfig });
  const toolbar = useEditorState({ editor, selector: selectToolbar }) ?? EMPTY_TOOLBAR;

  const loadingState = useEditorState({
    editor,
    selector: (ctx) => ctx.editor.loadingState,
    equalityFn: Object.is,
  }) ?? "syncing";

  const pageInfo = useEditorState({
    editor,
    selector: (ctx) => ({
      current: ctx.editor.cursorPage,
      total: ctx.editor.layout.pages.length,
    }),
    equalityFn: (a, b) => a.current === b.current && a.total === b.total,
  }) ?? { current: 1, total: 1 };

  return (
    <div className="flex flex-col h-screen bg-[#f7f8fa] font-sans">

      {/* ── Header ── */}
      <header className="flex items-center justify-between h-11 px-4 bg-white border-b border-[#e8eaed] shrink-0 gap-3">
        <div className="flex items-center gap-2 flex-1">
          <a href="/" className="flex items-center gap-1 text-[13px] text-gray-500 no-underline px-1.5 py-0.5 rounded-md hover:bg-gray-100 hover:text-gray-700 transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="block">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Docs
          </a>
          <div className="w-px h-4 bg-gray-200" />
          <span className="text-[14px] font-semibold text-gray-900 tracking-tight">inscribe</span>
          <span className="text-[11px] font-medium text-indigo-500 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-px tracking-wide">
            playground
          </span>
        </div>

        <div className="flex items-center justify-center flex-1">
          <span className="text-[12px] text-gray-400 tabular-nums tracking-wide">
            {pageInfo.current} / {pageInfo.total}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 justify-end">
          <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: userColor }} />
          <span className="text-[12px] font-medium text-gray-700">{userName}</span>
          <span className="text-[12px] text-gray-300">·</span>
          <span className="text-[12px] text-gray-400">{room}</span>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="flex items-stretch shrink-0 bg-white border-b border-[#e8eaed]">
        <Toolbar
          items={editor?.toolbarItems ?? []}
          activeMarks={toolbar.activeMarks}
          activeMarkAttrs={toolbar.activeMarkAttrs}
          blockType={toolbar.blockType}
          blockAttrs={toolbar.blockAttrs}
          onCommand={(cmd, args) => editor?.commands[cmd]?.(...(args ?? []))}
        />
        <div className="flex items-center px-3 border-l border-[#e8eaed] shrink-0">
          <ModeSwitcher editor={editor} />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative">
        <main
          className="flex flex-1 overflow-auto justify-center items-start p-4"
        >
          <Canvas
            editor={editor}
            style={{ position: "relative",  }}
            pageStyle={{ boxShadow: "none", border: "1px solid #e8eaed" }}
          />
        </main>
        <ChatPanel editor={editor} />

        {loadingState === "syncing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(247,248,250,0.85)] backdrop-blur-sm z-10">
            <div className="flex items-center gap-2.5 bg-white border border-[#e8eaed] rounded-xl px-5 py-3 shadow-lg">
              <LoadingSpinner />
              <span className="text-[13px] font-medium text-gray-700">Connecting…</span>
            </div>
          </div>
        )}
      </div>

      <BubbleMenuBar editor={editor} />
      <FloatingMenuBar editor={editor} />
      <SlashMenu editor={editor} />
      <LinkPopover editor={editor} />
      <ImageMenu editor={editor} />
      <TrackChangesPopover editor={editor} />
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="block animate-spin">
      <circle cx="9" cy="9" r="7" fill="none" stroke="#e2e8f0" strokeWidth="2" />
      <path d="M9 2a7 7 0 0 1 7 7" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
