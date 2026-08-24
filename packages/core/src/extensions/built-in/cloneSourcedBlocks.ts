import { Fragment, type Node } from "prosemirror-model";
import type { CloneHandler } from "../types";

/**
 * Re-key sourcedBlock identity during document clone.
 * Ensures a cloned document does not share instanceIds with the original.
 */
export const cloneSourcedBlocks: CloneHandler = ({ doc, newId, recordId }) => {
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
