import { useMemo, useState } from "react";
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
        label: "¶",
        title: "Paragraph",
        action: (e) => e.commands.setParagraph(),
      },
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
        title: "Bullet List",
        action: (e) => e.commands.toggleBulletList(),
      },
      {
        label: "1.",
        title: "Ordered List",
        action: (e) => e.commands.toggleOrderedList(),
      },
      {
        label: "<>",
        title: "Code Block",
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
  const [open, setOpen] = useState(false);
  const items = useBlockItems(editor);

  return (
    <FloatingMenu editor={editor}>
      <div className="relative flex items-center">
        <button
          title="Insert block"
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen((v) => !v);
          }}
          className={[
            "w-[22px] h-[22px] rounded-full border text-[15px] leading-none flex items-center justify-center cursor-pointer transition-all duration-100 shadow-sm p-0",
            open
              ? "bg-indigo-500 border-indigo-500 text-white rotate-45"
              : "bg-white border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500",
          ].join(" ")}
        >
          +
        </button>

        {open && (
          <div className="absolute left-7 top-1/2 -translate-y-1/2 bg-white border border-[#e8eaed] rounded-[9px] p-1 min-w-[164px] shadow-[0_4px_20px_rgba(0,0,0,0.1),0_1px_4px_rgba(0,0,0,0.06)] z-100">
            {items.map((item) => (
              <button
                key={item.title}
                title={item.title}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  if (editor) item.action(editor);
                }}
                className="flex items-center gap-2 w-full bg-transparent border-none rounded-md px-2 py-1.5 cursor-pointer text-left hover:bg-gray-100 transition-colors"
              >
                <span className="w-[22px] text-[12px] text-gray-400 font-mono text-center shrink-0">
                  {item.label}
                </span>
                <span className="text-[13px] font-medium text-gray-700">
                  {item.title}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </FloatingMenu>
  );
}
