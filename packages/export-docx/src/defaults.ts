/**
 * Default OPC package builder.
 *
 * Assembles a valid minimal DOCX from the walked body XML plus the registry
 * contents accumulated on `DocxBuildState`. Feature PRs add handlers; this
 * file owns the static OOXML scaffold (Content_Types, root rels, styles
 * shell, numbering shell, settings, document.xml.rels, and the document
 * root). Nothing here depends on canvas layout.
 *
 * Conventions:
 *   - Internal document rels use stable named IDs (rIdStyles, rIdNumbering,
 *     rIdSettings) so they never collide with user-allocated rId{n} IDs.
 *   - sectPr is US-Letter / 1in margins by default. Feature PRs may swap
 *     this when page-size is wired through `doc.attrs`.
 */

import { xml, serializeXml } from "./xml";
import type { DocxPackage, XmlNode } from "./context";
import type {
  DocxBuildState,
  NumberingEntry,
  RelEntry,
  StyleEntry,
} from "./createContext";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const PKG_CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

const REL_TYPE = {
  officeDocument:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  styles:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  numbering:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  settings:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
  image:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
} as const;

const CONTENT_TYPE = {
  document:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  styles:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  numbering:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  settings:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  relationships:
    "application/vnd.openxmlformats-package.relationships+xml",
  xml: "application/xml",
} as const;

/** Assemble a complete `DocxPackage` from the document root + build state. */
export function buildDocxPackage(
  documentRoot: XmlNode,
  state: DocxBuildState,
): DocxPackage {
  const documentXml = serializeXml(documentRoot, { declaration: true });
  const stylesXml = serializeXml(buildStylesRoot(state.styles), {
    declaration: true,
  });
  const numberingXml = serializeXml(buildNumberingRoot(state.numbering), {
    declaration: true,
  });
  const settingsXml = serializeXml(buildSettingsRoot(), { declaration: true });
  const rootRelsXml = serializeXml(buildRootRelationships(), {
    declaration: true,
  });
  const documentRelsXml = serializeXml(buildDocumentRelationships(state.rels), {
    declaration: true,
  });
  const contentTypesXml = serializeXml(buildContentTypes(state), {
    declaration: true,
  });

  const mediaParts = state.media.map((m) => ({
    path: `word/media/${m.filename}`,
    contentType: m.contentType,
    data: m.data,
  }));

  return {
    parts: [
      { path: "[Content_Types].xml", data: contentTypesXml },
      { path: "_rels/.rels", data: rootRelsXml },
      { path: "word/document.xml", contentType: CONTENT_TYPE.document, data: documentXml },
      { path: "word/_rels/document.xml.rels", data: documentRelsXml },
      { path: "word/styles.xml", contentType: CONTENT_TYPE.styles, data: stylesXml },
      { path: "word/numbering.xml", contentType: CONTENT_TYPE.numbering, data: numberingXml },
      { path: "word/settings.xml", contentType: CONTENT_TYPE.settings, data: settingsXml },
      ...mediaParts,
    ],
  };
}

/**
 * Wrap walked body content in `<w:document><w:body>...<w:sectPr/></w:body></w:document>`.
 * Exported so the pipeline can populate `ctx.document` before
 * `onBuildTreeComplete` fires.
 */
export function buildDocumentRoot(body: XmlNode[]): XmlNode {
  // Word rejects `<w:body><w:sectPr/></w:body>` — every body must contain
  // at least one paragraph. Inject an empty `<w:p/>` if the walk produced
  // nothing so the file remains openable.
  const bodyChildren = body.length > 0 ? body : [xml("w:p")];
  return xml(
    "w:document",
    { "xmlns:w": W_NS, "xmlns:r": R_NS },
    [
      xml("w:body", undefined, [
        ...bodyChildren,
        defaultSectionProperties(),
      ]),
    ],
  );
}

function defaultSectionProperties(): XmlNode {
  // US Letter at 1in margins. 1 inch = 1440 twentieths of a point.
  return xml("w:sectPr", undefined, [
    xml("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
    xml("w:pgMar", {
      "w:top": "1440",
      "w:right": "1440",
      "w:bottom": "1440",
      "w:left": "1440",
      "w:header": "720",
      "w:footer": "720",
      "w:gutter": "0",
    }),
  ]);
}

function buildStylesRoot(styles: StyleEntry[]): XmlNode {
  // Document-wide paragraph defaults — Word reads these when a paragraph
  // doesn't set its own pPr.spacing. 150 twips after = 10px after × 15 twips/px,
  // mirroring Paragraph.ts's `addBlockStyles().paragraph.spaceAfter = 10`
  // (the canvas convention). 276 line ≈ 1.15x line height (Word default).
  const children: XmlNode[] = [
    xml("w:docDefaults", undefined, [
      xml("w:rPrDefault", undefined, [xml("w:rPr")]),
      xml("w:pPrDefault", undefined, [
        xml("w:pPr", undefined, [
          xml("w:spacing", {
            "w:after": "150",
            "w:line": "276",
            "w:lineRule": "auto",
          }),
        ]),
      ]),
    ]),
    xml(
      "w:style",
      { "w:type": "paragraph", "w:styleId": "Normal", "w:default": "1" },
      [xml("w:name", { "w:val": "Normal" })],
    ),
  ];

  for (const entry of styles) {
    children.push(buildStyleElement(entry));
  }

  return xml("w:styles", { "xmlns:w": W_NS }, children);
}

function buildStyleElement(entry: StyleEntry): XmlNode {
  const rPrChildren: XmlNode[] = [];
  if (entry.spec.font) {
    rPrChildren.push(
      xml("w:rFonts", { "w:ascii": entry.spec.font, "w:hAnsi": entry.spec.font }),
    );
  }
  if (entry.spec.bold) rPrChildren.push(xml("w:b"));
  if (entry.spec.italic) rPrChildren.push(xml("w:i"));
  if (entry.spec.underline) rPrChildren.push(xml("w:u", { "w:val": "single" }));
  if (entry.spec.color) {
    rPrChildren.push(xml("w:color", { "w:val": entry.spec.color.replace(/^#/, "") }));
  }
  if (entry.spec.size !== undefined) {
    const halfPoints = Math.round(entry.spec.size * 1.5);
    rPrChildren.push(xml("w:sz", { "w:val": String(halfPoints) }));
  }

  // Paragraph properties — currently spacing only. Headings get this via the
  // default handler; users may set it on their own styles too.
  const pPrChildren: XmlNode[] = [];
  if (
    entry.spec.spacingBefore !== undefined ||
    entry.spec.spacingAfter !== undefined ||
    entry.spec.lineHeight !== undefined
  ) {
    const attrs: Record<string, string> = {};
    if (entry.spec.spacingBefore !== undefined) {
      attrs["w:before"] = String(entry.spec.spacingBefore);
    }
    if (entry.spec.spacingAfter !== undefined) {
      attrs["w:after"] = String(entry.spec.spacingAfter);
    }
    if (entry.spec.lineHeight !== undefined) {
      attrs["w:line"] = String(entry.spec.lineHeight);
      attrs["w:lineRule"] = "auto";
    }
    pPrChildren.push(xml("w:spacing", attrs));
  }

  const children: XmlNode[] = [xml("w:name", { "w:val": entry.name })];
  if (pPrChildren.length > 0) {
    children.push(xml("w:pPr", undefined, pPrChildren));
  }
  if (rPrChildren.length > 0) {
    children.push(xml("w:rPr", undefined, rPrChildren));
  }

  return xml(
    "w:style",
    { "w:type": entry.type, "w:styleId": entry.id },
    children,
  );
}

function buildNumberingRoot(entries: NumberingEntry[]): XmlNode {
  if (entries.length === 0) {
    return xml("w:numbering", { "xmlns:w": W_NS });
  }
  const children: XmlNode[] = [];
  for (const entry of entries) {
    const abstractId = entry.numId; // 1:1 mapping for v1
    children.push(buildAbstractNum(abstractId, entry));
  }
  for (const entry of entries) {
    children.push(
      xml("w:num", { "w:numId": String(entry.numId) }, [
        xml("w:abstractNumId", { "w:val": String(entry.numId) }),
      ]),
    );
  }
  return xml("w:numbering", { "xmlns:w": W_NS }, children);
}

function buildAbstractNum(abstractId: number, entry: NumberingEntry): XmlNode {
  // Word's stock list-numbering defaults: each level gets `w:start="1"`
  // (otherwise ordered lists begin at 0), and `w:pPr/w:ind` so the paragraph
  // is actually indented — without it the bullet/number sits flush at the
  // page margin. Spacing follows Word's own preset: 720 twips per nesting
  // level (1/2 inch) with a 360-twip hanging indent so wrapped text aligns
  // under the first content character, not under the bullet.
  const HANGING_TWIPS = 360;
  const LEVEL_INDENT_TWIPS = 720;

  const levels = entry.config.levels.map((lvl) => {
    const left = (lvl.level + 1) * LEVEL_INDENT_TWIPS;
    return xml("w:lvl", { "w:ilvl": String(lvl.level) }, [
      xml("w:start", { "w:val": "1" }),
      xml("w:numFmt", { "w:val": lvl.format }),
      xml("w:lvlText", { "w:val": lvl.text }),
      xml("w:lvlJc", { "w:val": "left" }),
      xml("w:pPr", undefined, [
        xml("w:ind", {
          "w:left": String(left),
          "w:hanging": String(HANGING_TWIPS),
        }),
      ]),
    ]);
  });
  return xml("w:abstractNum", { "w:abstractNumId": String(abstractId) }, levels);
}

function buildSettingsRoot(): XmlNode {
  return xml("w:settings", { "xmlns:w": W_NS });
}

function buildRootRelationships(): XmlNode {
  return xml("Relationships", { xmlns: PKG_REL_NS }, [
    xml("Relationship", {
      Id: "rIdDocument",
      Type: REL_TYPE.officeDocument,
      Target: "word/document.xml",
    }),
  ]);
}

function buildDocumentRelationships(userRels: RelEntry[]): XmlNode {
  const children: XmlNode[] = [
    xml("Relationship", {
      Id: "rIdStyles",
      Type: REL_TYPE.styles,
      Target: "styles.xml",
    }),
    xml("Relationship", {
      Id: "rIdNumbering",
      Type: REL_TYPE.numbering,
      Target: "numbering.xml",
    }),
    xml("Relationship", {
      Id: "rIdSettings",
      Type: REL_TYPE.settings,
      Target: "settings.xml",
    }),
  ];

  for (const rel of userRels) {
    const attrs: Record<string, string> = {
      Id: rel.id,
      Type: rel.type === "image" ? REL_TYPE.image : REL_TYPE.hyperlink,
      Target: rel.target,
    };
    if (rel.mode) attrs["TargetMode"] = rel.mode;
    children.push(xml("Relationship", attrs));
  }

  return xml("Relationships", { xmlns: PKG_REL_NS }, children);
}

function buildContentTypes(state: DocxBuildState): XmlNode {
  const defaults: XmlNode[] = [
    xml("Default", { Extension: "rels", ContentType: CONTENT_TYPE.relationships }),
    xml("Default", { Extension: "xml", ContentType: CONTENT_TYPE.xml }),
  ];

  const seenExt = new Set<string>(["rels", "xml"]);
  for (const m of state.media) {
    const ext = extensionOf(m.filename);
    if (!ext || seenExt.has(ext)) continue;
    seenExt.add(ext);
    defaults.push(xml("Default", { Extension: ext, ContentType: m.contentType }));
  }

  const overrides: XmlNode[] = [
    xml("Override", {
      PartName: "/word/document.xml",
      ContentType: CONTENT_TYPE.document,
    }),
    xml("Override", {
      PartName: "/word/styles.xml",
      ContentType: CONTENT_TYPE.styles,
    }),
    xml("Override", {
      PartName: "/word/numbering.xml",
      ContentType: CONTENT_TYPE.numbering,
    }),
    xml("Override", {
      PartName: "/word/settings.xml",
      ContentType: CONTENT_TYPE.settings,
    }),
  ];

  return xml("Types", { xmlns: PKG_CT_NS }, [...defaults, ...overrides]);
}

function extensionOf(filename: string): string | null {
  const idx = filename.lastIndexOf(".");
  if (idx < 0 || idx === filename.length - 1) return null;
  return filename.slice(idx + 1).toLowerCase();
}
