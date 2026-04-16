/**
 * augmentations.ts
 *
 * Module augmentation declarations for all built-in extensions.
 * Imported by StarterKit so everything resolves when consumers use StarterKit.
 *
 * Each built-in extension augments the `Commands`, `NodeAttributes`,
 * and/or `MarkAttributes` interfaces so that `editor.commands.*` is
 * fully typed.
 */

export {};

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    bold: {
      /** Toggle the bold mark on the selection. */
      toggleBold: () => ReturnType;
    };
    italic: {
      /** Toggle the italic mark on the selection. */
      toggleItalic: () => ReturnType;
    };
    underline: {
      /** Toggle the underline mark on the selection. */
      toggleUnderline: () => ReturnType;
    };
    strikethrough: {
      /** Toggle the strikethrough mark on the selection. */
      toggleStrikethrough: () => ReturnType;
    };
    history: {
      /** Undo the last change. */
      undo: () => ReturnType;
      /** Redo the last undone change. */
      redo: () => ReturnType;
    };
    heading: {
      /** Set the current block to heading level 1. */
      setHeading1: () => ReturnType;
      /** Set the current block to heading level 2. */
      setHeading2: () => ReturnType;
      /** Set the current block to heading level 3. */
      setHeading3: () => ReturnType;
      /** Set the current block to heading level 4. */
      setHeading4: () => ReturnType;
      /** Set the current block to heading level 5. */
      setHeading5: () => ReturnType;
      /** Set the current block to heading level 6. */
      setHeading6: () => ReturnType;
      /** Set the current block to a plain paragraph. */
      setParagraph: () => ReturnType;
    };
    list: {
      /** Toggle a bullet list at the current block. */
      toggleBulletList: () => ReturnType;
      /** Toggle an ordered list at the current block. */
      toggleOrderedList: () => ReturnType;
      /** Lift a list item out of its list. */
      liftListItem: () => ReturnType;
      /** Sink a list item into a nested list. */
      sinkListItem: () => ReturnType;
    };
    alignment: {
      /** Left-align the current block. */
      setAlignLeft: () => ReturnType;
      /** Center-align the current block. */
      setAlignCenter: () => ReturnType;
      /** Right-align the current block. */
      setAlignRight: () => ReturnType;
      /** Justify the current block. */
      setAlignJustify: () => ReturnType;
    };
    color: {
      /** Apply a text color to the selection. */
      setColor: (color: string) => ReturnType;
      /** Remove the text color mark from the selection. */
      unsetColor: () => ReturnType;
    };
    fontSize: {
      /** Set the font size (in px) for the selection. */
      setFontSize: (size: number) => ReturnType;
      /** Remove the font size mark from the selection. */
      unsetFontSize: () => ReturnType;
    };
    fontFamily: {
      /** Apply a font family to the current block(s). */
      setFontFamily: (family: string) => ReturnType;
      /** Remove the font family override from the current block(s). */
      unsetFontFamily: () => ReturnType;
    };
    highlight: {
      /** Toggle a highlight mark on the selection. */
      toggleHighlight: (color?: string) => ReturnType;
    };
    link: {
      /** Prompt for a URL and apply a link mark to the selection. */
      setLink: () => ReturnType;
      /** Update the href of an existing link at [from, to]. */
      setLinkHref: (from: number, to: number, href: string) => ReturnType;
      /** Remove the link mark from the selection. */
      unsetLink: () => ReturnType;
    };
    image: {
      /** Open the system file picker and insert an image at the cursor. */
      insertImage: () => ReturnType;
    };
    codeBlock: {
      /** Toggle a code block at the current block. */
      toggleCodeBlock: () => ReturnType;
    };
    horizontalRule: {
      /** Insert a horizontal rule at the cursor. */
      insertHorizontalRule: () => ReturnType;
    };
    clearFormatting: {
      /** Remove all marks and reset block formatting in the selection. */
      clearFormatting: () => ReturnType;
    };
  }

  interface NodeAttributes {
    heading: {
      /** Heading level 1–6. */
      level: number;
      /** Text alignment override. */
      align?: "left" | "center" | "right" | "justify";
      /** Font family override. */
      fontFamily?: string | null;
    };
    paragraph: {
      /** Text alignment override. */
      align?: "left" | "center" | "right" | "justify";
      /** Font family override. */
      fontFamily?: string | null;
    };
    bullet_list: {
      /** Node ID assigned by UniqueId extension. */
      id?: string;
    };
    ordered_list: {
      /** Node ID assigned by UniqueId extension. */
      id?: string;
      /** Starting number for the ordered list. */
      order?: number;
    };
  }

  interface MarkAttributes {
    color: {
      /** CSS color string e.g. "#dc2626" */
      color: string;
    };
    fontSize: {
      /** Font size in px */
      size: number;
    };
    fontFamily: {
      /** Font family string e.g. "Georgia" */
      family: string;
    };
    highlight: {
      /** Highlight color — only used in multicolor mode */
      color?: string;
    };
    link: {
      /** The link href URL */
      href: string;
      /** Optional link title */
      title?: string;
    };
  }
}
