import {
  useScrivrEditor,
  Scrivr,
  useEditorState,
  StarterKit,
  defaultPageConfig,
  LinkPopover,
  SlashMenu,
  ImageMenu,
  HeaderFooterRibbon,
} from "@scrivr/react";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import type { EditorStateContext, EditorTheme } from "@scrivr/react";
import { PdfExport } from "@scrivr/export-pdf";
import { DocxExport, DocxImport } from "@scrivr/docx";
import {
  Collaboration,
  CollaborationCursor,
  TrackChanges,
  AiToolkit,
  HeaderFooter,
} from "@scrivr/plugins";
import { Toolbar } from "./Toolbar";
import { BubbleMenuBar } from "./BubbleMenuBar";
import { FloatingMenuBar } from "./FloatingMenuBar";
import { ModeSwitcher } from "./ModeSwitcher";
import {
  TrackChangesPopover,
  TrackChangesPanel,
  AiSuggestionCardsPanel,
  useTrackChangesPanel,
  useAiSuggestionCards,
} from "@scrivr/react";
import { ChatPanel } from "./ChatPanel";
import { DemoContent } from "./demoContent";
import { env } from "../lib/env";
import {
  ChevronLeft,
  FileText,
  History,
  MessageSquareText,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Sun,
} from "lucide-react";

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

// Canvas theme — every token is a CSS variable so the MutationObserver in the
// Editor auto-repaints when the `dark` class flips on <html>. The variables
// are defined in styles/app.css under `:root` (light) and `.dark` (dark).
const PLAYGROUND_THEME: EditorTheme = {
  pageBg: "var(--scrivr-page-bg)",
  pageShadow: "none",
  defaultText: "var(--scrivr-text)",
  link: "var(--scrivr-link)",
  cursor: "var(--scrivr-cursor)",
  selectionFill: "var(--scrivr-selection)",
  imagePlaceholderBg: "var(--scrivr-img-placeholder-bg)",
  imagePlaceholderBorder: "var(--scrivr-img-placeholder-border)",
  imagePlaceholderText: "var(--scrivr-img-placeholder-text)",
  listMarker: "var(--scrivr-list-marker)",
  hrColor: "var(--scrivr-hr)",
  resizeHandle: "var(--scrivr-resize-handle)",
};

function useDarkMode(): { isDark: boolean; toggle: () => void } {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isDark = mounted && resolvedTheme === "dark";
  const toggle = () => {
    setTheme(isDark ? "light" : "dark");
  };
  return { isDark, toggle };
}

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
        StarterKit.configure({ history: false, table: true }),
        Collaboration.configure({ url: identity.wsUrl, name: identity.room }),
        CollaborationCursor.configure({
          user: { name: identity.userName, color: identity.userColor },
        }),
        HeaderFooter,
        PdfExport.configure({ filename: identity.room }),
        DocxExport.configure({ filename: identity.room }),
        DocxImport,
        TrackChanges.configure({
          userID: identity.userName,
          canAcceptReject: true,
        }),
        // AiToolkit is only loaded in local dev (see AI_ENABLED above).
        ...(AI_ENABLED ? [AiToolkit] : []),
      ]
    : [
        StarterKit.configure({ table: true }),
        HeaderFooter,
        PdfExport.configure({ filename: "scrivr-demo" }),
        DocxExport.configure({ filename: "scrivr-demo" }),
        DocxImport,
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { isDark, toggle: toggleDark } = useDarkMode();

  const editor = useScrivrEditor({
    extensions: EXTENSIONS,
    pageConfig: defaultPageConfig,
    theme: PLAYGROUND_THEME,
    // Resolve var(--scrivr-...) against <html> so the existing fumadocs
    // dark-class strategy drives canvas paint without a second toggle.
    themeRoot:
      typeof document !== "undefined" ? document.documentElement : undefined,
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
      pageWidth: ctx.editor.layout.pageConfig.pageWidth,
    }),
    equalityFn: (a, b) =>
      a.current === b.current &&
      a.total === b.total &&
      a.pageWidth === b.pageWidth,
  }) ?? { current: 1, total: 1, pageWidth: defaultPageConfig.pageWidth };

  const loadingState = useEditorState({
    editor,
    selector: (ctx) => ctx.editor.loadingState,
    equalityFn: Object.is,
  });
  const trackPanel = useTrackChangesPanel(editor);
  const aiSuggestions = useAiSuggestionCards(editor);

  return (
    <div className="flex h-screen flex-col overflow-hidden font-sans" style={{ background: "var(--app-bg)", color: "var(--app-text)" }}>
      <header
        className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:px-3"
        style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
      >
        <div className="flex min-w-0 flex-[1.3] items-center gap-2">
          <a
            href="/"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-[13px] no-underline transition-colors"
            style={{
              color: "var(--app-text-muted)",
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
            title="Back to docs"
            aria-label="Back to docs"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </a>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold" style={{ color: "var(--app-text)" }}>
                Scrivr Playground
              </span>
            </div>
            <div className="hidden items-center gap-1.5 text-[11px] md:flex" style={{ color: "var(--app-text-muted)" }}>
              <FileText size={12} strokeWidth={2} />
              <span className="truncate">Document editor playground</span>
            </div>
          </div>
        </div>

        <div className="hidden shrink-0 items-center lg:flex">
          <StatusPill icon={<FileText size={12} strokeWidth={2} />}>
            Page {pageInfo.current} of {pageInfo.total}
          </StatusPill>
        </div>

        <div className="flex min-w-0 flex-[1.3] items-center justify-end gap-1.5">
          {USE_COLLAB && identity && (
            <div className="hidden min-w-0 items-center gap-1.5 md:flex">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: identity.userColor }}
              />
              <span
                className="truncate text-[12px] font-medium"
                style={{ color: "var(--app-text)" }}
              >
                {identity.userName}
              </span>
            </div>
          )}
          {AI_ENABLED ? (
            <StatusPill tone="accent" icon={<Sparkles size={12} strokeWidth={2} />}>AI</StatusPill>
          ) : (
            <a href="/docs/guides/ai-features" className="hidden no-underline lg:inline-flex">
              <StatusPill>AI local</StatusPill>
            </a>
          )}
          <ModeSwitcher editor={editor} />
          <IconButton
            onClick={toggleDark}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            ariaLabel="Toggle theme"
          >
            {isDark ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
          </IconButton>
          <IconButton
            onClick={() => setSidebarOpen((open) => !open)}
            title={sidebarOpen ? "Hide side panel" : "Show side panel"}
            ariaLabel={sidebarOpen ? "Hide side panel" : "Show side panel"}
            className="hidden md:inline-flex"
          >
            {sidebarOpen ? <PanelRightClose size={15} strokeWidth={2} /> : <PanelRightOpen size={15} strokeWidth={2} />}
          </IconButton>
        </div>
      </header>

      <div
        className="flex shrink-0 items-stretch border-b"
        style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
      >
        <div className="min-w-0 flex-1 overflow-x-auto">
          <Toolbar
            items={editor?.toolbarItems ?? []}
            activeMarks={toolbar.activeMarks}
            activeMarkAttrs={toolbar.activeMarkAttrs}
            blockType={toolbar.blockType}
            blockAttrs={toolbar.blockAttrs}
            editor={editor}
          />
        </div>
        <div className="flex shrink-0 items-center border-l px-2 md:hidden" style={{ borderColor: "var(--app-border)" }}>
          <span className="text-[11px] tabular-nums" style={{ color: "var(--app-text-muted)" }}>
            {pageInfo.current}/{pageInfo.total}
          </span>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-auto p-2 md:p-4">
            <div className="flex min-w-max justify-center">
              <div className="relative shrink-0" style={{ width: pageInfo.pageWidth }}>
                <Scrivr
                  editor={editor}
                  style={{ width: pageInfo.pageWidth }}
                  pageStyle={{
                    border: "1px solid var(--scrivr-page-border)",
                    background: "var(--scrivr-page-bg)",
                    boxShadow: "none",
                  }}
                />
                <HeaderFooterRibbon editor={editor} />
              </div>
            </div>
          </div>
          {AI_ENABLED && aiSuggestions.cards.length > 0 && (
            <div className="playground-ai-suggestions-scroll hidden shrink-0 overflow-y-auto overflow-x-hidden p-3 md:block">
              <AiSuggestionCardsPanel
                editor={editor}
                mode="tracked"
                className="playground-ai-suggestions"
                classNames={{
                  card: "playground-ai-suggestion-card",
                  header: "playground-ai-suggestion-header",
                  badge: "playground-ai-suggestion-badge",
                  diff: "playground-ai-suggestion-diff",
                  actions: "playground-ai-suggestion-actions",
                }}
                styles={{
                  panel: {
                    position: "static",
                    top: "auto",
                    gap: 10,
                  },
                }}
              />
            </div>
          )}
        </main>

        <aside
          className={sidebarOpen ? "playground-sidebar hidden md:flex" : "hidden"}
          style={{
            flexDirection: "column",
            width: 340,
            flexShrink: 0,
            overflow: "hidden",
            borderLeft: "1px solid var(--app-border)",
            background: "var(--app-surface)",
          }}
        >
          <div
            className="shrink-0 border-b p-3"
            style={{
              borderColor: "var(--app-border)",
              background: "linear-gradient(180deg, var(--app-surface), var(--app-surface-2))",
            }}
          >
            <div
              className="grid grid-cols-2 gap-1 rounded-lg border p-1"
              style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
            >
              {(AI_ENABLED ? (["ai", "changes"] as SidebarTab[]) : (["changes"] as SidebarTab[])).map((tab) => {
                const selected = sidebarTab === tab || !AI_ENABLED;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSidebarTab(tab)}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border text-[12px] font-semibold transition-colors"
                    style={{
                      background: selected ? "var(--app-accent-soft-bg)" : "transparent",
                      borderColor: selected ? "var(--app-accent-soft-border)" : "transparent",
                      color: selected ? "var(--app-accent-soft-fg)" : "var(--app-text-muted)",
                    }}
                  >
                    {tab === "ai" ? <MessageSquareText size={14} strokeWidth={2} /> : <History size={14} strokeWidth={2} />}
                    {tab === "ai" ? "Assistant" : "Changes"}
                    {tab === "changes" && trackPanel.changes.length > 0 && (
                      <span
                        className="ml-0.5 rounded-full px-1.5 text-[10px] leading-4"
                        style={{
                          background: selected ? "var(--app-surface)" : "var(--app-surface-2)",
                          color: selected ? "var(--app-accent-soft-fg)" : "var(--app-text-muted)",
                        }}
                      >
                        {trackPanel.changes.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold" style={{ color: "var(--app-text)" }}>
                    {sidebarTab === "ai" && AI_ENABLED ? "AI Assistant" : "Review Changes"}
                  </span>
                  {sidebarTab === "ai" && AI_ENABLED && (
                    <span
                      className="rounded-full border px-2 py-px text-[10px] font-semibold"
                      style={{
                        background: "var(--app-accent-soft-bg)",
                        borderColor: "var(--app-accent-soft-border)",
                        color: "var(--app-accent-soft-fg)",
                      }}
                    >
                      Claude
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--app-text-muted)" }}>
                  {sidebarTab === "ai" && AI_ENABLED
                    ? "Ask with document context or edit selected text."
                    : trackPanel.isEmpty
                      ? "No pending tracked changes."
                      : `${trackPanel.changes.length} pending change${trackPanel.changes.length === 1 ? "" : "s"} to review.`}
                </div>
              </div>
              {sidebarTab === "changes" && !trackPanel.isEmpty && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={trackPanel.rejectAll}
                    className="h-7 rounded-md border px-2 text-[11px] font-medium"
                    style={{
                      background: "var(--app-surface)",
                      borderColor: "var(--app-border)",
                      color: "var(--app-text-muted)",
                    }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={trackPanel.acceptAll}
                    className="h-7 rounded-md border px-2 text-[11px] font-semibold"
                    style={{
                      background: "var(--app-accent)",
                      borderColor: "var(--app-accent)",
                      color: "var(--app-accent-fg)",
                    }}
                  >
                    Accept
                  </button>
                </div>
              )}
            </div>
          </div>
          {AI_ENABLED ? (
            <>
              <div
                style={{
                  flex: 1,
                  overflow: "hidden",
                  display: sidebarTab === "ai" ? "flex" : "none",
                  flexDirection: "column",
                }}
              >
                <div className="playground-chat-shell flex min-h-0 flex-1 flex-col">
                  <ChatPanel editor={editor} hideBorder />
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  overflow: "hidden",
                  display: sidebarTab === "changes" ? "flex" : "none",
                  flexDirection: "column",
                }}
              >
                <TrackChangesPanel editor={editor} className="playground-track-panel" />
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <TrackChangesPanel editor={editor} className="playground-track-panel" />
            </div>
          )}
        </aside>

        {USE_COLLAB && loadingState === "syncing" && (
          <div
            className="absolute inset-0 flex items-center justify-center backdrop-blur-sm z-10"
            style={{ background: "color-mix(in srgb, var(--app-bg) 85%, transparent)" }}
          >
            <div
              className="flex items-center gap-2.5 border rounded-xl px-5 py-3 shadow-lg"
              style={{
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
              }}
            >
              <LoadingSpinner />
              <span
                className="text-[13px] font-medium"
                style={{ color: "var(--app-text)" }}
              >
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
        stroke="var(--app-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M9 2a7 7 0 0 1 7 7"
        fill="none"
        stroke="var(--app-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconButton({
  children,
  onClick,
  title,
  ariaLabel,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${className}`}
      style={{
        background: "var(--app-surface)",
        borderColor: "var(--app-border)",
        color: "var(--app-text-muted)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--app-surface-hover)";
        e.currentTarget.style.color = "var(--app-text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--app-surface)";
        e.currentTarget.style.color = "var(--app-text-muted)";
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({
  children,
  icon,
  tone = "neutral",
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "accent";
}) {
  const accent = tone === "accent";
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium"
      style={{
        background: accent ? "var(--app-accent-soft-bg)" : "var(--app-surface-2)",
        borderColor: accent ? "var(--app-accent-soft-border)" : "var(--app-border)",
        color: accent ? "var(--app-accent-soft-fg)" : "var(--app-text-muted)",
      }}
    >
      {icon}
      {children}
    </span>
  );
}
