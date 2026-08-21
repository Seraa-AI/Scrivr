import type { NodeAction, NodeActionContext, NodeActionContribution, ResolvedNodeAction } from "./types";

/**
 * Resolves the `NodeAction`s for a `SelectionDescriptor`.
 * Actions are bucketed by kind at construction and evaluated against the active
 * selection context during render.
 */
export class NodeActionRegistry {
  private buckets = new Map<string, NodeAction[]>();

  constructor(contributions: readonly NodeActionContribution[]) {
    const seenIds = new Set<string>();

    for (const contrib of contributions) {
      let bucket = this.buckets.get(contrib.kind);
      if (!bucket) {
        bucket = [];
        this.buckets.set(contrib.kind, bucket);
      }

      for (const action of contrib.actions) {
        if (seenIds.has(action.id)) {
          throw new Error(`Duplicate NodeAction id: "${action.id}"`);
        }
        seenIds.add(action.id);
        bucket.push(action);
      }
    }
  }

  resolve(ctx: NodeActionContext): ResolvedNodeAction[] {
    const bucket = this.buckets.get(ctx.descriptor.kind) ?? [];
    const resolved: ResolvedNodeAction[] = [];

    for (const action of bucket) {
      if (action.when && !action.when(ctx)) {
        continue;
      }

      const disabledReason = action.disabled ? action.disabled(ctx) : false;

      resolved.push({
        ...action,
        disabledReason,
      });
    }

    return resolved.sort((a, b) => {
      const groupA = a.group ?? "";
      const groupB = b.group ?? "";
      if (groupA !== groupB) return groupA.localeCompare(groupB);

      const orderA = a.order ?? 100;
      const orderB = b.order ?? 100;
      if (orderA !== orderB) return orderA - orderB;

      return a.id.localeCompare(b.id);
    });
  }
}
