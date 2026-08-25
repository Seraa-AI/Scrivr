import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import {
  DEFAULT_SECTION_SETTINGS,
  applySectionSettingsPatch,
  deriveSections,
  findSectionById,
  sectionAt,
  coerceSectionSettings,
  type SectionBreakType,
  type SectionSettings,
  type SectionSettingsPatch,
} from "../../model/sections";
import type { SemanticNodeHandler } from "../../exports/semantic";

/**
 * Sections — the document partition that owns column geometry and (later)
 * page chrome and page geometry.
 *
 * Registers:
 *   - `sectionBreak` block atom carrying the settings of the section it ENDS
 *   - doc attr `finalSection` carrying the settings of the trailing section
 *   - commands: insertSectionBreak, setSectionSettings, removeSectionBreak
 *
 * The projection into ranges lives in `deriveSections` (`model/sections.ts`),
 * which is pure and never mints ids. See `docs/sections-roadmap.md`.
 */
export const Sections = Extension.create({
  name: "sections",

  addNodes() {
    return {
      sectionBreak: {
        group: "block",
        atom: true,
        selectable: false,
        attrs: {
          nodeId: { default: null },
          /**
           * Settings of the section this break terminates. `null` means "the
           * defaults" — writers store only what they changed, matching how a
           * document with no breaks at all behaves.
           */
          settings: { default: null },
        },
        parseDOM: [
          {
            tag: "div.scrivr-section-break",
            getAttrs(dom) {
              if (!(dom instanceof HTMLElement)) return false;
              const raw = dom.getAttribute("data-section-settings");
              return {
                nodeId: dom.getAttribute("data-node-id") ?? null,
                settings: raw ? parseSettingsJson(raw) : null,
              };
            },
          },
        ],
        toDOM(node) {
          const attrs: Record<string, string> = { class: "scrivr-section-break" };
          const nodeId = node.attrs["nodeId"];
          if (typeof nodeId === "string") attrs["data-node-id"] = nodeId;
          if (node.attrs["settings"] !== null) {
            attrs["data-section-settings"] = JSON.stringify(
              coerceSectionSettings(node.attrs["settings"]),
            );
          }
          return ["div", attrs];
        },
      },
    };
  },

  addDocAttrs() {
    return {
      finalSection: { default: null },
    };
  },

  addCommands() {
    return {
      insertSectionBreak: (breakType?: SectionBreakType) => insertSectionBreak(breakType),
      setSectionSettings: (sectionId: string, patch: SectionSettingsPatch) =>
        setSectionSettings(sectionId, patch),
      removeSectionBreak: (sectionId: string) => removeSectionBreak(sectionId),
    };
  },

  addExports() {
    const semanticHandler: SemanticNodeHandler = () => ({ type: "sectionBreak" });
    return { semantic: { nodes: { sectionBreak: semanticHandler } } };
  },
});

function parseSettingsJson(raw: string): SectionSettings | null {
  try {
    return coerceSectionSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Insert a break after the current top-level block.
 *
 * The new break carries the current section's settings, so both halves of the
 * split keep the geometry the section already had — the caller then changes
 * whichever side it meant to change. Only `breakType` (how the following
 * section starts) comes from the caller.
 */
function insertSectionBreak(breakType?: SectionBreakType): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes["sectionBreak"];
    if (!type) return false;

    const { $head } = state.selection;
    if ($head.depth === 0) return false;
    const at = $head.after(1);

    const current = sectionAt(deriveSections(state.doc), $head.pos);
    const settings: SectionSettings = {
      ...(current?.settings ?? DEFAULT_SECTION_SETTINGS),
      breakType: breakType ?? DEFAULT_SECTION_SETTINGS.breakType,
    };

    if (dispatch) {
      dispatch(state.tr.insert(at, type.create({ settings })).scrollIntoView());
    }
    return true;
  };
}

/** Patch one section's settings, whether it is terminated by a break or not. */
function setSectionSettings(sectionId: string, patch: SectionSettingsPatch): Command {
  return (state, dispatch) => {
    const section = findSectionById(deriveSections(state.doc), sectionId);
    if (!section) return false;

    const settings = applySectionSettingsPatch(section.settings, patch);
    if (dispatch) {
      if (section.breakPos === null) {
        dispatch(state.tr.setDocAttribute("finalSection", settings));
      } else {
        const node = state.doc.nodeAt(section.breakPos);
        if (!node) return false;
        dispatch(
          state.tr.setNodeMarkup(section.breakPos, undefined, { ...node.attrs, settings }),
        );
      }
    }
    return true;
  };
}

/**
 * Remove a section's terminating break, merging it into the section that
 * follows.
 *
 * No settings are copied: because a section's settings live on its terminator,
 * deleting the break automatically places the merged content under the NEXT
 * terminator. That is also Word's behavior — text before a deleted break takes
 * on the formatting of the section that followed it — so a raw deletion of the
 * node reaches exactly the same state as this command.
 */
function removeSectionBreak(sectionId: string): Command {
  return (state, dispatch) => {
    const section = findSectionById(deriveSections(state.doc), sectionId);
    if (!section || section.breakPos === null) return false;
    const node = state.doc.nodeAt(section.breakPos);
    if (!node) return false;
    if (dispatch) {
      dispatch(state.tr.delete(section.breakPos, section.breakPos + node.nodeSize));
    }
    return true;
  };
}

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    sections: {
      /** Insert a section break after the current top-level block. */
      insertSectionBreak: (breakType?: SectionBreakType) => ReturnType;
      /** Patch the settings of the section with this id. */
      setSectionSettings: (sectionId: string, patch: SectionSettingsPatch) => ReturnType;
      /** Delete a section's terminating break, merging it forward. */
      removeSectionBreak: (sectionId: string) => ReturnType;
    };
  }
}
