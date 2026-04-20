/**
 * HeaderFooter types — policy, definition, slot resolution context.
 *
 * The policy is stored on doc.attrs["headerFooter"] as serializable JSON.
 * It controls which header/footer slots are active and their content.
 */

/** ProseMirror JSON for a mini-document (restricted to header-safe nodes). */
export interface HeaderFooterContent {
  type: "doc";
  content: Record<string, unknown>[];
}

/** A single header or footer slot definition. */
export interface HeaderFooterDefinition {
  content: HeaderFooterContent;
  /** Optional lower bound on reserved height (px). Default 0. */
  minHeight?: number;
  /** Optional upper bound on reserved height (px). Content beyond this clips. */
  maxHeight?: number;
  /**
   * Distance from the page edge to where header content starts (px).
   * Replaces pageConfig.margins.top when a header is present.
   * Default: uses pageConfig.margins.top.
   */
  marginTop?: number;
  /**
   * Distance from the page bottom edge to where footer content starts (px).
   * Replaces pageConfig.margins.bottom when a footer is present.
   * Default: uses pageConfig.margins.bottom.
   */
  marginBottom?: number;
  /** Space between the chrome band and the body content (px). Default 12. */
  margin?: number;
}

/**
 * Full header/footer policy stored on doc.attrs["headerFooter"].
 * null means headers/footers are disabled entirely.
 */
export interface HeaderFooterPolicy {
  enabled: boolean;

  /** Use different header/footer on page 1. */
  differentFirstPage: boolean;
  /** Reserved for v2 — always false in v1. */
  differentOddEven: boolean;

  defaultHeader?: HeaderFooterDefinition;
  defaultFooter?: HeaderFooterDefinition;

  /** Used on page 1 when differentFirstPage is true. */
  firstPageHeader?: HeaderFooterDefinition;
  firstPageFooter?: HeaderFooterDefinition;

  /** Reserved for v2 — unused when differentOddEven is false. */
  evenPageHeader?: HeaderFooterDefinition;
  evenPageFooter?: HeaderFooterDefinition;
}

/** Context for slot resolution — grows a `section` field when sections land. */
export interface SlotContext {
  pageNumber: number;
  /** v2: the section this page belongs to. Currently always undefined. */
  section?: string;
}
