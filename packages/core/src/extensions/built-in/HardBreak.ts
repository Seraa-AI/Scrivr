import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";

interface HardBreakOptions {
  /** Set to false to disable the Shift-Enter shortcut. Default: true */
  shortcut: boolean;
}

/**
 * Inserts a hardBreak node at the current selection.
 *
 * Returns `false` if the schema doesn't have a hardBreak — protects against
 * `Editor.configure({ hardBreak: false })` callers that still try to invoke
 * the command via the typed API.
 */
function insertHardBreak(): Command {
  return (state, dispatch) => {
    const hardBreak = state.schema.nodes["hardBreak"];
    if (!hardBreak) return false;
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
    }
    return true;
  };
}

/**
 * HardBreak — the `hardBreak` inline leaf node.
 *
 * Used for soft line breaks (Shift-Enter) inside paragraphs and headings.
 * Renders as `<br>` in HTML; serialises to a markdown backslash break
 * (`text\` + newline) only when followed by non-hardBreak content, so a
 * trailing break doesn't leak a stray escape into the output.
 *
 * Previously bundled inside the `Document` extension. Extracted so it
 * matches the rest of the built-ins (Bold, Heading, HorizontalRule, etc.)
 * — individually importable, individually toggleable from StarterKit, and
 * owns its own keymap binding instead of leaving it parked in BaseEditing.
 *
 * @example
 *   new Editor({ extensions: [Document, Paragraph, HardBreak] });
 *
 *   // disable just the shortcut, keep the node + command:
 *   new Editor({ extensions: [StarterKit.configure({ hardBreak: { shortcut: false } })] });
 *
 *   // drop entirely:
 *   new Editor({ extensions: [StarterKit.configure({ hardBreak: false })] });
 */
export const HardBreak = Extension.create<HardBreakOptions>({
  name: "hardBreak",

  defaultOptions: {
    shortcut: true,
  },

  addNodes() {
    return {
      hardBreak: {
        group: "inline",
        inline: true,
        selectable: false,
        parseDOM: [{ tag: "br" }],
        toDOM: () => ["br"],
      },
    };
  },

  addKeymap() {
    if (!this.options.shortcut) return {};
    return {
      "Shift-Enter": insertHardBreak(),
    };
  },

  addCommands() {
    return {
      insertHardBreak: () => insertHardBreak(),
    };
  },

  addMarkdownParserTokens() {
    // markdown-it emits a `hardbreak` token for an explicit line break
    // (`\` + newline, or two-trailing-spaces + newline). Without this
    // mapping the parser throws "Token type `hardbreak` not supported"
    // on any markdown that contains a hard break, so the missing token
    // had been silently asymmetric — we serialized them but couldn't
    // parse them back in.
    return {
      hardbreak: { node: "hardBreak" },
    };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        // Backslash hard break is CommonMark's canonical form. Only emit
        // when there's non-hardBreak content following — a trailing
        // hardBreak is structural and should not produce a stray escape.
        hardBreak(state, node, parent, index) {
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) {
              state.write("\\\n");
              return;
            }
          }
        },
      },
    };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    hardBreak: {
      /** Insert a hardBreak (`<br>`) node at the cursor. */
      insertHardBreak: () => ReturnType;
    };
  }
}
