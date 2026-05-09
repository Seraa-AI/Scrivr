import { useState } from "react";
import type { Editor } from "@scrivr/core";
import { TrackChangesStatus } from "@scrivr/plugins";

export type EditorMode = "editing" | "suggesting" | "viewOnly";

const MODES: { value: EditorMode; label: string; icon: string }[] = [
  { value: "editing", label: "Editing", icon: "✎" },
  { value: "suggesting", label: "Suggesting", icon: "◈" },
  { value: "viewOnly", label: "View Only", icon: "◉" },
];

const MODE_STATUS: Record<EditorMode, TrackChangesStatus> = {
  editing: TrackChangesStatus.disabled,
  suggesting: TrackChangesStatus.enabled,
  viewOnly: TrackChangesStatus.viewSnapshots,
};

interface ModeSwitcherProps {
  editor: Editor | null;
}

export function ModeSwitcher({ editor }: ModeSwitcherProps) {
  const [mode, setMode] = useState<EditorMode>("editing");
  const [open, setOpen] = useState(false);

  const current = MODES.find((m) => m.value === mode)!;

  const handleSelect = (next: EditorMode) => {
    setMode(next);
    setOpen(false);
    editor?.commands.setTrackingStatus?.(MODE_STATUS[next]);
    editor?.setReadOnly(next === "viewOnly");
  };

  return (
    <div className="relative inline-block">
      <button
        className="flex items-center gap-1.5 h-[28px] px-2.5 border rounded-md text-[12px] font-medium cursor-pointer select-none tracking-tight"
        style={{
          background: "var(--app-surface)",
          borderColor: "var(--app-border)",
          color: "var(--app-text)",
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <span className="text-[11px] leading-none" style={{ color: "var(--app-accent)" }}>
          {current.icon}
        </span>
        <span className="min-w-[62px] text-left">{current.label}</span>
        <span className="text-[10px] opacity-40 ml-0.5">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-99" onClick={() => setOpen(false)} />
          <div
            className="absolute top-[calc(100%+5px)] right-0 z-100 border rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.18),0_1px_4px_rgba(0,0,0,0.08)] min-w-[148px] overflow-hidden p-1"
            style={{
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            {MODES.map((m) => {
              const selected = m.value === mode;
              return (
                <button
                  key={m.value}
                  className="w-full flex items-center gap-2 px-2.5 py-[7px] border-none rounded-md text-[13px] font-medium cursor-pointer text-left tracking-tight transition-colors"
                  style={
                    selected
                      ? {
                          background: "var(--app-accent-soft-bg)",
                          color: "var(--app-accent-soft-fg)",
                        }
                      : {
                          background: "transparent",
                          color: "var(--app-text)",
                        }
                  }
                  onMouseEnter={(e) => {
                    if (selected) return;
                    e.currentTarget.style.background = "var(--app-surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (selected) return;
                    e.currentTarget.style.background = "transparent";
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(m.value);
                  }}
                >
                  <span
                    className="text-[11px] leading-none w-[14px] text-center"
                    style={{
                      color: selected
                        ? "var(--app-accent)"
                        : "var(--app-text-faint)",
                    }}
                  >
                    {m.icon}
                  </span>
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
