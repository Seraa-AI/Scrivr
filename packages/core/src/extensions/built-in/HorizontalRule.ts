import { Extension } from "../Extension";
import type { PdfNodeHandler } from "../../exports/pdf";
import type { Command } from "prosemirror-state";
import { InputRule } from "prosemirror-inputrules";
import type { BlockStrategy, BlockRenderContext } from "../../layout/BlockRegistry";
import type { CharacterMap } from "../../layout/CharacterMap";
import type { LayoutBlock } from "../../layout/BlockLayout";
import { parseCssColor } from "../../model/cssColor";
import { defaultPdfTheme } from "../../model/theme";
import {
  xml,
  type DocxNodeHandler,
  type DocxBlockTransform,
} from "../../exports/docx";
import type { SemanticNodeHandler } from "../../exports/semantic";

// ── HorizontalRule rendering strategy ────────────────────────────────────────

const HR_THICKNESS = 1.5;

const HorizontalRuleStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx, lineIndexOffset, theme } = renderCtx;
    const midY = block.y + block.height / 2;

    ctx.save();
    ctx.strokeStyle = theme.hrColor;
    ctx.lineWidth = HR_THICKNESS;
    ctx.beginPath();
    ctx.moveTo(block.x, midY);
    ctx.lineTo(block.x + block.availableWidth, midY);
    ctx.stroke();
    ctx.restore();

    // Charmap registration is handled by populateCharMap — nothing to do here.
    return lineIndexOffset + 1;
  },
};

// ── Insert command ────────────────────────────────────────────────────────────

function insertHorizontalRule(): Command {
  return (state, dispatch) => {
    const { $head } = state.selection;
    const hr = state.schema.nodes["horizontalRule"];
    if (!hr) return false;

    // Insert the HR node after the current top-level block
    const after = $head.after(1);
    if (dispatch) {
      const tr = state.tr.insert(after, hr.create()).scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

// ── Extension ─────────────────────────────────────────────────────────────────

/**
 * The colour the export falls back to when the theme names one it cannot read.
 * Parsed from the theme rather than written out again, so there is still one
 * place that decides what a rule looks like.
 */
const FALLBACK_RULE = parseCssColor(defaultPdfTheme.hrColor) ?? {
  r: 0,
  g: 0,
  b: 0,
  alpha: 1,
};

/**
 * A rule is a line down the middle of the box the layout reserved for it —
 * the same geometry and thickness `render` draws on canvas, and now the same
 * source for its colour. A themed export asks for a rule through
 * `theme.hrColor`, so the handler has to read it rather than hold its own.
 */
const horizontalRulePdf: PdfNodeHandler = (block, ctx) => {
  const { r, g, b, alpha } = parseCssColor(ctx.theme.hrColor) ?? FALLBACK_RULE;
  // A fully transparent rule is a rule the theme asked not to see.
  if (alpha === 0) return;
  const y = block.y + block.height / 2;
  ctx.draw.line({
    from: { x: block.x, y },
    to: { x: block.x + block.availableWidth, y },
    thicknessPx: HR_THICKNESS,
    color: { r, g, b },
    ...(alpha < 1 ? { opacity: alpha } : {}),
  });
};

export const HorizontalRule = Extension.create({
  name: "horizontalRule",

  addNodes() {
    return {
      horizontalRule: {
        group: "block",
        attrs: { nodeId: { default: null } },
        parseDOM: [
          {
            tag: "hr",
            getAttrs(dom) {
              const el = dom as HTMLElement;
              return { nodeId: el.getAttribute("data-node-id") ?? null };
            },
          },
        ],
        toDOM(node) {
          const attrs: Record<string, string> = {};
          if (node.attrs.nodeId) attrs["data-node-id"] = node.attrs.nodeId as string;
          return ["hr", attrs];
        },
      },
    };
  },

  addCommands() {
    return {
      insertHorizontalRule: () => insertHorizontalRule(),
    };
  },

  addBlockStyles() {
    return {
      horizontalRule: {
        font: "8px",  // keep block height tight; only the rule line is drawn
        spaceBefore: 24,
        spaceAfter: 24,
        align: "left" as const,
      },
    };
  },

  addLayoutHandlers() {
    return { horizontalRule: HorizontalRuleStrategy };
  },

  addExports() {
    // Word convention: empty paragraph with a single bottom border.
    const handler: DocxNodeHandler = () =>
      xml("w:p", undefined, [
        xml("w:pPr", undefined, [
          xml("w:pBdr", undefined, [
            xml("w:bottom", {
              "w:val": "single",
              "w:sz": "6",
              "w:space": "1",
              "w:color": "auto",
            }),
          ]),
        ]),
      ]);
    const semanticHandler: SemanticNodeHandler = () => ({ type: "horizontalRule" });
    return {
      docx: { nodes: { horizontalRule: handler } },
      semantic: { nodes: { horizontalRule: semanticHandler } },
      pdf: { nodes: { horizontalRule: horizontalRulePdf } },
    };
  },

  addImports() {
    // Stage 1 currently emits `DocxBlock { type: "horizontalRule" }` only
    // for explicit overrides; Word's typical HR (empty paragraph with
    // bottom border) is parsed as a paragraph. Detection from pBdr lands
    // with the structural-fidelity milestone.
    const importer: DocxBlockTransform = (_block, _content, ctx) => {
      const t = ctx.schema.nodes["horizontalRule"];
      return t ? t.create() : null;
    };
    return { docx: { blocks: { horizontalRule: importer } } };
  },

  addToolbarItems() {
    return [
      {
        command: "insertHorizontalRule",
        label: "—",
        title: "Horizontal rule",
        group: "insert",
        isActive: () => false,
      },
    ];
  },

  addMarkdownParserTokens() {
    return { hr: { node: "horizontalRule" } };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        horizontalRule(state, node) {
          state.write("---");
          state.closeBlock(node);
        },
      },
    };
  },

  addMarkdownRules() {
    return [
      {
        // "---" (or more dashes) on its own line → horizontal rule (legacy paste fallback)
        pattern: /^-{3,}$/,
        createNode(_match, schema) {
          return schema.nodes["horizontalRule"]?.create() ?? null;
        },
      },
    ];
  },

  addInputRules() {
    const hr = this.schema.nodes["horizontalRule"];
    const paragraph = this.schema.nodes["paragraph"];
    if (!hr) return [];

    // Typing "--- " (three dashes + space) in an empty paragraph inserts an HR
    return [
      new InputRule(/^---\s$/, (state, _match, start) => {
        const $from = state.doc.resolve(start);
        const blockStart = $from.before($from.depth);
        const blockEnd = $from.after($from.depth);
        const replacement = paragraph
          ? [hr.create(), paragraph.create()]
          : [hr.create()];
        return state.tr.replaceWith(blockStart, blockEnd, replacement);
      }),
    ];
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    horizontalRule: {
      /** Insert a horizontal rule at the cursor. */
      insertHorizontalRule: () => ReturnType;
    };
  }
}
