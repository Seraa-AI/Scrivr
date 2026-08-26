import { Extension } from "../Extension";
import { fnv1aHex, stableStringify } from "../../model/hash";
import { Slice, Fragment, Node } from "prosemirror-model";
import {
	Plugin,
	PluginKey,
	type EditorState,
	type Transaction,
} from "prosemirror-state";
import type { CloneHandler, IEditor } from "../types";
import type {
	NodeActionContext,
	NodeActionContribution,
} from "../../selection/types";
import type { SemanticNodeHandler } from "../../exports/semantic";
import { xml, type DocxNodeHandler, type DocxBlockTransform } from "../../exports/docx";

export type SourceCapability =
	| "update"
	| "detach"
	| "compare"
	| "saveVersion"
	| "reset";

export interface SourceSearchResult<TMeta = unknown> {
	resourceId: string;
	versionId: string;
	label: string;
	meta?: TMeta;
}

export interface SourceContent {
	resourceId: string;
	versionId: string;
	/** A Scrivr fragment as JSON — parsed against the editor's own schema. */
	contentJSON: unknown;
	label: string;
}

export interface SourcedBlockEvent {
	instanceId: string;
	resourceId: string;
	versionId: string;
	kind: string;
}

export interface SourcedBlockChangedEvent extends SourcedBlockEvent {
	modified: boolean;
	outdated: boolean;
}

export interface SourceProvider<TMeta = unknown> {
	kind: string;
	search(
		query: string,
		signal?: AbortSignal,
	): Promise<SourceSearchResult<TMeta>[]>;
	/** Full content for insertion. */
	fetch(resourceId: string, versionId?: string): Promise<SourceContent>;
	/** Called after a block is inserted/created, so the host can index it. */
	registerInstance(event: SourcedBlockEvent): Promise<void>;
	/** Called when divergence state changes. Host persists/indexes as it likes. */
	onInstanceChanged?(event: SourcedBlockChangedEvent): Promise<void>;
	/** Host authority for gating node actions. */
	can?(capability: SourceCapability, resourceId: string): boolean;
}

export const NORMALIZER_VERSION = 1;

/** ECMA-376 caps `w:tag/@w:val` (ST_String) at 255 characters. */
const DOCX_TAG_MAX_LENGTH = 255;

export function normalizeSourcedBlock(fragment: Fragment): unknown[] {
	const walkNode = (node: Node): unknown => {
		// 1. Strip out transient attributes (like nodeId)
		const cleanAttrs = { ...node.attrs };
		if ("nodeId" in cleanAttrs) delete cleanAttrs.nodeId;
		if ("selectionId" in cleanAttrs) delete cleanAttrs.selectionId;

		// 2. Filter out Tracked Changes
		const cleanMarks = node.marks
			.filter(
				mark =>
					mark.type.name !== "trackedInsert" &&
					mark.type.name !== "trackedDelete",
			)
			.map(mark => ({ type: mark.type.name, attrs: mark.attrs }));

		if (node.isText) {
			return {
				type: "text",
				text: node.text,
				...(cleanMarks.length > 0 ? { marks: cleanMarks } : {}),
			};
		}

		// Recursively walk children
		const children: unknown[] = [];
		node.content.forEach(child => children.push(walkNode(child)));

		return {
			type: node.type.name,
			...(Object.keys(cleanAttrs).length > 0
				? { attrs: cleanAttrs }
				: {}),
			...(children.length > 0 ? { content: children } : {}),
			...(cleanMarks.length > 0 ? { marks: cleanMarks } : {}),
		};
	};

	const content: unknown[] = [];
	fragment.forEach(child => content.push(walkNode(child)));
	return content;
}

export function computeBlockHash(fragment: Fragment): string {
	const normalizedJSON = normalizeSourcedBlock(fragment);
	return fnv1aHex(stableStringify(normalizedJSON));
}

/**
 * Which sourced blocks currently differ from the source they were inserted
 * from, keyed by `instanceId`.
 *
 * Identity, not position: an instanceId survives every edit that moves the
 * block, so nothing has to be re-mapped when the document shifts around it.
 * A stale id left behind by a deleted block is inert — lookups go through the
 * live document — and instanceIds are re-minted on paste and clone, so an id
 * never comes back attached to different content.
 */
export interface SourcedBlockDivergenceState {
	diverged: Set<string>;
}

export const sourcedBlockDivergenceKey =
	new PluginKey<SourcedBlockDivergenceState>("sourcedBlockDivergence");

/**
 * True when the block holds nothing but empty text blocks.
 *
 * `textContent` is not enough: it is `""` for a block wrapping only an image,
 * a table or a horizontal rule, and unwrapping those destroys provenance on
 * every unrelated edit in the document.
 */
export function isEmptyShell(node: Node): boolean {
	let empty = true;
	node.forEach(child => {
		if (!child.isTextblock || child.content.size > 0) empty = false;
	});
	return empty;
}

/** Hash the block's current content and compare it against its recorded base. */
function isDiverged(node: Node): boolean {
	return computeBlockHash(node.content) !== node.attrs["baseHash"];
}

function instanceIdOf(node: Node): string | null {
	const id = node.attrs["instanceId"];
	return typeof id === "string" ? id : null;
}

/**
 * Document ranges this transaction touched, in post-transaction coordinates.
 */
function changedRanges(tr: Transaction): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	tr.mapping.maps.forEach((map, i) => {
		const rest = tr.mapping.slice(i + 1);
		map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
			ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
		});
	});
	return ranges;
}

/**
 * Tracks divergence in plugin state, recomputed from the steps of each
 * transaction.
 *
 * Only blocks overlapping a changed range are re-hashed, so the cost is
 * proportional to the edit rather than to the document. It runs synchronously
 * inside `apply` — an earlier draft debounced the hashing behind
 * `Plugin.spec.view`, which never fires here: Scrivr paints to canvas and has
 * no `EditorView`, so the state stayed permanently empty.
 */
export function sourcedBlockDivergencePlugin() {
	return new Plugin({
		key: sourcedBlockDivergenceKey,
		state: {
			init(_config, state: EditorState) {
				const diverged = new Set<string>();
				state.doc.descendants(node => {
					if (node.type.name !== "sourcedBlock") return true;
					const id = instanceIdOf(node);
					if (id && isDiverged(node)) diverged.add(id);
					return false;
				});
				return { diverged };
			},
			apply(tr, value, _oldState, newState) {
				if (!tr.docChanged) return value;

				const diverged = new Set(value.diverged);
				let changed = false;

				for (const [from, to] of changedRanges(tr)) {
					newState.doc.nodesBetween(from, to, node => {
						if (node.type.name !== "sourcedBlock") return true;
						const id = instanceIdOf(node);
						if (!id) return false;

						if (isDiverged(node)) {
							if (!diverged.has(id)) {
								diverged.add(id);
								changed = true;
							}
						} else if (diverged.delete(id)) {
							changed = true;
						}
						return false;
					});
				}

				return changed ? { diverged } : value;
			},
		},
	});
}

/**
 * Re-key sourcedBlock identity during document clone.
 * Ensures a cloned document does not share instanceIds with the original.
 */
const cloneSourcedBlocks: CloneHandler = ({ doc, newId, recordId }) => {
	const walk = (node: Node): Node => {
		if (node.isText) {
			return node;
		}

		let childrenChanged = false;
		const children: Node[] = [];
		node.forEach(child => {
			const newChild = walk(child);
			if (newChild !== child) {
				childrenChanged = true;
			}
			children.push(newChild);
		});

		let newAttrs = node.attrs;
		if (node.type.name === "sourcedBlock") {
			const oldId = newAttrs.instanceId;
			if (typeof oldId === "string" && oldId.length > 0) {
				const replacement = newId("sourcedBlock", oldId);
				recordId("sourcedBlock", oldId, replacement);
				newAttrs = { ...newAttrs, instanceId: replacement };
			}
		}

		if (!childrenChanged && newAttrs === node.attrs) {
			return node;
		}

		return node.type.create(
			newAttrs,
			Fragment.fromArray(children),
			node.marks,
		);
	};

	return walk(doc);
};

export interface SourcedBlockOptions {
	providers?: SourceProvider[];
}

declare module "@scrivr/core" {
	interface Commands<ReturnType> {
		sourcedBlock: {
			insertSourcedBlock: (options: {
				kind: string;
				content: SourceContent;
			}) => ReturnType;
		};
	}
}

export function remintSourcedBlockIdentity(slice: Slice): Slice {
	function flattenFragment(
		fragment: Fragment,
		depth: number,
		openStart: number,
		openEnd: number,
	): Node[] {
		const nodes: Node[] = [];
		fragment.forEach((node, offset, index) => {
			const isOpenStartEdge = index === 0 && depth < openStart;
			const isOpenEndEdge =
				index === fragment.childCount - 1 && depth < openEnd;

			if (node.type.name === "sourcedBlock") {
				if (isOpenStartEdge || isOpenEndEdge) {
					// Partial copy. Unwrap it entirely.
					nodes.push(
						...flattenFragment(
							node.content,
							depth + 1,
							openStart,
							openEnd,
						),
					);
				} else {
					// Full copy. Remint instanceId.
					const newId = `src_pasted_${crypto.randomUUID()}`;
					nodes.push(
						node.type.create(
							{ ...node.attrs, instanceId: newId },
							Fragment.from(
								flattenFragment(
									node.content,
									depth + 1,
									openStart,
									openEnd,
								),
							),
						),
					);
				}
			} else if (node.content.size > 0) {
				nodes.push(
					node.copy(
						Fragment.from(
							flattenFragment(
								node.content,
								depth + 1,
								openStart,
								openEnd,
							),
						),
					),
				);
			} else {
				nodes.push(node);
			}
		});
		return nodes;
	}

	return new Slice(
		Fragment.from(
			flattenFragment(slice.content, 0, slice.openStart, slice.openEnd),
		),
		slice.openStart,
		slice.openEnd,
	);
}

// Reconciler
export interface SourcedBlockRecord {
	instanceId: string | null;
	kind: string | null;
	resourceId: string | null;
	versionId: string | null;
	baseHash: string | null;
	baseNormalizer: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function parseNumberOrNull(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

export function collectSourcedBlocks(doc: Node): SourcedBlockRecord[] {
	const records: SourcedBlockRecord[] = [];

	doc.descendants(node => {
		if (node.type.name !== "sourcedBlock") {
			return true;
		}

		const attrs: unknown = node.attrs;

		if (isRecord(attrs)) {
			records.push({
				instanceId: parseStringOrNull(attrs["instanceId"]),
				kind: parseStringOrNull(attrs["kind"]),
				resourceId: parseStringOrNull(attrs["resourceId"]),
				versionId: parseStringOrNull(attrs["versionId"]),
				baseHash: parseStringOrNull(attrs["baseHash"]),
				baseNormalizer: parseNumberOrNull(attrs["baseNormalizer"]),
			});
		}

		return false;
	});

	return records;
}

export const SourcedBlockExtension = Extension.create<SourcedBlockOptions>({
	name: "sourcedBlock",

	addNodes() {
		return {
			sourcedBlock: {
				content: "block+",
				group: "block",
				defining: true,
				isolating: false,
				// No visual box of its own: the boundary matters to the model, not
				// to the page. Its children lay out into the enclosing flow.
				layout: { kind: "transparent" },
				attrs: {
					instanceId: { default: null },
					kind: { default: null },
					resourceId: { default: null },
					versionId: { default: null },
					baseHash: { default: null },
					baseNormalizer: { default: null },
				},
				parseDOM: [
					{
						tag: "div[data-sourced-block]",
						getAttrs: dom => {
							if (!(dom instanceof HTMLElement)) return false;
							const normalizerAttr = dom.getAttribute(
								"data-base-normalizer",
							);
							return {
								instanceId: dom.getAttribute("data-instance-id"),
								kind: dom.getAttribute("data-kind"),
								resourceId: dom.getAttribute("data-resource-id"),
								versionId: dom.getAttribute("data-version-id"),
								baseHash: dom.getAttribute("data-base-hash"),
								baseNormalizer: normalizerAttr
									? parseInt(normalizerAttr, 10)
									: 1,
							};
						},
					},
				],
				toDOM: node => {
					return [
						"div",
						{
							"data-sourced-block": "true",
							"data-instance-id": node.attrs["instanceId"],
							"data-kind": node.attrs["kind"],
							"data-resource-id": node.attrs["resourceId"],
							"data-version-id": node.attrs["versionId"],
							"data-base-hash": node.attrs["baseHash"],
							"data-base-normalizer":
								node.attrs["baseNormalizer"],
						},
						0,
					];
				},
			},
		};
	},

	addCommands() {
		return {
			insertSourcedBlock:
				(options: { kind: string; content: SourceContent }) =>
				(state, dispatch) => {
					const { kind, content } = options;
					const schema = state.schema;

					try {
						// Assume contentJSON is a Node (e.g. { type: "doc", content: [...] })
						// or at least a block node containing the actual content
						const parsedNode = schema.nodeFromJSON(
							content.contentJSON,
						);
						const fragment = parsedNode.content;

						if (dispatch) {
							const tr = state.tr;
							const instanceId = `src_${crypto.randomUUID()}`;
							const baseHash = computeBlockHash(fragment);

							const blockType = schema.nodes["sourcedBlock"];
							if (!blockType) return false;

							const blockNode = blockType.create(
								{
									instanceId,
									kind,
									resourceId: content.resourceId,
									versionId: content.versionId,
									baseHash,
									baseNormalizer: NORMALIZER_VERSION,
								},
								fragment,
							);

							tr.replaceSelectionWith(blockNode);
							dispatch(tr);

							const providers = this.options.providers ?? [];
							const provider = providers.find(
								p => p.kind === kind,
							);

							if (provider) {
								provider
									.registerInstance({
										instanceId,
										resourceId: content.resourceId,
										versionId: content.versionId,
										kind,
									})
									.catch((error: unknown) => {
										console.error(
											"[SourcedBlock] Failed to register instance:",
											error,
										);
									});
							}
						}

						return true;
					} catch (error: unknown) {
						console.error(
							"[SourcedBlock] Invalid contentJSON provided to insertSourcedBlock",
							error,
						);
						return false;
					}
				},
		};
	},

	onViewReady(editor: IEditor) {
		const unregister = editor.addOverlayRenderHandler(
			(ctx, pageIndex, pageConfig, charMap, theme) => {
				const state = editor.getState();
				const divergenceState =
					sourcedBlockDivergenceKey.getState(state);

				if (!divergenceState || divergenceState.diverged.size === 0)
					return;

				state.doc.descendants((node, pos) => {
					if (node.type.name !== "sourcedBlock") return true;

					const id = instanceIdOf(node);
					if (!id || !divergenceState.diverged.has(id)) return false;

					// coordsAtPos returns { x, y, height, page }
					const startCoords = charMap.coordsAtPos(pos + 1);
					const endCoords = charMap.coordsAtPos(
						pos + node.nodeSize - 2,
					); // end of inner block

					// Ensure both coordinates exist and are on the current page being rendered
					if (
						startCoords &&
						endCoords &&
						(startCoords.page === pageIndex ||
							endCoords.page === pageIndex)
					) {
						ctx.save();
						// Use divergedGutter from theme if available, otherwise amber fallback
						ctx.fillStyle = theme.divergedGutter ?? "#FFC107";

						const gutterWidth = 3;
						const gutterX = startCoords.x - 12;
						const top = startCoords.y;
						const bottom = endCoords.y + endCoords.height;
						const height = bottom - top;

						ctx.fillRect(gutterX, top, gutterWidth, height);
						ctx.restore();
					}
					return false;
				});
			},
		);

		return () => unregister();
	},

	addNodeActions(): NodeActionContribution[] {
		const isTarget = (ctx: NodeActionContext): boolean => {
			return ctx.node !== null && ctx.node.type.name === "sourcedBlock";
		};

		const isModified = (ctx: NodeActionContext): boolean => {
			if (!isTarget(ctx) || !ctx.node) return false;
			const id = instanceIdOf(ctx.node);
			if (!id) return false;
			const state = sourcedBlockDivergenceKey.getState(ctx.state);
			return state?.diverged.has(id) ?? false;
		};

		const getProvider = (
			ctx: NodeActionContext,
		): SourceProvider | undefined => {
			if (!isTarget(ctx) || !ctx.node) return undefined;
			const kind = ctx.node.attrs["kind"];
			if (typeof kind !== "string") return undefined;
			const providers = this.options.providers ?? [];
			return providers.find(p => p.kind === kind);
		};

		const checkPermission = (
			ctx: NodeActionContext,
			capability: SourceCapability,
		): string | false => {
			if (!ctx.node) return "No node selected";
			const resourceId = ctx.node.attrs["resourceId"];
			if (typeof resourceId !== "string") return "Missing resource ID";

			const provider = getProvider(ctx);
			if (!provider) return "No provider registered";
			if (!provider.can) return false;

			return provider.can(capability, resourceId)
				? false
				: "Requires permission";
		};

		return [
			{
				kind: "node",
				actions: [
					{
						id: "source.update",
						label: "Update to Latest",
						group: "source",
						order: 30,
						when: isTarget,
						disabled: ctx => checkPermission(ctx, "update"),
						run: async ctx => {
							const provider = getProvider(ctx);
							const node = ctx.node;
							if (!provider || !node) return;

							const resourceId = node.attrs["resourceId"];
							if (typeof resourceId !== "string") return;

							try {
								const latest = await provider.fetch(resourceId);
								const schema = ctx.editor.schema;
								const parsed = schema.nodeFromJSON(
									latest.contentJSON,
								);

								const tr = ctx.state.tr.replaceWith(
									ctx.pos + 1,
									ctx.pos + node.nodeSize - 1,
									parsed.content,
								);
								ctx.editor.applyTransaction(tr);
							} catch (error: unknown) {
								console.error(
									"[SourcedBlock] Failed to update block:",
									error,
								);
							}
						},
					},
					{
						id: "source.reset",
						label: "Discard Local Edits",
						group: "source",
						order: 40,
						danger: true,
						when: isModified,
						disabled: ctx => checkPermission(ctx, "reset"),
						run: async ctx => {
							const provider = getProvider(ctx);
							const node = ctx.node;
							if (!provider || !node) return;

							const resourceId = node.attrs["resourceId"];
							const versionId = node.attrs["versionId"];
							if (
								typeof resourceId !== "string" ||
								typeof versionId !== "string"
							)
								return;

							try {
								const original = await provider.fetch(
									resourceId,
									versionId,
								);
								const schema = ctx.editor.schema;
								const parsed = schema.nodeFromJSON(
									original.contentJSON,
								);

								const tr = ctx.state.tr.replaceWith(
									ctx.pos + 1,
									ctx.pos + node.nodeSize - 1,
									parsed.content,
								);
								ctx.editor.applyTransaction(tr);
							} catch (error: unknown) {
								console.error(
									"[SourcedBlock] Failed to reset block:",
									error,
								);
							}
						},
					},
					{
						id: "source.detach",
						label: "Detach from Library",
						group: "source",
						order: 50,
						danger: true,
						when: isTarget,
						disabled: ctx => checkPermission(ctx, "detach"),
						run: ctx => {
							const node = ctx.node;
							if (!node) return;

							// Replace the entire block node with just its inner content
							const tr = ctx.state.tr.replaceWith(
								ctx.pos,
								ctx.pos + node.nodeSize,
								node.content,
							);
							ctx.editor.applyTransaction(tr);
						},
					},
				],
			},
		];
	},

	addCloneHandlers() {
		return [cloneSourcedBlocks];
	},

	addPasteTransforms() {
		// A pasted block is a second instance of the same source, not the same
		// instance twice — the host's registry keys on instanceId.
		return [remintSourcedBlockIdentity];
	},

	addProseMirrorPlugins() {
		return [
			sourcedBlockDivergencePlugin(),
			new Plugin({
				key: new PluginKey("sourcedBlockNormalization"),
				appendTransaction(transactions, _oldState, newState) {
					const hasDocChange = transactions.some(tr => tr.docChanged);
					if (!hasDocChange) return null;

					const tr = newState.tr;
					let modified = false;

					// Positions come from `newState.doc`, but each write shifts
					// everything after it — map through the steps accumulated so
					// far before writing, or the second edit lands on a stale
					// range and eats the content next to it.
					const unwrap = (pos: number, node: Node): void => {
						const from = tr.mapping.map(pos);
						const to = tr.mapping.map(pos + node.nodeSize);
						tr.replaceWith(from, to, node.content);
						modified = true;
					};

					newState.doc.descendants((node, pos) => {
						if (node.type.name !== "sourcedBlock") return true;

						// Rule 1: a wrapper holding nothing but empty text blocks
						// is a shell — the user deleted the content, so the
						// provenance goes with it. An image, table or rule is
						// content even though it contributes no `textContent`.
						if (isEmptyShell(node)) {
							unwrap(pos, node);
							return false;
						}

						// Rule 2: No nested sourcedBlocks
						node.forEach((child, offset) => {
							if (child.type.name === "sourcedBlock") {
								unwrap(pos + 1 + offset, child);
							}
						});
						return false;
					});

					if (modified) {
						tr.setStoredMarks(newState.storedMarks);
						return tr;
					}
					return null;
				},
			}),
		];
	},

	addMarkdownParserTokens() {
		return {
			sourcedBlock: { block: "sourcedBlock" },
		};
	},

	addMarkdownSerializerRules() {
		return {
			nodes: {
				sourcedBlock(state, node) {
					state.renderContent(node);
				},
			},
		};
	},

	addExports() {
		const semanticHandler: SemanticNodeHandler = () => ({
			type: "sourcedBlock"
		});

		const docxHandler: DocxNodeHandler = (node, children, ctx) => {
			const attrs = node.attrs;
			const params = new URLSearchParams();

			// Serialize strictly non-empty primitives
			for (const [key, value] of Object.entries(attrs)) {
				if (typeof value === "string" && value) {
					params.set(key, value);
				} else if (typeof value === "number") {
					params.set(key, value.toString());
				}
			}

			const tagValue = `scrivr:sourcedBlock:${params.toString()}`;

			if (tagValue.length > DOCX_TAG_MAX_LENGTH) {
				// `w:tag/@w:val` is ST_String, capped at 255 characters — Word
				// rejects a document that exceeds it. Emit the block without
				// provenance rather than an unopenable file; the content still
				// round-trips, the source link does not.
				ctx.diagnostics.warn({
					code: "sourced-block-tag-too-long",
					nodeType: "sourcedBlock",
					message:
						`Sourced block provenance is ${tagValue.length} characters, over the ` +
						`${DOCX_TAG_MAX_LENGTH}-character OOXML limit for w:tag. The block was ` +
						`exported as plain content, without its source link.`,
				});
				return children;
			}
			// Use the 'kind' attribute as the label for MS Word, fallback to "Sourced Block"
			const aliasValue = typeof attrs["kind"] === "string" && attrs["kind"] ? attrs["kind"] : "Sourced Block";

			return xml("w:sdt", undefined, [
				xml("w:sdtPr", undefined, [
					xml("w:alias", { "w:val": aliasValue }),
					xml("w:tag", { "w:val": tagValue }),
				]),
				xml("w:sdtContent", undefined, children),
			]);
		};

		return {
			semantic: {
				nodes: {
					sourcedBlock: semanticHandler,
				},
			},
			docx: {
				nodes: {
					sourcedBlock: docxHandler,
				},
			},
		};
	},

	addImports() {
		const importer: DocxBlockTransform = (block, content, ctx) => {
			if (block.type !== "sdt" || !block.tag) return null;
			if (!block.tag.startsWith("scrivr:sourcedBlock:")) return null;

			const t = ctx.schema.nodes["sourcedBlock"];
			if (!t) return null;

			const query = block.tag.slice("scrivr:sourcedBlock:".length);
			const params = new URLSearchParams(query);

			const attrs = {
				instanceId: params.get("instanceId") ?? "",
				kind: params.get("kind") ?? "",
				resourceId: params.get("resourceId") ?? "",
				versionId: params.get("versionId") ?? "",
				baseHash: params.get("baseHash") ?? "",
				baseNormalizer: Number(params.get("baseNormalizer")) || 1,
			};

			return t.create(attrs, content);
		};

		return {
			docx: {
				blocks: {
					sdt: importer,
				},
			},
		};
	},
});
