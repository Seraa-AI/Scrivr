/**
 * The recorder behind `ctx.report`, shared by import and export.
 *
 * A handler sees only `DocxReporter` — `kept`, `dropped`, `changed`, with no
 * owner argument, because a handler should not have to know its own
 * extension's name. The converter knows: it holds the recorder, and around
 * every handler and hook it calls it opens a frame naming the extension that
 * contributed it. Whatever the handler reports while the frame is open is
 * filed under that extension.
 *
 * Frames nest. A table handler walks its cells, and a header contribution walks
 * its part, through the same converter, so the innermost frame is always the
 * code that is running.
 *
 * Content is counted as the walk reaches it, which is before its parent's
 * handler has decided whether to keep it. So the walk of each item's content
 * runs in a subtree: if the parent turns out to be lost, everything counted
 * kept inside it is moved to dropped, and the report never claims text that
 * is not in the output.
 *
 * The recorder is bound to its context in a WeakMap rather than exposed on
 * it, so the public context type stays the handler's view.
 */

import type {
  DocxContext,
  DocxDiagnostic,
  DocxImportContext,
  DocxReport,
  DocxReportCount,
  DocxReportEntry,
  DocxReporter,
  FormatContribution,
} from "@scrivr/core";

/**
 * Who contributed a handler: an extension's `name`, `"overrides"` for a
 * handler passed in the call's own `overrides`, or `null` when nothing
 * handled the content.
 */
export type HandlerOwner = string | null;

/** The owner of a handler passed in a call's `overrides` rather than by an extension. */
export const OVERRIDES_OWNER = "overrides";

/** The reason recorded for content no handler claimed. */
export const NO_HANDLER = "no handler";

/** The reason recorded for a Word element the parser has no reading for. */
export const NO_PARSER = "no parser";

/** The reason recorded when a handler took content and gave nothing back. */
export const HANDLER_RETURNED_NOTHING = "handler returned nothing";

/** The reason recorded when a mark's wrapper handed its run back unwrapped. */
export const WRAPPER_DECLINED = "wrapper left the run unwrapped";

/** The reason recorded for content inside an item that was itself lost. */
export function insideDropped(parentKind: string): string {
  return `inside a ${parentKind} that was dropped`;
}

/** The reason recorded when the converter's own fallback needs a node the schema lacks. */
export function noSchemaNode(nodeName: string): string {
  return `the schema has no ${nodeName} node`;
}

/** The item whose content a subtree held, when that item was lost. */
export interface LostItem {
  kind: string;
  owner: HandlerOwner;
}

export interface DocxReportRecorder {
  /** The handler's view, installed as `ctx.report`. */
  readonly reporter: DocxReporter;
  /**
   * Run the handler `owner` contributed for one `kind`. What the handler
   * reports is filed under `owner`. If it reported neither `kept` (of at least
   * one) nor `dropped` for `kind` itself, the outcome is recorded from its
   * result: kept when `produced(result)`, otherwise dropped with `ifNothing`.
   */
  handle<T>(
    owner: HandlerOwner,
    kind: string,
    run: () => T,
    produced: (result: T) => boolean,
    ifNothing?: string,
  ): T;
  /**
   * Run code `owner` contributed that is not handed one item — a lifecycle
   * hook, or a mark handler whose mark another handler accounts for. Only
   * attributes; it records no outcome of its own.
   */
  attribute<T>(owner: HandlerOwner, run: () => T): T;
  /** `attribute` for a hook the converter awaits. The frame stays open until it settles. */
  attributeAsync<T>(owner: HandlerOwner, run: () => T | Promise<T>): Promise<T>;
  /**
   * Run the walk of one item's content together with the item's own handler.
   * When `lost(result)` names the item, everything counted kept inside is
   * moved to dropped, filed under that item's owner — unless the item's
   * handler reported it kept, in which case its account stands.
   */
  subtree<T>(run: () => T, lost: (result: T) => LostItem | null): T;
  /** The converter's own account: one `kind` it carried across with no handler. */
  carried(kind: string): void;
  /** The converter's own account: content nothing handled. Its owner is `null`. */
  unhandled(kind: string, reason: string): void;
  /** The report so far, as plain data the caller owns. */
  snapshot(): DocxReport;
}

export interface ReportRecorderOptions {
  /**
   * Where a handler's misuse of the reporter is warned about. A reporting slip
   * must not cost the user their file, so it is a warning, never a throw.
   */
  warn?: (diagnostic: Omit<DocxDiagnostic, "level">) => void;
}

interface Frame {
  owner: HandlerOwner;
  /** The kind the converter handed over, or `null` when it handed over none. */
  kind: string | null;
  /** The code in this frame reported `kept` or `dropped` for `kind`. */
  decided: boolean;
  /** Of those, it reported `kept`. */
  claimedKept: boolean;
}

/** One open subtree. */
interface SubtreeLevel {
  /** Kept counts inside it, so a lost parent can move them. */
  kept: Map<string, number>;
  /** Kinds whose handler, running at this level, reported them kept. */
  claimedKept: Set<string>;
}

export function createReportRecorder(options: ReportRecorderOptions = {}): DocxReportRecorder {
  const counts = new Map<string, DocxReportCount>();
  // Identical drops and changes share one entry. A property Word sets once in
  // its document defaults reaches every run, and one line per run would bury
  // every other loss and grow with the document.
  const entries = new Map<string, DocxReportEntry>();
  const frames: Frame[] = [];
  /** Open subtrees, innermost last. */
  const subtrees: SubtreeLevel[] = [];

  const countOf = (kind: string): DocxReportCount => {
    let count = counts.get(kind);
    if (!count) {
      count = { kept: 0, dropped: 0, changed: 0 };
      counts.set(kind, count);
    }
    return count;
  };

  const addKept = (kind: string, count: number): void => {
    countOf(kind).kept += count;
    const open = subtrees[subtrees.length - 1];
    if (open) open.kept.set(kind, (open.kept.get(kind) ?? 0) + count);
  };

  const addEntry = (
    outcome: DocxReportEntry["outcome"],
    kind: string,
    reason: string,
    owner: HandlerOwner,
    count = 1,
  ): void => {
    countOf(kind)[outcome] += count;
    const key = JSON.stringify([outcome, kind, reason, owner]);
    const existing = entries.get(key);
    if (existing) existing.count += count;
    else entries.set(key, { outcome, kind, reason, owner, count });
  };

  const innermost = (): Frame | undefined => frames[frames.length - 1];

  /** A handler accounted for the item its frame was handed. */
  const markDecided = (kind: string, kept: boolean): void => {
    const frame = innermost();
    if (frame && frame.kind === kind) {
      frame.decided = true;
      if (kept) frame.claimedKept = true;
    }
  };

  const ownerNow = (): HandlerOwner => innermost()?.owner ?? null;

  const within = <T>(frame: Frame, run: () => T): T => {
    frames.push(frame);
    try {
      return run();
    } finally {
      frames.pop();
    }
  };

  const reporter: DocxReporter = {
    kept(kind, count = 1) {
      if (!Number.isInteger(count) || count < 0) {
        options.warn?.({
          code: "report-invalid-count",
          message:
            `report.kept("${kind}", ${count}) was ignored: a count is a whole ` +
            `number of items, 0 or more`,
        });
        return;
      }
      addKept(kind, count);
      // Keeping none of the item is no account of it.
      if (count > 0) markDecided(kind, true);
    },
    dropped(kind, reason) {
      addEntry("dropped", kind, reason, ownerNow());
      markDecided(kind, false);
    },
    changed(kind, reason) {
      addEntry("changed", kind, reason, ownerNow());
    },
  };

  return {
    reporter,
    handle(owner, kind, run, produced, ifNothing = HANDLER_RETURNED_NOTHING) {
      const frame: Frame = { owner, kind, decided: false, claimedKept: false };
      const result = within(frame, run);
      if (!frame.decided) {
        if (produced(result)) addKept(kind, 1);
        else addEntry("dropped", kind, ifNothing, owner);
      } else if (frame.claimedKept) {
        // A handler can keep an item without returning it here — writing it
        // to another part, say — so its enclosing subtree must not move its
        // content to dropped just because the result is empty.
        subtrees[subtrees.length - 1]?.claimedKept.add(kind);
      }
      return result;
    },
    attribute(owner, run) {
      return within({ owner, kind: null, decided: false, claimedKept: false }, run);
    },
    async attributeAsync(owner, run) {
      // Hooks run one at a time, each awaited before the next, so the stack
      // stays balanced across the await.
      frames.push({ owner, kind: null, decided: false, claimedKept: false });
      try {
        return await run();
      } finally {
        frames.pop();
      }
    },
    subtree<T>(run: () => T, lost: (result: T) => LostItem | null): T {
      const level: SubtreeLevel = { kept: new Map(), claimedKept: new Set() };
      subtrees.push(level);
      const result = (() => {
        try {
          return run();
        } finally {
          subtrees.pop();
        }
      })();
      const item = lost(result);
      if (item && !level.claimedKept.has(item.kind)) {
        for (const [kind, count] of level.kept) {
          countOf(kind).kept -= count;
          addEntry("dropped", kind, insideDropped(item.kind), item.owner, count);
        }
      } else {
        // Survived this level; an enclosing item can still be lost.
        const parent = subtrees[subtrees.length - 1];
        if (parent) {
          for (const [kind, count] of level.kept) {
            parent.kept.set(kind, (parent.kept.get(kind) ?? 0) + count);
          }
        }
      }
      return result;
    },
    carried(kind) {
      addKept(kind, 1);
    },
    unhandled(kind, reason) {
      addEntry("dropped", kind, reason, null);
    },
    snapshot() {
      // `fromEntries` defines own properties, so even a kind named
      // `__proto__` lands as a key rather than as the object's prototype.
      const sorted = Object.fromEntries(
        [...counts.keys()].sort().map((kind) => [kind, { ...countOf(kind) }]),
      );
      return { counts: sorted, entries: [...entries.values()].map((entry) => ({ ...entry })) };
    },
  };
}

type ReportingContext = DocxContext | DocxImportContext;

const recorders = new WeakMap<ReportingContext, DocxReportRecorder>();

/** Bind `recorder` to the context it reports for. Called by the context factories. */
export function bindReportRecorder(context: ReportingContext, recorder: DocxReportRecorder): void {
  recorders.set(context, recorder);
}

/**
 * The recorder bound to `context`. A context built without the factories has
 * none, so it gets a detached one and a warning: the walk still runs, but the
 * converter's account goes nowhere and `ctx.report` hears only the handlers.
 */
export function reportRecorderOf(context: ReportingContext): DocxReportRecorder {
  let recorder = recorders.get(context);
  if (!recorder) {
    const warn = (diagnostic: Omit<DocxDiagnostic, "level">): void =>
      context.diagnostics.warn(diagnostic);
    warn({
      code: "report-unbound",
      message:
        "This context was not made by createDocxContext or createDocxImportContext, " +
        "so the converter's report is not collected",
    });
    recorder = createReportRecorder({ warn });
    recorders.set(context, recorder);
  }
  return recorder;
}

/** A hook with the extension that contributed it, so the report can name it. */
export interface OwnedHook<H> {
  owner: HandlerOwner;
  hook: H;
}

/**
 * One format's bundle from each extension that contributes one, in
 * registration order, then the call's own `overrides` — the order in which
 * later bundles replace earlier handlers.
 */
export function ownedBundles<B>(
  contributions: readonly FormatContribution[],
  pick: (contribution: FormatContribution) => B | undefined,
  overrides: B | undefined,
): Array<{ owner: HandlerOwner; bundle: B }> {
  const bundles: Array<{ owner: HandlerOwner; bundle: B }> = [];
  for (const contribution of contributions) {
    const bundle = pick(contribution);
    if (bundle) bundles.push({ owner: contribution.extension, bundle });
  }
  if (overrides) bundles.push({ owner: OVERRIDES_OWNER, bundle: overrides });
  return bundles;
}

/**
 * Merge one contribution's handlers into a dispatch table, noting `owner`
 * against each key. A later contribution replaces an earlier one's handler and
 * its owner together.
 */
export function assignOwned<H>(
  into: Record<string, H>,
  owners: Record<string, HandlerOwner>,
  source: Readonly<Record<string, H>> | undefined,
  owner: HandlerOwner,
): void {
  if (!source) return;
  for (const [key, handler] of Object.entries(source)) {
    into[key] = handler;
    owners[key] = owner;
  }
}

/**
 * The entry a dispatch table holds for `key`, own keys only. The key can come
 * from the document — a style id, a mark kind — and `"constructor"` must not
 * answer with `Object`, which dispatch would then call as a handler.
 */
export function entryOf<V>(table: Readonly<Record<string, V>> | undefined, key: string): V | undefined {
  return table && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** The owner recorded against `key`, or `null` when the table does not say. */
export function ownerOf(
  owners: Readonly<Record<string, HandlerOwner>> | undefined,
  key: string,
): HandlerOwner {
  return entryOf(owners, key) ?? null;
}
