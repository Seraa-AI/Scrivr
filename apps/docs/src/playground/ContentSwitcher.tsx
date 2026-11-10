import type { DemoKind } from "./demoContent";

const OPTIONS: { value: DemoKind; label: string }[] = [
  { value: "editing", label: "Editing" },
  { value: "track-changes", label: "Track changes" },
];

interface ContentSwitcherProps {
  demo: DemoKind;
  onChange: (demo: DemoKind) => void;
}

/** Picks which demo document the playground shows. */
export function ContentSwitcher({ demo, onChange }: ContentSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Demo content"
      className="hidden h-[28px] items-center rounded-md border p-0.5 md:inline-flex"
      style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
    >
      {OPTIONS.map((option) => {
        const selected = option.value === demo;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={selected}
            className="h-full cursor-pointer rounded px-2.5 text-[12px] font-medium tracking-tight"
            style={
              selected
                ? { background: "var(--app-accent-soft-bg)", color: "var(--app-accent-soft-fg)" }
                : { background: "transparent", color: "var(--app-text)" }
            }
            onMouseDown={(e) => {
              e.preventDefault();
              if (!selected) onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
