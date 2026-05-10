import { useMemo } from "react";
import { FloatingMenu } from "@scrivr/react";
import type { Editor } from "@scrivr/react";

interface FloatingMenuBarProps {
  editor: Editor | null;
}

type BlockItem = {
  label: string;
  title: string;
  action: (editor: Editor) => void;
};

function useBlockItems(editor: Editor | null): BlockItem[] {
  return useMemo(
    () => [
      {
        label: "H1",
        title: "Heading 1",
        action: (e) => e.commands.setHeading1(),
      },
      {
        label: "H2",
        title: "Heading 2",
        action: (e) => e.commands.setHeading2(),
      },
      {
        label: "H3",
        title: "Heading 3",
        action: (e) => e.commands.setHeading3(),
      },
      {
        label: "•",
        title: "Bullet list",
        action: (e) => e.commands.toggleBulletList(),
      },
      {
        label: "1.",
        title: "Ordered list",
        action: (e) => e.commands.toggleOrderedList(),
      },
      {
        label: "<>",
        title: "Code block",
        action: (e) => e.commands.toggleCodeBlock(),
      },
      {
        label: "—",
        title: "Divider",
        action: (e) => e.commands.insertHorizontalRule(),
      },
    ],
    [!!editor],
  );
}

export function FloatingMenuBar({ editor }: FloatingMenuBarProps) {
  const items = useBlockItems(editor);

  return (
    <FloatingMenu editor={editor}>
      <div
        className="flex items-center gap-1 rounded-lg border border-l-2 px-1.5 py-1 shadow-sm"
        style={{
          background: "var(--app-surface-2)",
          borderColor: "var(--app-border)",
          borderLeftColor: "var(--app-accent)",
        }}
      >
        {items.map((item) => (
          <button
            key={item.title}
            title={item.title}
            onMouseDown={(e) => {
              e.preventDefault();
              if (editor) item.action(editor);
            }}
            className="px-2 py-0.5 text-[13px] font-medium rounded transition-colors cursor-pointer bg-transparent border-none"
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
            {item.label}
          </button>
        ))}
      </div>
    </FloatingMenu>
  );
}
