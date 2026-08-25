import { Extension } from "../Extension";
import { fnv1aHex, stableStringify } from "../../model/hash";
import { Slice, Fragment, type Node as PmNode, Node } from "prosemirror-model";
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

interface EditorViewLike {
	state: EditorState;
	dispatch: (tr: Transaction) => void;
}

export const NORMALIZER_VERSION = 1;

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

export interface SourcedBlockDivergenceState {
	modifiedBlocks: Set<number>;
}

export const sourcedBlockDivergenceKey =
	new PluginKey<SourcedBlockDivergenceState>("sourcedBlockDivergence");

export function sourcedBlockDivergencePlugin() {
	return new Plugin({
		key: sourcedBlockDivergenceKey,
		state: {
			init() {
				return { modifiedBlocks: new Set<number>() };
			},
			apply(tr, value) {
				let nextSet = value.modifiedBlocks;
				if (tr.docChanged) {
					nextSet = new Set();
					for (const pos of value.modifiedBlocks) {
						const mapped = tr.mapping.map(pos);
						nextSet.add(mapped);
					}
				}

				const meta = tr.getMeta(sourcedBlockDivergenceKey);
				if (meta && Array.isArray(meta)) {
					const newSet = new Set(nextSet);
					for (const { pos, isModified } of meta) {
						if (isModified) {
							newSet.add(pos);
						} else {
							newSet.delete(pos);
						}
					}
					return { modifiedBlocks: newSet };
				}

				return { modifiedBlocks: nextSet };
			},
		},
		view(view: EditorViewLike) {
			let timeoutId: ReturnType<typeof setTimeout>;

			return {
				update(view: EditorViewLike, prevState: EditorState) {
					const state = view.state;

					if (prevState.doc.eq(state.doc)) return;

					clearTimeout(timeoutId);

					timeoutId = setTimeout(() => {
						const updates: Array<{
							pos: number;
							isModified: boolean;
						}> = [];

						state.doc.descendants((node: Node, pos: number) => {
							if (node.type.name === "sourcedBlock") {
								const currentHash = computeBlockHash(
									node.content,
								);
								const isModified =
									currentHash !== node.attrs["baseHash"];

								const pluginState =
									sourcedBlockDivergenceKey.getState(state);
								const wasModified =
									pluginState?.modifiedBlocks.has(pos) ??
									false;

								if (isModified !== wasModified) {
									updates.push({ pos, isModified });
								}
							}
							return false; // don't descend into sourcedBlock's children
						});

						if (updates.length > 0) {
							view.dispatch(
								state.tr.setMeta(
									sourcedBlockDivergenceKey,
									updates,
								),
							);
						}
					}, 500);
				},

				destroy() {
					clearTimeout(timeoutId);
				},
			};
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
					const newId = `src_pasted_${Math.random().toString(36).substring(2, 11)}`;
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
							const el = dom as HTMLElement;
							const normalizerAttr = el.getAttribute(
								"data-base-normalizer",
							);
							return {
								instanceId: el.getAttribute("data-instance-id"),
								kind: el.getAttribute("data-kind"),
								resourceId: el.getAttribute("data-resource-id"),
								versionId: el.getAttribute("data-version-id"),
								baseHash: el.getAttribute("data-base-hash"),
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
							const instanceId = `src_${Math.random().toString(36).substring(2, 11)}`;
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

				if (
					!divergenceState ||
					divergenceState.modifiedBlocks.size === 0
				)
					return;

				for (const pos of divergenceState.modifiedBlocks) {
					const node = state.doc.nodeAt(pos);
					if (!node || node.type.name !== "sourcedBlock") continue;

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
				}
			},
		);

		return () => unregister();
	},

	addNodeActions(): NodeActionContribution[] {
		const isTarget = (ctx: NodeActionContext): boolean => {
			return ctx.node !== null && ctx.node.type.name === "sourcedBlock";
		};

		const isModified = (ctx: NodeActionContext): boolean => {
			if (!isTarget(ctx)) return false;
			const state = sourcedBlockDivergenceKey.getState(ctx.state);
			return state?.modifiedBlocks.has(ctx.pos) ?? false;
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
						id: "source.view",
						label: "View Source",
						group: "source",
						order: 10,
						when: isTarget,
						run: () => {
							console.log(
								"[SourcedBlock] View source not implemented in headless core",
							);
						},
					},
					{
						id: "source.compare",
						label: "Compare with Source",
						group: "source",
						order: 20,
						when: isModified,
						disabled: ctx => checkPermission(ctx, "compare"),
						run: () => {
							console.log(
								"[SourcedBlock] Compare UI not implemented in headless core",
							);
						},
					},
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

					newState.doc.descendants((node, pos) => {
						if (node.type.name === "sourcedBlock") {
							// Rule 1: Empty wrapper normalization
							if (node.textContent === "") {
								tr.replaceWith(
									pos,
									pos + node.nodeSize,
									node.content,
								);
								modified = true;
								return false;
							}

							// Rule 2: No nested sourcedBlocks
							node.forEach((child, offset) => {
								if (child.type.name === "sourcedBlock") {
									const childPos = pos + 1 + offset;
									tr.replaceWith(
										childPos,
										childPos + child.nodeSize,
										child.content,
									);
									modified = true;
								}
							});
						}
					});

					if (modified) {
						tr.setStoredMarks(newState.storedMarks);
						return tr;
					}
					return null;
				},
				props: {
					transformPasted(slice) {
						return remintSourcedBlockIdentity(slice);
					},
				},
			}),
		];
	},
});
