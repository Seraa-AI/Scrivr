import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Schema } from "prosemirror-model";
import { ExtensionManager } from "../ExtensionManager";
import { StarterKit } from "../StarterKit";
import { SourcedBlockExtension, remintSourcedBlockIdentity } from "./SourcedBlock";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext() {
	const manager = new ExtensionManager([StarterKit, SourcedBlockExtension]);
	const schema = manager.schema;
	const keymap = manager.buildKeymap();
	const state = EditorState.create({
		schema,
		plugins: manager.buildPlugins(),
	});
	return { schema, state, keymap };
}

const mockAttrs = {
	instanceId: "src_123",
	kind: "clause",
	resourceId: "cl_456",
	versionId: "v1",
	baseHash: "abc",
	baseNormalizer: 1,
};

function setupSourcedBlock(schema: Schema, state: EditorState, text = "Hello World") {
	const paragraphType = schema.nodes["paragraph"];
	const sourcedBlockType = schema.nodes["sourcedBlock"];
	
	if (!paragraphType || !sourcedBlockType) {
		throw new Error("Missing schema nodes");
	}

	const para = paragraphType.create(null, schema.text(text));
	const block = sourcedBlockType.create(mockAttrs, para);
	
	return state.apply(state.tr.replaceWith(0, state.doc.content.size, block));
}

function moveTo(state: EditorState, pos: number) {
	return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function pressEnter(state: EditorState, keymap: Record<string, any>) {
	const enterFn = keymap["Enter"];
	if (!enterFn) throw new Error("Enter keymap not found");
	let nextState = state;
	enterFn(state, (tr: any) => { nextState = state.apply(tr); });
	return nextState;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SourcedBlock — schema constraints", () => {
	it("creates a sourcedBlock with the correct attributes", () => {
		const { schema, state } = makeContext();
		const s1 = setupSourcedBlock(schema, state);
		
		const block = s1.doc.child(0);
		expect(block.type.name).toBe("sourcedBlock");
		expect(block.attrs["instanceId"]).toBe("src_123");
		expect(block.attrs["kind"]).toBe("clause");
	});

	it("normalizes a nested sourcedBlock by flattening it", () => {
		const { schema, state } = makeContext();
		const paragraphType = schema.nodes["paragraph"];
		const sourcedBlockType = schema.nodes["sourcedBlock"];
		
		if (!paragraphType || !sourcedBlockType) {
			throw new Error("Missing schema nodes");
		}

		const innerPara = paragraphType.create(null, schema.text("Inner text"));
		const innerSourcedBlock = sourcedBlockType.create(mockAttrs, innerPara);
		
		// Create an outer sourced block containing the inner one
		const outerSourcedBlock = sourcedBlockType.create(mockAttrs, innerSourcedBlock);
		
		// Apply it to the document. The appendTransaction normalizer should flatten it.
		const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, outerSourcedBlock));
		
		// Note: TrailingNode makes childCount 2
		const block = s1.doc.child(0);
		expect(block.type.name).toBe("sourcedBlock");
		
		// And inside there should just be the paragraph, not another sourcedBlock
		expect(block.childCount).toBe(1);
		const innerChild = block.child(0);
		expect(innerChild.type.name).toBe("paragraph");
		expect(innerChild.textContent).toBe("Inner text");
	});
});

describe("SourcedBlock — Enter key behavior (Contiguity Invariant)", () => {
	it("splits the inner paragraph but keeps the wrapper intact", () => {
		const { schema, state, keymap } = makeContext();
		const s1 = setupSourcedBlock(schema, state, "HelloWorld");
		
		// Wrapper starts at 0, para at 1, text starts at 2. "Hello" ends at 7
		const s2 = moveTo(s1, 7);
		const next = pressEnter(s2, keymap);
		
		if (!next) {
			throw new Error("Expected state after Enter");
		}
		
		// Note: StarterKit's TrailingNode adds a trailing paragraph, so childCount is 2.
		const block = next.doc.child(0);
		expect(block.type.name).toBe("sourcedBlock");
		expect(block.childCount).toBe(2);
		
		expect(block.child(0).textContent).toBe("Hello");
		expect(block.child(1).textContent).toBe("World");
	});

	it("keeps the block contiguous when splitting at the very start", () => {
		const { schema, state, keymap } = makeContext();
		const s1 = setupSourcedBlock(schema, state, "HelloWorld");
		
		// Wrapper starts at 0, para at 1. Wait, paragraph text starts at 2
		const s2 = moveTo(s1, 2);
		const next = pressEnter(s2, keymap);
		
		if (!next) {
			throw new Error("Expected state after Enter");
		}
		
		const block = next.doc.child(0);
		expect(block.type.name).toBe("sourcedBlock");
		expect(block.childCount).toBe(2);
		expect(block.child(0).textContent).toBe("");
		expect(block.child(1).textContent).toBe("HelloWorld");
	});
});

describe("SourcedBlock — empty wrapper normalization", () => {
	it("removes the wrapper when all content is deleted via transaction", () => {
		const { schema, state } = makeContext();
		const s1 = setupSourcedBlock(schema, state, "Hello");
		
		// Wrapper starts at 0, para at 1, text at 2, ends at 7
		// Delete the entire text
		const next = s1.apply(s1.tr.delete(2, 7));
		
		// Normalizer should strip the wrapper, leaving just an empty paragraph at the root.
		const firstChild = next.doc.firstChild;
		if (!firstChild) {
			throw new Error("Expected first child");
		}
		expect(firstChild.type.name).toBe("paragraph");
		expect(firstChild.textContent).toBe("");
	});

	it("preserves the wrapper if only some content is deleted", () => {
		const { schema, state } = makeContext();
		const s1 = setupSourcedBlock(schema, state, "Hello World");
		
		// delete "World"
		const next = s1.apply(s1.tr.delete(8, 13));
		
		// Wrapper remains intact
		const firstChild = next.doc.firstChild;
		if (!firstChild) {
			throw new Error("Expected first child");
		}
		expect(firstChild.type.name).toBe("sourcedBlock");
		expect(firstChild.textContent).toBe("Hello ");
	});
});

describe("SourcedBlock — clipboard identity re-minting", () => {
	it("remints the instanceId when a full sourcedBlock is pasted", () => {
		const { schema, state } = makeContext();
		const s1 = setupSourcedBlock(schema, state, "Clause text");
		
		// Extract the block as a slice (simulating a full copy)
		const slice = s1.doc.slice(0, s1.doc.content.size);
		
		const transformedSlice = remintSourcedBlockIdentity(slice);
	
		// The transformed slice should have a NEW instanceId
		const pastedBlock = transformedSlice.content.child(0);
		expect(pastedBlock.type.name).toBe("sourcedBlock");
		expect(pastedBlock.attrs["instanceId"]).not.toBe("src_123"); // Reminted!
		expect(pastedBlock.attrs["resourceId"]).toBe("cl_456"); // Unchanged
		expect(pastedBlock.attrs["versionId"]).toBe("v1"); // Unchanged
	});

	it("strips provenance entirely if only a partial block is pasted", () => {
		const { schema, state } = makeContext();
		const s1 = setupSourcedBlock(schema, state, "Clause text");
		
		// Extract a partial slice (e.g. from inside the text)
		// The wrapper starts at 0, paragraph at 1, text at 2
		const slice = s1.doc.slice(4, 10); // "use te"
		
		const transformedSlice = remintSourcedBlockIdentity(slice);
		
		// If the sourcedBlock was partially opened, it should be stripped
		// Let's verify there is no sourcedBlock in the transformed slice
		transformedSlice.content.descendants(node => {
			expect(node.type.name).not.toBe("sourcedBlock");
		});
	});
});
