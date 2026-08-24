export type SourceCapability = "update" | "detach" | "compare" | "saveVersion" | "reset";

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
  search(query: string, signal?: AbortSignal): Promise<SourceSearchResult<TMeta>[]>;
  /** Full content for insertion. */
  fetch(resourceId: string, versionId?: string): Promise<SourceContent>;
  /** Called after a block is inserted/created, so the host can index it. */
  registerInstance(event: SourcedBlockEvent): Promise<void>;
  /** Called when divergence state changes. Host persists/indexes as it likes. */
  onInstanceChanged?(event: SourcedBlockChangedEvent): Promise<void>;
  /** Host authority for gating node actions. */
  can?(capability: SourceCapability, resourceId: string): boolean;
}
