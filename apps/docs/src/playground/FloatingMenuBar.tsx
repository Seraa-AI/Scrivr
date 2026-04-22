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
      <div className="flex items-center gap-1 rounded-lg bg-gray-50 border border-gray-200 border-l-2 border-l-indigo-400 px-1.5 py-1 shadow-sm">
        {items.map((item) => (
          <button
            key={item.title}
            title={item.title}
            onMouseDown={(e) => {
              e.preventDefault();
              if (editor) item.action(editor);
            }}
            className="px-2 py-0.5 text-[13px] font-medium text-gray-600 rounded hover:bg-gray-200 hover:text-gray-900 transition-colors cursor-pointer bg-transparent border-none"
          >
            {item.label}
          </button>
        ))}
      </div>
    </FloatingMenu>
  );
}
