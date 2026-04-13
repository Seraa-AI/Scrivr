import {
  useScrivrEditor,
  Scrivr,
  useEditorState,
  StarterKit,
  defaultPageConfig,
  DEFAULT_FONT_FAMILY,
  LinkPopover,
  SlashMenu,
  ImageMenu,
} from "@scrivr/react";
import { useState } from "react";
import type { EditorStateContext } from "@scrivr/react";
import { PdfExport } from "@scrivr/export";
import {
  Collaboration,
  CollaborationCursor,
  TrackChanges,
  AiToolkit,
} from "@scrivr/plugins";
import { Toolbar } from "./Toolbar";
import { BubbleMenuBar } from "./BubbleMenuBar";
import { FloatingMenuBar } from "./FloatingMenuBar";
import { ModeSwitcher } from "./ModeSwitcher";
import {
  TrackChangesPopover,
  TrackChangesPanel,
  AiSuggestionCardsPanel,
} from "@scrivr/react";
import { ChatPanel } from "./ChatPanel";
import { DemoContent } from "./demoContent";
import { env } from "../lib/env";

// Runtime env vars go through the validated env module (see lib/env.ts).
// These are read from the cached Zod-parsed object at app boot.
const USE_COLLAB = env.get("VITE_COLLAB") === "true";

// AI features (AiToolkit plugin, AI chat panel, suggestion cards) are gated
// by a BUILD-TIME flag rather than a runtime env module lookup. The distinction
// matters because it enables dead code elimination in production bundles.
//
// Why not route this through env.get("VITE_AI_ENABLED")?
// Runtime env reads prevent Rollup from statically proving the branches are
// unreachable, so all AI code would ship in the production bundle even when
// disabled — ~100KB of unused code on every public docs visit.
//
// Why two checks?
//   - `import.meta.env.DEV` → true in `pnpm dev:docs`, false in `pnpm build`
//   - `import.meta.env.VITE_AI_ENABLED === "true"` → escape hatch for building
//     a production-like bundle with AI enabled, for testing the prod Docker
//     image locally before deploying. Set `VITE_AI_ENABLED=true pnpm build`.
//
// Both checks are literal-replaced by Vite at build time, so Rollup can fold
// them into a single constant and eliminate the dead branches. In the public
// production bundle, AI_ENABLED = false and the AI code paths are stripped.
//
// See docs/guides/ai-features.mdx for the full rationale and setup walkthrough.
const AI_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_AI_ENABLED === "true";

const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

function getParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

const identity = USE_COLLAB
  ? {
      room: getParam("room") ?? "default",
      userName: getParam("user") ?? `User ${Math.floor(Math.random() * 100)}`,
      userColor:
        getParam("color") ?? COLORS[Math.floor(Math.random() * COLORS.length)]!,
      wsUrl: env.get("VITE_WS_URL"),
    }
  : null;

const EXTENSIONS =
  USE_COLLAB && identity
    ? [
        StarterKit.configure({ history: false }),
        Collaboration.configure({ url: identity.wsUrl, name: identity.room }),
        CollaborationCursor.configure({
          user: { name: identity.userName, color: identity.userColor },
        }),
        PdfExport.configure({ filename: identity.room }),
        TrackChanges.configure({
          userID: identity.userName,
          canAcceptReject: true,
        }),
        // AiToolkit is only loaded in local dev (see AI_ENABLED above).
        ...(AI_ENABLED ? [AiToolkit] : []),
      ]
    : [
        StarterKit,
        PdfExport.configure({ filename: "scrivr-demo" }),
        TrackChanges.configure({ userID: "demo-user", canAcceptReject: true }),
        ...(AI_ENABLED ? [AiToolkit] : []),
        DemoContent,
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

type SidebarTab = "ai" | "changes";

export function Playground() {
  // Default to "changes" when AI is disabled in production builds so there's
  // a valid tab selection even though the "ai" tab won't render.
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(
    AI_ENABLED ? "ai" : "changes",
  );

  const editor = useScrivrEditor({
    extensions: EXTENSIONS,
    pageConfig: defaultPageConfig,
  });

  // Debug helper — call window.inspectDoc() in the browser console to print
  // the full ProseMirror document JSON at the current moment.
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>)["inspectDoc"] = () => {
      if (!editor) {
        console.warn("editor not ready");
        return;
      }
      const doc = editor.getState().doc;
      console.log("[ProseMirror doc]", doc.toJSON());
      return doc.toJSON();
    };
  }
  const toolbar =
    useEditorState({ editor, selector: selectToolbar }) ?? EMPTY_TOOLBAR;

  const pageInfo = useEditorState({
    editor,
    selector: (ctx) => ({
      current: ctx.editor.cursorPage,
      total: ctx.editor.layout.pages.length,
    }),
    equalityFn: (a, b) => a.current === b.current && a.total === b.total,
  }) ?? { current: 1, total: 1 };

  const loadingState = useEditorState({
    editor,
    selector: (ctx) => ctx.editor.loadingState,
    equalityFn: Object.is,
  });

  return (
    <div className="flex flex-col h-screen bg-[#f7f8fa] font-sans">
      {/* ── Header ── */}
      <header className="flex items-center justify-between h-11 px-2 md:px-4 bg-white border-b border-[#e8eaed] shrink-0 gap-2 md:gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <a
            href="/"
            className="flex items-center gap-1 text-[13px] text-gray-500 no-underline px-1.5 py-0.5 rounded-md hover:bg-gray-100 hover:text-gray-700 transition-colors shrink-0"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className="block"
            >
              <path
                d="M9 2L4 7l5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="hidden sm:inline">Docs</span>
          </a>
          <div className="w-px h-4 bg-gray-200 hidden sm:block" />
          <span className="text-[14px] font-semibold text-gray-900 tracking-tight shrink-0">
            scrivr
          </span>
          <span className="text-[11px] font-medium text-indigo-500 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-px tracking-wide hidden sm:inline">
            playground
          </span>
          {!AI_ENABLED && (
            <a
              href="/docs/guides/ai-features"
              className="text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-px tracking-wide no-underline hover:bg-gray-100 hover:text-gray-700 transition-colors hidden md:inline"
              title="AI features are available when running the docs app locally"
            >
              AI · local dev
            </a>
          )}
        </div>

        <div className="flex items-center justify-center shrink-0">
          <span className="text-[12px] text-gray-400 tabular-nums tracking-wide">
            {pageInfo.current} / {pageInfo.total}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0 hidden md:flex">
          {USE_COLLAB && identity && (
            <>
              <span
                className="w-[7px] h-[7px] rounded-full shrink-0"
                style={{ background: identity.userColor }}
              />
              <span className="text-[12px] font-medium text-gray-700 truncate">
                {identity.userName}
              </span>
              <span className="text-[12px] text-gray-300">·</span>
              <span className="text-[12px] text-gray-400 truncate">{identity.room}</span>
            </>
          )}
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="flex items-stretch shrink-0 bg-white border-b border-[#e8eaed]">
        <div className="flex-1 overflow-x-auto">
          <Toolbar
            items={editor?.toolbarItems ?? []}
            activeMarks={toolbar.activeMarks}
            activeMarkAttrs={toolbar.activeMarkAttrs}
            blockType={toolbar.blockType}
            blockAttrs={toolbar.blockAttrs}
            editor={editor}
          />
        </div>
        <div className="flex items-center px-3 border-l border-[#e8eaed] shrink-0">
          <ModeSwitcher editor={editor} />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative">
        <main className="flex-1 overflow-auto p-1 md:p-4">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24, margin: "0 auto", width: "fit-content" }}>
            <Scrivr
              editor={editor}
              style={{ position: "relative" }}
              pageStyle={{ boxShadow: "none", border: "1px solid #e8eaed" }}
            />
            {AI_ENABLED && (
              <AiSuggestionCardsPanel editor={editor} mode="tracked" />
            )}
          </div>
        </main>

        {/* ── Right sidebar — hidden on mobile ── */}
        <div
          className="hidden md:flex"
          style={{
            flexDirection: "column",
            width: 300,
            flexShrink: 0,
            overflow: "hidden",
            borderLeft: "1px solid #e8eaed",
            background: "#fff",
          }}
        >
          {AI_ENABLED ? (
            <>
              {/* Tab bar — only when AI is available. In prod the AI tab is
                  dropped entirely and the sidebar shows Track Changes only. */}
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid #e8eaed",
                  flexShrink: 0,
                }}
              >
                {(["ai", "changes"] as SidebarTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setSidebarTab(tab)}
                    style={{ letterSpacing: "-0.01em" }}
                    className={`flex-1 h-9 border-none bg-transparent cursor-pointer text-xs border-b-2 transition-[color,border-color] duration-150 ${
                      sidebarTab === tab
                        ? "font-semibold text-indigo-500 border-indigo-500"
                        : "font-normal text-gray-500 border-transparent"
                    }`}
                  >
                    {tab === "ai" ? "AI Assistant" : "Track Changes"}
                  </button>
                ))}
              </div>

              {/* Panel content — both mounted, only one visible */}
              <div
                style={{
                  flex: 1,
                  overflow: "hidden",
                  display: sidebarTab === "ai" ? "flex" : "none",
                  flexDirection: "column",
                }}
              >
                <ChatPanel editor={editor} hideBorder />
              </div>
              <div
                style={{
                  flex: 1,
                  overflow: "hidden",
                  display: sidebarTab === "changes" ? "flex" : "none",
                  flexDirection: "column",
                }}
              >
                <TrackChangesPanel editor={editor} />
              </div>
            </>
          ) : (
            <>
              {/* Prod mode: no tab bar, just Track Changes full-height. */}
              <div
                style={{
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderBottom: "1px solid #e8eaed",
                  flexShrink: 0,
                  letterSpacing: "-0.01em",
                }}
                className="text-xs font-semibold text-indigo-500"
              >
                Track Changes
              </div>
              <div
                style={{
                  flex: 1,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <TrackChangesPanel editor={editor} />
              </div>
            </>
          )}
        </div>

        {USE_COLLAB && loadingState === "syncing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(247,248,250,0.85)] backdrop-blur-sm z-10">
            <div className="flex items-center gap-2.5 bg-white border border-[#e8eaed] rounded-xl px-5 py-3 shadow-lg">
              <LoadingSpinner />
              <span className="text-[13px] font-medium text-gray-700">
                Connecting…
              </span>
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
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      className="block animate-spin"
    >
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="2"
      />
      <path
        d="M9 2a7 7 0 0 1 7 7"
        fill="none"
        stroke="#6366f1"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
