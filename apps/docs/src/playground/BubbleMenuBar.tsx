import { BubbleMenu } from "@scrivr/react";
import type { Editor } from "@scrivr/react";

interface BubbleMenuBarProps {
  editor: Editor | null;
}

type Btn = {
  label: string;
  title: string;
  command: string;
  mark: string;
};

const BUTTONS: Btn[] = [
  { label: "B", title: "Bold", command: "toggleBold", mark: "bold" },
  { label: "I", title: "Italic", command: "toggleItalic", mark: "italic" },
  {
    label: "U",
    title: "Underline",
    command: "toggleUnderline",
    mark: "underline",
  },
  {
    label: "S",
    title: "Strikethrough",
    command: "toggleStrikethrough",
    mark: "strikethrough",
  },
];

export function BubbleMenuBar({ editor }: BubbleMenuBarProps) {
  const activeMarks: string[] = editor?.getActiveMarks() ?? [];
  const hasLink = activeMarks.includes("link");

  return (
    <BubbleMenu editor={editor} className="bubble-menu-bar">
      <div className="flex items-center gap-0.5 bg-[#18181b] border border-white/8 rounded-[9px] px-1.5 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.2)]">
        {BUTTONS.map(({ label, title, command, mark }) => (
          <button
            key={command}
            title={title}
            onMouseDown={(e) => {
              e.preventDefault();
              editor?.commands[command]?.();
            }}
            className={[
              "px-2 py-1 rounded-md border-none text-[13px] leading-none cursor-pointer transition-colors duration-100",
              activeMarks.includes(mark)
                ? "bg-indigo-500 text-white"
                : "bg-transparent text-zinc-400 hover:bg-white/10 hover:text-white",
              label === "B" ? "font-bold" : "",
              label === "I" ? "italic" : "",
            ].join(" ")}
          >
            {label}
          </button>
        ))}

        <div className="w-px h-4 bg-white/10 mx-1" />

        <button
          title={hasLink ? "Edit link" : "Insert link"}
          onMouseDown={(e) => {
            e.preventDefault();
            editor?.commands.setLink?.();
          }}
          className={[
            "px-2 py-1 rounded-md border-none text-[13px] leading-none cursor-pointer transition-colors duration-100",
            hasLink
              ? "bg-indigo-500 text-white"
              : "bg-transparent text-zinc-400 hover:bg-white/10 hover:text-white",
          ].join(" ")}
        >
          🔗
        </button>

        {hasLink && (
          <button
            title="Remove link"
            onMouseDown={(e) => {
              e.preventDefault();
              editor?.commands.unsetLink?.();
            }}
            className="px-2 py-1 rounded-md border-none text-[13px] leading-none cursor-pointer bg-transparent text-zinc-400 hover:bg-white/10 hover:text-white transition-colors duration-100"
          >
            ⛓‍💥
          </button>
        )}
      </div>
    </BubbleMenu>
  );
}
