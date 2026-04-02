import type { ToolbarItemSpec } from "@scrivr/core";
import { DEFAULT_FONT_FAMILY } from "@scrivr/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  List,
  ListOrdered,
  Code,
  Minus,
  Image as ImageIcon,
  Link as LinkIcon,
  Link2Off,
  type LucideIcon,
} from "lucide-react";

interface ToolbarProps {
  items: ToolbarItemSpec[];
  activeMarks: string[];
  activeMarkAttrs: Record<string, Record<string, unknown>>;
  blockType: string;
  blockAttrs: Record<string, unknown>;
  onCommand: (cmd: string, args?: unknown[]) => void;
  /** Document-level default font family — shown when no explicit family is set on the selection. */
  defaultFontFamily?: string;
  /** Document-level default font size in px — shown when no font_size mark is active. */
  defaultFontSize?: number;
}

// Map from command name → Lucide icon
const ICON_MAP: Record<string, LucideIcon> = {
  toggleBold: Bold,
  toggleItalic: Italic,
  toggleUnderline: Underline,
  toggleStrikethrough: Strikethrough,
  setAlignLeft: AlignLeft,
  setAlignCenter: AlignCenter,
  setAlignRight: AlignRight,
  setAlignJustify: AlignJustify,
  setHeading1: Heading1,
  setHeading2: Heading2,
  setHeading3: Heading3,
  setParagraph: Pilcrow,
  toggleBulletList: List,
  toggleOrderedList: ListOrdered,
  toggleCodeBlock: Code,
  insertHorizontalRule: Minus,
  insertImage: ImageIcon,
  setLink: LinkIcon,
  unsetLink: Link2Off,
};

/**
 * Toolbar — data-driven from extension ToolbarItemSpecs.
 *
 * Two special groups render as <select> dropdowns:
 *   "size"   — font size picker
 *   "family" — font family picker
 *
 * The "color" group renders colored circle swatches.
 * All other items render their Lucide icon (or text label as fallback).
 */
export function Toolbar({
  items,
  activeMarks,
  activeMarkAttrs,
  blockType,
  blockAttrs,
  onCommand,
  defaultFontFamily = DEFAULT_FONT_FAMILY,
  defaultFontSize = 14,
}: ToolbarProps) {
  const groupOrder: string[] = [];
  const groupMap = new Map<string, ToolbarItemSpec[]>();
  for (const item of items) {
    const g = item.group ?? "misc";
    if (!groupMap.has(g)) {
      groupMap.set(g, []);
      groupOrder.push(g);
    }
    groupMap.get(g)!.push(item);
  }

  return (
    <div className="flex items-center flex-wrap gap-0.5 px-2.5 py-1 bg-white min-h-[40px] flex-1">
      {groupOrder.map((group, gi) => (
        <div key={group} className="flex items-center gap-0.5">
          {gi > 0 && (
            <div className="w-px h-[18px] bg-gray-200 mx-1.5 shrink-0" />
          )}

          {group === "size" ? (
            <SizeSelect
              items={groupMap.get(group)!}
              activeMarkAttrs={activeMarkAttrs}
              defaultFontSize={defaultFontSize}
              onCommand={onCommand}
            />
          ) : group === "family" ? (
            <FamilySelect
              items={groupMap.get(group)!}
              activeMarkAttrs={activeMarkAttrs}
              blockAttrs={blockAttrs}
              defaultFontFamily={defaultFontFamily}
              onCommand={onCommand}
            />
          ) : (
            groupMap.get(group)!.map((item) => {
              const active = item.isActive(
                activeMarks,
                blockType,
                blockAttrs,
                activeMarkAttrs,
              );
              return (
                <ToolbarButton
                  key={`${item.command}:${JSON.stringify(item.args)}`}
                  item={item}
                  active={active}
                  onCommand={onCommand}
                />
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

// ── Toolbar button ─────────────────────────────────────────────────────────────

function ToolbarButton({
  item,
  active,
  onCommand,
}: {
  item: ToolbarItemSpec;
  active: boolean;
  onCommand: (cmd: string, args?: unknown[]) => void;
}) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center min-w-[28px] h-[28px] px-1.5 rounded-md border text-sm cursor-pointer select-none transition-colors duration-100",
        active
          ? "bg-indigo-50 border-indigo-200 text-indigo-600"
          : "bg-transparent border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800",
      ].join(" ")}
      onMouseDown={(e) => {
        e.preventDefault();
        onCommand(item.command, item.args);
      }}
      title={item.title}
      aria-pressed={active}
    >
      <ButtonLabel item={item} />
    </button>
  );
}

function ButtonLabel({ item }: { item: ToolbarItemSpec }) {
  // Color swatch: render a small colored circle
  if (item.group === "color") {
    const color = (item.labelStyle?.color as string) ?? "#000";
    return (
      <span
        className="w-3.5 h-3.5 rounded-full block border border-black/10"
        style={{ background: color }}
      />
    );
  }

  // Lucide icon if we have a mapping
  const Icon = ICON_MAP[item.command];
  if (Icon) return <Icon size={14} strokeWidth={2} />;

  // Fallback to text label
  return (
    <span
      className="leading-none pointer-events-none text-xs font-medium"
      style={item.labelStyle}
    >
      {item.label}
    </span>
  );
}

// ── Size dropdown ──────────────────────────────────────────────────────────────

function SizeSelect({
  items,
  activeMarkAttrs,
  defaultFontSize,
  onCommand,
}: {
  items: ToolbarItemSpec[];
  activeMarkAttrs: Record<string, Record<string, unknown>>;
  defaultFontSize: number;
  onCommand: (cmd: string, args?: unknown[]) => void;
}) {
  const markSize = activeMarkAttrs["font_size"]?.["size"];
  // Fall back to document default size when no explicit mark is set.
  const activeSize = typeof markSize === "number" ? markSize : defaultFontSize;
  const value = String(activeSize);
  const presetValues = new Set(items.map((i) => String(i.args?.[0])));
  const hasCustomSize = !presetValues.has(value);

  return (
    <select
      className="h-[28px] w-[60px] px-1.5 border border-gray-200 rounded-md bg-white text-xs text-gray-700 cursor-pointer outline-none appearance-none"
      value={value}
      onChange={(e) => {
        const item = items.find((i) => String(i.args?.[0]) === e.target.value);
        if (item) onCommand(item.command, item.args);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title="Font size"
    >
      {hasCustomSize && <option value={value}>{value}</option>}
      {items.map((item) => (
        <option key={String(item.args?.[0])} value={String(item.args?.[0])}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

// ── Family dropdown ────────────────────────────────────────────────────────────

function FamilySelect({
  items,
  activeMarkAttrs,
  blockAttrs,
  defaultFontFamily,
  onCommand,
}: {
  items: ToolbarItemSpec[];
  activeMarkAttrs: Record<string, Record<string, unknown>>;
  blockAttrs: Record<string, unknown>;
  defaultFontFamily: string;
  onCommand: (cmd: string, args?: unknown[]) => void;
}) {
  const inlineFamily = activeMarkAttrs["font_family"]?.["family"];
  const blockFamily = blockAttrs["fontFamily"];
  // Priority: inline mark → block attr → document default
  const activeFamily =
    typeof inlineFamily === "string" ? inlineFamily :
    typeof blockFamily  === "string" ? blockFamily :
    defaultFontFamily.split(",")[0]!.trim(); // strip fallback stack
  const value = activeFamily;

  return (
    <select
      className="h-[28px] w-[130px] px-1.5 border border-gray-200 rounded-md bg-white text-xs text-gray-700 cursor-pointer outline-none appearance-none"
      style={{ fontFamily: value }}
      value={value}
      onChange={(e) => {
        const item = items.find((i) => i.args?.[0] === e.target.value);
        if (item) onCommand(item.command, item.args);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title="Font family"
    >
      {/* Show custom family (e.g. from pasted content) if not in presets */}
      {!items.some((i) => i.args?.[0] === value) && (
        <option value={value} style={{ fontFamily: value }}>{value}</option>
      )}
      {items.map((item) => {
        const family = item.args?.[0] as string;
        return (
          <option key={family} value={family} style={{ fontFamily: family }}>
            {item.label}
          </option>
        );
      })}
    </select>
  );
}
