import { useState } from "react";
import type { Editor } from "@inscribe/core";
import { TrackChangesStatus } from "@inscribe/plugins";

export type EditorMode = "editing" | "suggesting" | "viewing";

const MODES: { value: EditorMode; label: string; icon: string }[] = [
  { value: "editing",    label: "Editing",    icon: "✎" },
  { value: "suggesting", label: "Suggesting", icon: "◈" },
  { value: "viewing",    label: "Viewing",    icon: "◉" },
];

const MODE_STATUS: Record<EditorMode, TrackChangesStatus> = {
  editing:    TrackChangesStatus.disabled,
  suggesting: TrackChangesStatus.enabled,
  viewing:    TrackChangesStatus.viewSnapshots,
};

interface ModeSwitcherProps {
  editor: Editor | null;
}

export function ModeSwitcher({ editor }: ModeSwitcherProps) {
  const [mode, setMode] = useState<EditorMode>("editing");
  const [open, setOpen] = useState(false);

  const current = MODES.find(m => m.value === mode)!;

  const handleSelect = (next: EditorMode) => {
    setMode(next);
    setOpen(false);
    editor?.commands.setTrackingStatus?.(MODE_STATUS[next]);
  };

  return (
    <div className="relative inline-block">
      <button
        className="flex items-center gap-1.5 h-[28px] px-2.5 border border-[#e8eaed] rounded-md bg-white text-[12px] text-gray-700 font-medium cursor-pointer select-none tracking-tight"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}
      >
        <span className="text-[11px] text-indigo-500 leading-none">{current.icon}</span>
        <span className="min-w-[62px] text-left">{current.label}</span>
        <span className="text-[10px] opacity-40 ml-0.5">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-99" onClick={() => setOpen(false)} />
          <div className="absolute top-[calc(100%+5px)] right-0 z-100 bg-white border border-[#e8eaed] rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.04)] min-w-[148px] overflow-hidden p-1">
            {MODES.map(m => (
              <button
                key={m.value}
                className={[
                  "w-full flex items-center gap-2 px-2.5 py-[7px] border-none rounded-md text-[13px] font-medium cursor-pointer text-left tracking-tight transition-colors",
                  m.value === mode
                    ? "bg-indigo-50 text-indigo-700"
                    : "bg-transparent text-gray-700 hover:bg-gray-100",
                ].join(" ")}
                onMouseDown={e => { e.preventDefault(); handleSelect(m.value); }}
              >
                <span className={[
                  "text-[11px] leading-none w-[14px] text-center",
                  m.value === mode ? "text-indigo-500" : "text-gray-400",
                ].join(" ")}>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
