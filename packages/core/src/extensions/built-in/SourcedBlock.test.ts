import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import { collectLayoutItems } from "../../layout/PageLayout";
import { defaultFontConfig } from "../../layout/FontConfig";
import { PasteTransformer } from "../../input/PasteTransformer";
import { ExtensionManager } from "../ExtensionManager";
import { Schema, Fragment, type Node as PmNode } from "prosemirror-model";
import { NodeActionRegistry } from "../../selection/NodeActionRegistry";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import {
	SourcedBlockExtension,
	remintSourcedBlockIdentity,
	collectSourcedBlocks,
	sourcedBlockDivergenceKey,
	NORMALIZER_VERSION,
	computeBlockHash,
	normalizeSourcedBlock,
	type SourceProvider,
} from "./SourcedBlock";

describe("SourcedBlock Extension", () => {
	describe("Schema & Parsing", () => {
		function makeContext() {
			const manager = new ExtensionManager([
				StarterKit,
				SourcedBlockExtension,
			]);
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

		function setupSourcedBlock(
			schema: Schema,
			state: EditorState,
			text = "Hello World",
		) {
			const paragraphType = schema.nodes["paragraph"];
			const sourcedBlockType = schema.nodes["sourcedBlock"];

			if (!paragraphType || !sourcedBlockType) {
				throw new Error("Missing schema nodes");
			}

			const para = paragraphType.create(null, schema.text(text));
			const block = sourcedBlockType.create(mockAttrs, para);

			return state.apply(
				state.tr.replaceWith(0, state.doc.content.size, block),
			);
		}

		function moveTo(state: EditorState, pos: number) {
			return state.apply(
				state.tr.setSelection(TextSelection.create(state.doc, pos)),
			);
		}

		function pressEnter(state: EditorState, keymap: Record<string, any>) {
			const enterFn = keymap["Enter"];
			if (!enterFn) throw new Error("Enter keymap not found");
			let nextState = state;
			enterFn(state, (tr: any) => {
				nextState = state.apply(tr);
			});
			return nextState;
		}

		describe("provenance attrs", () => {
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

				const innerPara = paragraphType.create(
					null,
					schema.text("Inner text"),
				);
				const innerSourcedBlock = sourcedBlockType.create(
					mockAttrs,
					innerPara,
				);

				// Create an outer sourced block containing the inner one
				const outerSourcedBlock = sourcedBlockType.create(
					mockAttrs,
					innerSourcedBlock,
				);

				// Apply it to the document. The appendTransaction normalizer should flatten it.
				const s1 = state.apply(
					state.tr.replaceWith(
						0,
						state.doc.content.size,
						outerSourcedBlock,
					),
				);

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

		describe("splitting inside the wrapper", () => {
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

		describe("wrapper removal on delete", () => {
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

		describe("paste identity", () => {
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

		describe("reconciler", () => {
			it("scans a document and returns correctly typed provenance records", () => {
				const { schema, state } = makeContext();
				const s1 = setupSourcedBlock(schema, state, "Clause text");

				const records = collectSourcedBlocks(s1.doc);

				expect(records.length).toBe(1);

				const record = records[0];
				expect(record?.instanceId).toBe("src_123");
				expect(record?.kind).toBe("clause");
				expect(record?.resourceId).toBe("cl_456");
				expect(record?.versionId).toBe("v1");
				expect(record?.baseHash).toBe("abc");
				expect(record?.baseNormalizer).toBe(1);
			});
		});
	});
	describe("Insertion", () => {
		it("inserts a block, hashes content, and triggers registerInstance", () => {
			let registeredInstanceId: string | undefined;

			const mockProvider: SourceProvider = {
				kind: "clause",
				search: async () => [],
				fetch: async () => ({
					resourceId: "",
					versionId: "",
					contentJSON: {},
					label: "",
				}),
				registerInstance: async event => {
					registeredInstanceId = event.instanceId;
				},
			};

			const editor = new ServerEditor({
				extensions: [
					StarterKit,
					SourcedBlockExtension.configure({
						providers: [mockProvider],
					}),
				],
				content: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Original" }],
						},
					],
				},
			});

			const success = editor.commands.insertSourcedBlock({
				kind: "clause",
				content: {
					resourceId: "cl_999",
					versionId: "v1",
					label: "Indemnity",
					contentJSON: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [
									{ type: "text", text: "New Clause" },
								],
							},
						],
					},
				},
			});

			const doc = editor.getState().doc;

			// We expect the original paragraph, and then the new sourcedBlock (since cursor was at start,
			// replacing selection might push it, but actually `replaceSelectionWith` at the start of a doc
			// might insert it before or after depending on selection. Since we didn't focus, selection is at 0.
			// Let's just find the sourcedBlock.
			let block: PmNode | undefined;
			doc.descendants(node => {
				if (node.type.name === "sourcedBlock") {
					block = node;
				}
				return true;
			});

			if (!block) throw new Error("SourcedBlock not found");

			expect(block.type.name).toBe("sourcedBlock");
			expect(block.attrs["resourceId"]).toBe("cl_999");
			expect(typeof block.attrs["baseHash"]).toBe("string");
			expect(typeof block.attrs["instanceId"]).toBe("string");

			// Verify webhook was fired
			expect(registeredInstanceId).toBe(block.attrs["instanceId"]);
		});
	});
	describe("Actions", () => {
		it("registers actions and handles permissions", async () => {
			const mockProvider: SourceProvider = {
				kind: "clause",
				search: async () => [],
				fetch: async () => ({
					resourceId: "cl_1",
					versionId: "v1",
					label: "",
					contentJSON: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [
									{ type: "text", text: "Latest Text" },
								],
							},
						],
					},
				}),
				registerInstance: async () => {},
				can: capability => capability !== "update", // update is forbidden, everything else allowed
			};

			const editor = new ServerEditor({
				extensions: [
					StarterKit,
					SourcedBlockExtension.configure({
						providers: [mockProvider],
					}),
				],
				content: {
					type: "doc",
					content: [
						{
							type: "sourcedBlock",
							attrs: {
								instanceId: "src_1",
								kind: "clause",
								resourceId: "cl_1",
								versionId: "v1",
								baseHash: "original_hash",
								baseNormalizer: NORMALIZER_VERSION,
							},
							content: [
								{
									type: "paragraph",
									content: [
										{
											type: "text",
											text: "Modified Text",
										},
									],
								},
							],
						},
					],
				},
			});

			// Create a NodeActionContext
			const state = editor.getState();
			const doc = state.doc;
			const blockPos = 0; // The sourcedBlock is at position 0
			const blockNode = doc.nodeAt(blockPos)!;
			expect(blockNode.type.name).toBe("sourcedBlock");

			// Set up a NodeSelection
			const tr = editor
				.getState()
				.tr.setSelection(NodeSelection.create(doc, blockPos));
			editor.applyTransaction(tr);

			// Evaluate the registry
			const actionsHook = (
				SourcedBlockExtension as any
			).config.addNodeActions?.call({
				options: { providers: [mockProvider] },
				editor,
				schema: editor.schema,
			} as any);

			expect(actionsHook).toBeDefined();

			const registry = new NodeActionRegistry(actionsHook!);
			const ctx = {
				editor: editor as any,
				state: editor.getState(),
				descriptor: {
					kind: "node",
					surfaceId: "body",
					empty: false,
					capabilities: {} as any,
					anchor: blockPos,
					head: blockPos,
					from: blockPos,
					to: blockPos + blockNode.nodeSize,
				},
				node: blockNode,
				pos: blockPos,
				readOnly: false,
			};

			const resolved = registry.resolve(ctx as any);

			// The block's content no longer hashes to its recorded baseHash, so
			// the divergence-gated "Discard Local Edits" resolves alongside the
			// two unconditional actions, ordered by each action's `order`.
			expect(resolved.map(a => a.id)).toEqual([
				"source.update",
				"source.reset",
				"source.detach",
			]);

			const updateAction = resolved.find(
				a => a.id === "source.update",
			)!;
			expect(updateAction.disabledReason).toBe("Requires permission");

			// Test DETACH
			const detachAction = resolved.find(
				a => a.id === "source.detach",
			)!;
			await detachAction.run(ctx as any);

			const docAfterDetach = editor.getState().doc;
			expect(docAfterDetach.firstChild?.type.name).toBe("paragraph");
			expect(docAfterDetach.firstChild?.textContent).toBe(
				"Modified Text",
			);
		});
	});
	describe("Clone", () => {
		it("re-mints instanceId of sourcedBlocks but preserves provenance", () => {
			const CONTENT = {
				type: "doc",
				content: [
					{
						type: "sourcedBlock",
						attrs: {
							instanceId: "src_original_123",
							kind: "clause",
							resourceId: "cl_456",
							versionId: "v1",
							baseHash: "abc",
							baseNormalizer: 1,
						},
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text: "alpha" }],
							},
						],
					},
				],
			};

			const editor = new ServerEditor({
				extensions: [StarterKit, SourcedBlockExtension],
				content: CONTENT,
				clone: true,
			});

			const doc = editor.getState().doc;
			const block = doc.child(0);

			expect(block.type.name).toBe("sourcedBlock");

			const attrs = block.attrs;
			// The new instanceId should be reminted and recorded in the clone map
			expect(attrs["instanceId"]).not.toBe("src_original_123");
			expect(typeof attrs["instanceId"]).toBe("string");

			// Check that map contains the mapping
			const map = editor.cloneIdMap;
			expect(map).not.toBeNull();
			const newId = map!.getByType(
				"src_original_123",
				"sourcedBlock",
				"custom",
			);
			expect(newId).toBe(attrs["instanceId"]);

			// The other attributes must be preserved exactly
			expect(attrs["kind"]).toBe("clause");
			expect(attrs["resourceId"]).toBe("cl_456");
			expect(attrs["versionId"]).toBe("v1");
			expect(attrs["baseHash"]).toBe("abc");
			expect(attrs["baseNormalizer"]).toBe(1);
		});
	});
	describe("layout", () => {
		function makeContext() {
			const manager = new ExtensionManager([
				StarterKit,
				SourcedBlockExtension,
			]);
			return { schema: manager.schema };
		}

		const attrs = {
			instanceId: "src_layout",
			kind: "clause",
			resourceId: "cl_1",
			versionId: "v1",
			baseHash: "abc",
			baseNormalizer: NORMALIZER_VERSION,
		};

		it("expands the wrapper into one layout item per inner block", () => {
			const { schema } = makeContext();
			const doc = schema.node("doc", null, [
				schema.node("paragraph", null, [schema.text("before")]),
				schema.node("sourcedBlock", attrs, [
					schema.node("paragraph", null, [schema.text("clause one")]),
					schema.node("paragraph", null, [schema.text("clause two")]),
				]),
			]);

			const items = collectLayoutItems(doc, defaultFontConfig);

			// The wrapper itself never reaches layout — its children do, in order.
			expect(items.map(i => i.node.type.name)).toEqual([
				"paragraph",
				"paragraph",
				"paragraph",
			]);
			expect(items.map(i => i.node.textContent)).toEqual([
				"before",
				"clause one",
				"clause two",
			]);
		});

		it("reports inner block positions relative to the document, not the wrapper", () => {
			const { schema } = makeContext();
			const inner = schema.node("paragraph", null, [schema.text("clause")]);
			const doc = schema.node("doc", null, [
				schema.node("paragraph", null, [schema.text("before")]),
				schema.node("sourcedBlock", attrs, [inner]),
			]);

			const items = collectLayoutItems(doc, defaultFontConfig);
			const clauseItem = items[1];

			// "before" paragraph occupies 0..8, wrapper opens at 8, inner at 9.
			expect(clauseItem?.nodePos).toBe(9);
			expect(doc.nodeAt(clauseItem!.nodePos)).toBe(inner);
		});

		it("expands lists nested inside the wrapper", () => {
			const { schema } = makeContext();
			const doc = schema.node("doc", null, [
				schema.node("sourcedBlock", attrs, [
					schema.node("bulletList", null, [
						schema.node("listItem", null, [
							schema.node("paragraph", null, [schema.text("a")]),
						]),
						schema.node("listItem", null, [
							schema.node("paragraph", null, [schema.text("b")]),
						]),
					]),
				]),
			]);

			const items = collectLayoutItems(doc, defaultFontConfig);

			expect(items.map(i => i.listMarker)).toEqual(["•", "•"]);
			expect(items.map(i => i.node.textContent)).toEqual(["a", "b"]);
			for (const item of items) {
				expect(doc.nodeAt(item.nodePos)).toBe(item.node);
			}
		});
	});

	describe("divergence tracking", () => {
		function editorWith(text: string, baseHash: string) {
			return new ServerEditor({
				extensions: [StarterKit, SourcedBlockExtension],
				content: {
					type: "doc",
					content: [
						{
							type: "sourcedBlock",
							attrs: {
								instanceId: "src_1",
								kind: "clause",
								resourceId: "cl_1",
								versionId: "v1",
								baseHash,
								baseNormalizer: NORMALIZER_VERSION,
							},
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text }],
								},
							],
						},
					],
				},
			});
		}

		function divergedIds(editor: ServerEditor): string[] {
			const state = sourcedBlockDivergenceKey.getState(editor.getState());
			return [...(state?.diverged ?? [])];
		}

		function hashOf(editor: ServerEditor): string {
			const block = editor.getState().doc.child(0);
			return computeBlockHash(block.content);
		}

		it("marks a block whose content no longer matches its baseHash", () => {
			const editor = editorWith("Clause text", "stale_hash");
			expect(divergedIds(editor)).toEqual(["src_1"]);
		});

		it("leaves an untouched block clean", () => {
			const pristine = editorWith("Clause text", "placeholder");
			const editor = editorWith("Clause text", hashOf(pristine));
			expect(divergedIds(editor)).toEqual([]);
		});

		it("diverges on edit and clears again when the edit is reverted", () => {
			const pristine = editorWith("Clause text", "placeholder");
			const baseHash = hashOf(pristine);
			const editor = editorWith("Clause text", baseHash);
			expect(divergedIds(editor)).toEqual([]);

			// Type a character inside the block — no timers, no view: the state
			// is recomputed from this transaction's steps.
			const insert = editor.getState().tr.insertText("!", 12);
			editor.applyTransaction(insert);
			expect(divergedIds(editor)).toEqual(["src_1"]);

			const revert = editor.getState().tr.delete(12, 13);
			editor.applyTransaction(revert);
			expect(divergedIds(editor)).toEqual([]);
		});
	});

	describe("empty-shell normalization", () => {
		function editorWithContent(content: unknown[]) {
			return new ServerEditor({
				extensions: [StarterKit, SourcedBlockExtension],
				content: { type: "doc", content },
			});
		}

		function sourcedBlockNode(inner: unknown[], instanceId = "src_1") {
			return {
				type: "sourcedBlock",
				attrs: {
					instanceId,
					kind: "clause",
					resourceId: "cl_1",
					versionId: "v1",
					baseHash: "abc",
					baseNormalizer: NORMALIZER_VERSION,
				},
				content: inner,
			};
		}

		it("keeps a wrapper whose content carries no text", () => {
			const editor = editorWithContent([
				sourcedBlockNode([{ type: "horizontalRule" }]),
				{
					type: "paragraph",
					content: [{ type: "text", text: "elsewhere" }],
				},
			]);

			// A rule contributes no textContent — editing an unrelated
			// paragraph must not strip the block's provenance.
			const doc = editor.getState().doc;
			const tr = editor.getState().tr.insertText("x", doc.content.size - 2);
			editor.applyTransaction(tr);

			expect(editor.getState().doc.child(0).type.name).toBe("sourcedBlock");
		});

		it("keeps a wrapper holding an image-only paragraph", () => {
			const editor = editorWithContent([
				sourcedBlockNode([
					{
						type: "paragraph",
						content: [
							{
								type: "image",
								attrs: {
									src: "data:image/png;base64,iVBORw0KGgo=",
								},
							},
						],
					},
				]),
			]);

			const tr = editor.getState().tr.insertText("x", 1);
			editor.applyTransaction(tr);

			expect(editor.getState().doc.child(0).type.name).toBe("sourcedBlock");
		});

		it("unwraps two empty shells in one pass without disturbing what follows", () => {
			const editor = editorWithContent([
				sourcedBlockNode(
					[{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
					"src_1",
				),
				sourcedBlockNode(
					[{ type: "paragraph", content: [{ type: "text", text: "b" }] }],
					"src_2",
				),
				{ type: "paragraph", content: [{ type: "text", text: "tail" }] },
			]);

			// Empty both blocks in a single transaction. Positions come from the
			// pre-write document, so the second unwrap has to be mapped through
			// the first or it eats the paragraph after it.
			const tr = editor.getState().tr;
			tr.delete(7, 8); // "b"
			tr.delete(2, 3); // "a"
			editor.applyTransaction(tr);

			const doc = editor.getState().doc;
			const kinds: string[] = [];
			doc.forEach(node => kinds.push(node.type.name));
			expect(kinds.slice(0, 3)).toEqual([
				"paragraph",
				"paragraph",
				"paragraph",
			]);
			expect(doc.child(0).textContent).toBe("");
			expect(doc.child(1).textContent).toBe("");
			expect(doc.child(2).textContent).toBe("tail");
		});
	});

	describe("paste seam", () => {
		it("re-mints identity through PasteTransformer, whatever the clipboard flavour", () => {
			const manager = new ExtensionManager([
				StarterKit,
				SourcedBlockExtension,
			]);
			const schema = manager.schema;
			const state = EditorState.create({
				schema,
				plugins: manager.buildPlugins(),
			});

			const transformer = new PasteTransformer(
				schema,
				manager.buildMarkdownRules(),
				manager.buildMarkdownParserTokens(),
				manager.buildPasteTransforms(),
			);

			const clipboard = new DataTransfer();
			clipboard.setData(
				"text/html",
				'<div data-sourced-block data-instance-id="src_original" ' +
					'data-kind="clause" data-resource-id="cl_1" data-version-id="v1" ' +
					'data-base-hash="abc" data-base-normalizer="1">' +
					"<p>Clause text</p></div>",
			);

			const tr = transformer.transform(clipboard, state);
			expect(tr).not.toBeNull();

			const pasted = state.apply(tr!).doc.child(0);
			expect(pasted.type.name).toBe("sourcedBlock");
			// Two live instances of one clause must not share an instanceId.
			expect(pasted.attrs["instanceId"]).not.toBe("src_original");
			expect(pasted.attrs["resourceId"]).toBe("cl_1");
			expect(pasted.attrs["versionId"]).toBe("v1");
		});
	});

	describe("Hashing", () => {
		const schema = new Schema({
			nodes: {
				doc: { content: "block+" },
				paragraph: {
					content: "inline*",
					group: "block",
					attrs: { nodeId: { default: null } },
					parseDOM: [{ tag: "p" }],
					toDOM: () => ["p", 0],
				},
				text: { group: "inline" },
			},
			marks: {
				strong: {
					parseDOM: [{ tag: "strong" }],
					toDOM: () => ["strong", 0],
				},
				trackedInsert: {
					attrs: { id: { default: null } },
					parseDOM: [{ tag: "ins" }],
					toDOM: () => ["ins", 0],
				},
			},
		});

		it("normalizer strips nodeId and trackedInsert marks", () => {
			const p = schema.nodes.paragraph.create(
				{ nodeId: "should_be_stripped" },
				[
					schema.text("Hello ", [
						schema.marks.trackedInsert.create({ id: "trk_1" }),
					]),
					schema.text("World", [schema.marks.strong.create()]),
				],
			);
			const fragment = Fragment.from(p);

			const normalized = normalizeSourcedBlock(fragment);

			expect(normalized).toEqual([
				{
					type: "paragraph",
					// Notice nodeId is gone
					content: [
						{
							type: "text",
							text: "Hello ",
							// trackedInsert mark is gone
						},
						{
							type: "text",
							text: "World",
							marks: [{ type: "strong", attrs: {} }],
						},
					],
				},
			]);
		});

		it("produces identical hashes for fragments that differ only in transient state", () => {
			const p1 = schema.nodes.paragraph.create(
				{ nodeId: "id_1" },
				schema.text("Hello"),
			);
			const p2 = schema.nodes.paragraph.create(
				{ nodeId: "id_2" },
				schema.text("Hello", [
					schema.marks.trackedInsert.create({ id: "trk_2" }),
				]),
			);

			const hash1 = computeBlockHash(Fragment.from(p1));
			const hash2 = computeBlockHash(Fragment.from(p2));

			expect(hash1).toBe(hash2);
		});

		it("produces different hashes for semantic changes", () => {
			const p1 = schema.nodes.paragraph.create(
				{},
				schema.text("Hello"),
			);
			const p2 = schema.nodes.paragraph.create(
				{},
				schema.text("Hello World"),
			);
			const p3 = schema.nodes.paragraph.create(
				{},
				schema.text("Hello", [schema.marks.strong.create()]),
			);

			const h1 = computeBlockHash(Fragment.from(p1));
			const h2 = computeBlockHash(Fragment.from(p2));
			const h3 = computeBlockHash(Fragment.from(p3));

			expect(h1).not.toBe(h2);
			expect(h1).not.toBe(h3);
			expect(h2).not.toBe(h3);
		});
	});
});
