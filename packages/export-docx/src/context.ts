/**
 * DOCX export context + supporting types.
 *
 * DocxContext is the central state object threaded through handlers and
 * lifecycle hooks. It owns styles, numbering, relationships, the document
 * tree, and shared cross-plugin derived data.
 *
 * Handlers are pure tree producers — no mutable cursor. The tree walker
 * composes child XmlNode results into parents.
 */

/** Minimal XML node. Swap for a richer builder when implementation lands. */
export interface XmlNode {
  name: string;
  attributes?: Record<string, string>;
  children?: Array<XmlNode | string>;
}

/** Final DOCX output — maps 1:1 to the OPC ZIP parts. */
export interface DocxPackage {
  document: XmlNode;
  styles: XmlNode;
  numbering: XmlNode;
  relationships: XmlNode;
  contentTypes: XmlNode;
}

export interface DocxStyleSpec {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

export interface DocxNumberingLevel {
  level: number;
  format: "bullet" | "decimal";
  text: string;
}

/**
 * DOCX export context. Threaded through every handler and lifecycle hook.
 *
 * Design rules:
 *   - Handlers return XmlNode trees — no side-effect drawing, no global cursor.
 *   - Styles are split by Word type to prevent invalid OOXML mixing.
 *   - Numbering is declarative; Word's abstractNum/numId are internal.
 *   - ctx.shared uses getOrInit (collaborative append) not set (overwrite).
 */
export interface DocxContext {
  /** Paragraph styles — getOrCreate deduplicates by name. */
  styles: {
    paragraph: { getOrCreate(name: string, spec: DocxStyleSpec): string };
    character: { getOrCreate(name: string, spec: DocxStyleSpec): string };
    table: { getOrCreate(name: string, spec: DocxStyleSpec): string };
  };

  /** Numbering — plugins describe intent, engine maps to Word internals. */
  numbering: {
    getOrCreate(config: {
      type: "bullet" | "ordered" | "task";
      levels: DocxNumberingLevel[];
    }): { numId: number };
  };

  /** OPC relationships — images, hyperlinks, external refs. */
  rels: {
    addImage(bytes: Uint8Array, mime: string): string;
    addHyperlink(url: string): string;
  };

  /** Root document tree (built by the walker, not handlers directly). */
  document: XmlNode;

  /**
   * Shared derived data across plugins (collaborative, not overwrite).
   * Populated in onBeforeExport, read in handlers.
   *
   * Conventions:
   *   "headings"  → HeadingEntry[]
   *   "footnotes" → FootnoteMap
   *   "citations" → CitationMap
   */
  shared: {
    getOrInit<T>(key: string, init: () => T): T;
    get<T>(key: string): T | undefined;
  };
}
