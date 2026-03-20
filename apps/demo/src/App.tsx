import {
  useCanvasEditor,
  Canvas,
  useEditorState,
  StarterKit,
  defaultPageConfig,
} from "@inscribe/react";
import type { EditorStateContext } from "@inscribe/react";
import { Toolbar } from "./Toolbar";

const EXTENSIONS = [StarterKit];

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
  const editor = useCanvasEditor({ extensions: EXTENSIONS });

  // deepEqual is the default — handles string[], nested objects correctly.
  const toolbar = useEditorState({ editor, selector: selectToolbar }) ?? EMPTY_TOOLBAR;

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <span style={styles.title}>inscribe</span>
        <span style={styles.badge}>dev</span>
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
        <Canvas editor={editor} pageConfig={defaultPageConfig} style={styles.canvas} />
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
