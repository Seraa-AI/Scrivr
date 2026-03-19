import { Extension } from "./Extension";
import { Document } from "./built-in/Document";
import { Paragraph } from "./built-in/Paragraph";
import { Heading } from "./built-in/Heading";
import { Bold } from "./built-in/Bold";
import { Italic } from "./built-in/Italic";
import { History } from "./built-in/History";
import type { Command } from "prosemirror-state";
import type { NodeSpec, MarkSpec } from "prosemirror-model";

interface StarterKitOptions {
  /** Pass false to exclude this extension entirely */
  document?: false;
  paragraph?: false;
  heading?: false | { levels?: number[] };
  bold?: false | { shortcut?: boolean };
  italic?: false | { shortcut?: boolean };
  history?: false | { depth?: number; newGroupDelay?: number };
}

/**
 * StarterKit — batteries-included default for new editors.
 *
 * @example
 * new Editor({ extensions: [StarterKit] })
 * new Editor({ extensions: [StarterKit.configure({ history: false })] })
 * new Editor({ extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })] })
 * new Editor({ extensions: [StarterKit, Highlight, MyImageExtension] })
 */
export const StarterKit = Extension.create<StarterKitOptions>({
  name: "starterKit",

  addNodes() {
    const nodes: Record<string, NodeSpec> = {};
    const opts = this.options;

    if (opts.document !== false) {
      Object.assign(nodes, Document.resolve().nodes);
    }
    if (opts.paragraph !== false) {
      Object.assign(nodes, Paragraph.resolve().nodes);
    }
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object"
        ? Heading.configure(opts.heading)
        : Heading;
      Object.assign(nodes, ext.resolve().nodes);
    }

    return nodes;
  },

  addMarks() {
    const marks: Record<string, MarkSpec> = {};
    const opts = this.options;

    if (opts.bold !== false) {
      Object.assign(marks, Bold.resolve().marks);
    }
    if (opts.italic !== false) {
      Object.assign(marks, Italic.resolve().marks);
    }

    return marks;
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    if (opts.history === false) return [];

    const ext = typeof opts.history === "object"
      ? History.configure(opts.history)
      : History;
    return ext.resolve(this.schema).plugins;
  },

  addKeymap() {
    const km: Record<string, Command> = {};
    const opts = this.options;

    if (opts.paragraph !== false) {
      Object.assign(km, Paragraph.resolve(this.schema).keymap);
    }
    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }
    if (opts.history !== false) {
      const ext = typeof opts.history === "object" ? History.configure(opts.history) : History;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }

    return km;
  },

  addCommands() {
    const cmds: Record<string, (...args: unknown[]) => Command> = {};
    const opts = this.options;

    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.history !== false) {
      const ext = typeof opts.history === "object" ? History.configure(opts.history) : History;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }

    return cmds;
  },
});
