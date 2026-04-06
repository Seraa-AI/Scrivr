import { BubbleMenu } from "@scrivr/react";
import type { Editor } from "@scrivr/react";

interface BubbleMenuBarProps {
  editor: Editor | null;
}

type Btn = {
  label: string;
  title: string;
  mark: string;
  action: (editor: Editor) => void;
};

const BUTTONS: Btn[] = [
  {
    label: "B",
    title: "Bold",
    mark: "bold",
    action: (e) => e.commands.toggleBold(),
  },
  {
    label: "I",
    title: "Italic",
    mark: "italic",
    action: (e) => e.commands.toggleItalic(),
  },
  {
    label: "U",
    title: "Underline",
    mark: "underline",
    action: (e) => e.commands.toggleUnderline(),
  },
  {
    label: "S",
    title: "Strikethrough",
    mark: "strikethrough",
    action: (e) => e.commands.toggleStrikethrough(),
  },
];

export function BubbleMenuBar({ editor }: BubbleMenuBarProps) {
  const activeMarks: string[] = editor?.getActiveMarks() ?? [];
  const hasLink = activeMarks.includes("link");

  return (
    <BubbleMenu editor={editor} className="bubble-menu-bar">
      <div className="flex items-center gap-0.5 bg-[#18181b] border border-white/8 rounded-[9px] px-1.5 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.2)]">
        {BUTTONS.map(({ label, title, mark, action }) => (
          <button
            key={mark}
            title={title}
            onMouseDown={(e) => {
              e.preventDefault();
              if (editor) action(editor);
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
