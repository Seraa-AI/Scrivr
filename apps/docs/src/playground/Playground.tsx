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
import { useEffect, useState } from "react";
import type { EditorStateContext, EditorTheme } from "@scrivr/react";
import { PdfExport } from "@scrivr/export-pdf";
import { DocxExport } from "@scrivr/docx";
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

// Canvas theme — every token is a CSS variable so the MutationObserver in the
// Editor auto-repaints when the `dark` class flips on <html>. The variables
// are defined in styles/app.css under `:root` (light) and `.dark` (dark).
const PLAYGROUND_THEME: EditorTheme = {
  pageBg: "var(--scrivr-page-bg)",
  pageShadow: "var(--scrivr-page-shadow)",
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

/**
 * Tracks whether <html> has the `dark` class. Reads on mount, syncs via
 * MutationObserver, and toggles the class on demand. Avoids adding next-themes
 * as a direct dep — fumadocs's RootProvider also drives the same class.
 */
function useDarkMode(): { isDark: boolean; toggle: () => void } {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    setIsDark(root.classList.contains("dark"));
    const obs = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  const toggle = () => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark");
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
        StarterKit.configure({ history: false }),
        Collaboration.configure({ url: identity.wsUrl, name: identity.room }),
        CollaborationCursor.configure({
          user: { name: identity.userName, color: identity.userColor },
        }),
        HeaderFooter,
        PdfExport.configure({ filename: identity.room }),
        DocxExport.configure({ filename: identity.room }),
        TrackChanges.configure({
          userID: identity.userName,
          canAcceptReject: true,
        }),
        // AiToolkit is only loaded in local dev (see AI_ENABLED above).
        ...(AI_ENABLED ? [AiToolkit] : []),
      ]
    : [
        StarterKit,
        HeaderFooter,
        PdfExport.configure({ filename: "scrivr-demo" }),
        DocxExport.configure({ filename: "scrivr-demo" }),
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
    }),
    equalityFn: (a, b) => a.current === b.current && a.total === b.total,
  }) ?? { current: 1, total: 1 };

  const loadingState = useEditorState({
    editor,
    selector: (ctx) => ctx.editor.loadingState,
    equalityFn: Object.is,
  });

  return (
    <div className="flex flex-col h-screen font-sans" style={{ background: "var(--app-bg)", color: "var(--app-text)" }}>
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between h-11 px-2 md:px-4 border-b shrink-0 gap-2 md:gap-3"
        style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <a
            href="/"
            className="flex items-center gap-1 text-[13px] no-underline px-1.5 py-0.5 rounded-md transition-colors shrink-0"
            style={{ color: "var(--app-text-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--app-surface-hover)";
              e.currentTarget.style.color = "var(--app-text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--app-text-muted)";
            }}
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
          <div className="w-px h-4 hidden sm:block" style={{ background: "var(--app-border)" }} />
          <span
            className="text-[14px] font-semibold tracking-tight shrink-0"
            style={{ color: "var(--app-text)" }}
          >
            scrivr
          </span>
          <span
            className="text-[11px] font-medium border rounded-full px-2 py-px tracking-wide hidden sm:inline"
            style={{
              color: "var(--app-accent-soft-fg)",
              background: "var(--app-accent-soft-bg)",
              borderColor: "var(--app-accent-soft-border)",
            }}
          >
            playground
          </span>
          {!AI_ENABLED && (
            <a
              href="/docs/guides/ai-features"
              className="text-[11px] font-medium border rounded-full px-2 py-px tracking-wide no-underline transition-colors hidden md:inline"
              style={{
                color: "var(--app-text-muted)",
                background: "var(--app-surface-2)",
                borderColor: "var(--app-border)",
              }}
              title="AI features are available when running the docs app locally"
            >
              AI · local dev
            </a>
          )}
        </div>

        <div className="flex items-center justify-center shrink-0">
          <span
            className="text-[12px] tabular-nums tracking-wide"
            style={{ color: "var(--app-text-muted)" }}
          >
            {pageInfo.current} / {pageInfo.total}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0 hidden md:flex">
          <button
            type="button"
            onClick={toggleDark}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle theme"
            className="flex items-center justify-center w-7 h-7 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text)] hover:opacity-80 transition-opacity shrink-0"
          >
            {/* Inline SVG so we don't pull in an icon library. The crescent
                shows in light mode (toggle target = dark); the sun shows in
                dark mode. */}
            {isDark ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {USE_COLLAB && identity && (
            <>
              <span
                className="w-[7px] h-[7px] rounded-full shrink-0"
                style={{ background: identity.userColor }}
              />
              <span
                className="text-[12px] font-medium truncate"
                style={{ color: "var(--app-text)" }}
              >
                {identity.userName}
              </span>
              <span className="text-[12px]" style={{ color: "var(--app-text-faint)" }}>
                ·
              </span>
              <span
                className="text-[12px] truncate"
                style={{ color: "var(--app-text-muted)" }}
              >
                {identity.room}
              </span>
            </>
          )}
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div
        className="flex items-stretch shrink-0 border-b"
        style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
      >
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
        <div className="flex items-center px-3 border-l shrink-0" style={{ borderColor: "var(--app-border)" }}>
          <ModeSwitcher editor={editor} />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative">
        <main className="flex-1 overflow-auto p-1 md:p-4">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24, margin: "0 auto", width: "fit-content" }}>
            <div style={{ position: "relative" }}>
              <Scrivr
                editor={editor}
                pageStyle={{ border: "1px solid var(--app-border)" }}
              />
              <HeaderFooterRibbon editor={editor} />
            </div>
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
            borderLeft: "1px solid var(--app-border)",
            background: "var(--app-surface)",
          }}
        >
          {AI_ENABLED ? (
            <>
              {/* Tab bar — only when AI is available. In prod the AI tab is
                  dropped entirely and the sidebar shows Track Changes only. */}
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid var(--app-border)",
                  flexShrink: 0,
                }}
              >
                {(["ai", "changes"] as SidebarTab[]).map((tab) => {
                  const selected = sidebarTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setSidebarTab(tab)}
                      style={{
                        letterSpacing: "-0.01em",
                        color: selected ? "var(--app-accent)" : "var(--app-text-muted)",
                        borderBottom: selected
                          ? "2px solid var(--app-accent)"
                          : "2px solid transparent",
                        fontWeight: selected ? 600 : 400,
                      }}
                      className="flex-1 h-9 border-none bg-transparent cursor-pointer text-xs transition-[color,border-color] duration-150"
                    >
                      {tab === "ai" ? "AI Assistant" : "Track Changes"}
                    </button>
                  );
                })}
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
                  borderBottom: "1px solid var(--app-border)",
                  flexShrink: 0,
                  letterSpacing: "-0.01em",
                  color: "var(--app-accent)",
                }}
                className="text-xs font-semibold"
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
