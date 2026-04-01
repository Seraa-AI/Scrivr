import { useState } from "react";
import { FloatingMenu } from "@scrivr/react";
import type { Editor } from "@scrivr/react";

interface FloatingMenuBarProps {
  editor: Editor | null;
}

type BlockItem = {
  label: string;
  title: string;
  command: string;
  args?: unknown[];
};

const BLOCK_ITEMS: BlockItem[] = [
  { label: "¶",  title: "Paragraph",    command: "setParagraph" },
  { label: "H1", title: "Heading 1",    command: "setHeading1" },
  { label: "H2", title: "Heading 2",    command: "setHeading2" },
  { label: "H3", title: "Heading 3",    command: "setHeading3" },
  { label: "•",  title: "Bullet List",  command: "toggleBulletList" },
  { label: "1.", title: "Ordered List", command: "toggleOrderedList" },
  { label: "<>", title: "Code Block",   command: "toggleCodeBlock" },
  { label: "—",  title: "Divider",      command: "insertHorizontalRule" },
];

export function FloatingMenuBar({ editor }: FloatingMenuBarProps) {
  const [open, setOpen] = useState(false);

  function runCommand(item: BlockItem) {
    setOpen(false);
    editor?.commands[item.command]?.(...(item.args ?? []));
  }

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
            {BLOCK_ITEMS.map((item) => (
              <button
                key={item.command}
                title={item.title}
                onMouseDown={(e) => {
                  e.preventDefault();
                  runCommand(item);
                }}
                className="flex items-center gap-2 w-full bg-transparent border-none rounded-md px-2 py-1.5 cursor-pointer text-left hover:bg-gray-100 transition-colors"
              >
                <span className="w-[22px] text-[12px] text-gray-400 font-mono text-center shrink-0">
                  {item.label}
                </span>
                <span className="text-[13px] font-medium text-gray-700">{item.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </FloatingMenu>
  );
}
