import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestEditor } from "../../test-utils";
import { defaultPageConfig, type PageConfig } from "../../layout/PageLayout";
import type { Editor } from "../../Editor";
import { StarterKit } from "../StarterKit";
import { SourcedBlockExtension } from "./SourcedBlock";

interface Bar {
	x: number;
	top: number;
	bottom: number;
}

const LONG =
	"The Receiving Party shall keep the Disclosing Party's Confidential Information secret and confidential and use it solely for the Purpose. ";

function divergedBlock(paragraphs: string[]) {
	return {
		type: "sourcedBlock",
		attrs: {
			instanceId: "src_1",
			kind: "clause",
			resourceId: "cl_1",
			versionId: "v1",
			baseHash: "stale",
		},
		content: paragraphs.map(text => ({
			type: "paragraph",
			content: [{ type: "text", text }],
		})),
	};
}

function makeEditor(pageConfig: PageConfig, blocks: unknown[]): Editor {
	return createTestEditor({
		pageConfig,
		extensions: [StarterKit, SourcedBlockExtension],
		content: { type: "doc", content: blocks },
	});
}

/** Paint the overlay for one page and return the gutter bars it drew. */
function barsOnPage(editor: Editor, page: number, pageConfig: PageConfig): Bar[] {
	editor.ensurePagePopulated(page);
	const ctx = document.createElement("canvas").getContext("2d");
	if (!ctx) throw new Error("no 2d context");
	const gutterColor = editor.getResolvedTheme().divergedGutter;
	const bars: Bar[] = [];
	vi.spyOn(ctx, "fillRect").mockImplementation((x, y, _w, h) => {
		if (ctx.fillStyle === gutterColor) {
			bars.push({ x, top: Math.min(y, y + h), bottom: Math.max(y, y + h) });
		}
	});
	editor.runOverlayHandlers(ctx, page, pageConfig);
	return bars;
}

/** Vertical extent of the block's lines on one page, read from the charMap. */
function blockLinesOnPage(editor: Editor, page: number) {
	let from = 0;
	let to = 0;
	editor.getState().doc.forEach((node, offset) => {
		if (node.type.name === "sourcedBlock") {
			from = offset;
			to = offset + node.nodeSize;
		}
	});
	const lines = editor.charMap.linesInRange(from, to).filter(l => l.page === page);
	return {
		top: Math.min(...lines.map(l => l.y)),
		bottom: Math.max(...lines.map(l => l.y + l.height)),
	};
}

describe("SourcedBlock diverged gutter", () => {
	let editor: Editor | null = null;
	afterEach(() => editor?.destroy());

	it("sits in the left margin beside the block, not beside the text before it", () => {
		editor = makeEditor(defaultPageConfig, [
			{ type: "paragraph", content: [{ type: "text", text: "BETWEEN:" }] },
			divergedBlock(["First clause line.", "Second clause paragraph."]),
		]);

		const bars = barsOnPage(editor, 1, defaultPageConfig);
		const lines = blockLinesOnPage(editor, 1);

		expect(bars).toHaveLength(1);
		expect(bars[0]!.x).toBeLessThan(defaultPageConfig.margins.left);
		expect(bars[0]!.top).toBeCloseTo(lines.top);
		expect(bars[0]!.bottom).toBeCloseTo(lines.bottom);
	});

	it("stops at the block's edges when a rule sits on either side", () => {
		const rule = { type: "horizontalRule" };
		editor = makeEditor(defaultPageConfig, [
			{ type: "paragraph", content: [{ type: "text", text: "Before" }] },
			rule,
			divergedBlock(["Only clause line."]),
			rule,
			{ type: "paragraph", content: [{ type: "text", text: "After" }] },
		]);

		const bars = barsOnPage(editor, 1, defaultPageConfig);
		const [ruleAbove, ruleBelow] = editor.layout.pages[0]!.blocks.filter(
			block => block.node.type.name === "horizontalRule",
		);

		expect(bars).toHaveLength(1);
		expect(bars[0]!.top).toBeGreaterThanOrEqual(ruleAbove!.y + ruleAbove!.height);
		expect(bars[0]!.bottom).toBeLessThanOrEqual(ruleBelow!.y);
	});

	it("covers only this page's share of a block that crosses a page boundary", () => {
		const pageConfig: PageConfig = { ...defaultPageConfig, pageHeight: 400 };
		editor = makeEditor(pageConfig, [
			{ type: "paragraph", content: [{ type: "text", text: "BETWEEN:" }] },
			divergedBlock(Array.from({ length: 6 }, () => LONG.repeat(2))),
		]);
		expect(editor.layout.pages.length).toBeGreaterThan(1);

		for (const page of [1, 2]) {
			const bars = barsOnPage(editor, page, pageConfig);
			const lines = blockLinesOnPage(editor, page);
			expect(bars).toHaveLength(1);
			expect(bars[0]!.x).toBeLessThan(pageConfig.margins.left);
			expect(bars[0]!.top).toBeCloseTo(lines.top);
			expect(bars[0]!.bottom).toBeCloseTo(lines.bottom);
		}
	});
});
