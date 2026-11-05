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
  DocxDiagnostic,
  DocxReport,
  DocxReportCount,
  DocxReportEntry,
  DocxReporter,
  FormatContribution,
} from "@scrivr/core";

/**
 * Who contributed a handler: an extension's `name`, `OVERRIDES_OWNER` for a
 * handler passed in the call's own `overrides`, or `null` for none.
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
   * moved to dropped, filed under that item's owner.
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
}

export function createReportRecorder(options: ReportRecorderOptions = {}): DocxReportRecorder {
  const counts = new Map<string, DocxReportCount>();
  // Identical drops and changes share one entry. A property Word sets once in
  // its document defaults reaches every run, and one line per run would bury
  // every other loss and grow with the document.
  const entries = new Map<string, DocxReportEntry>();
  const frames: Frame[] = [];
  /** Kept counts per open subtree, innermost last, so a lost parent can move them. */
  const keptInSubtree: Array<Map<string, number>> = [];

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
    const open = keptInSubtree[keptInSubtree.length - 1];
    if (open) open.set(kind, (open.get(kind) ?? 0) + count);
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
  const markDecided = (kind: string): void => {
    const frame = innermost();
    if (frame && frame.kind === kind) frame.decided = true;
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
      if (count > 0) markDecided(kind);
    },
    dropped(kind, reason) {
      addEntry("dropped", kind, reason, ownerNow());
      markDecided(kind);
    },
    changed(kind, reason) {
      addEntry("changed", kind, reason, ownerNow());
    },
  };

  return {
    reporter,
    handle(owner, kind, run, produced, ifNothing = HANDLER_RETURNED_NOTHING) {
      const frame: Frame = { owner, kind, decided: false };
      const result = within(frame, run);
      if (!frame.decided) {
        if (produced(result)) addKept(kind, 1);
        else addEntry("dropped", kind, ifNothing, owner);
      }
      return result;
    },
    attribute(owner, run) {
      return within({ owner, kind: null, decided: false }, run);
    },
    async attributeAsync(owner, run) {
      // Hooks run one at a time, each awaited before the next, so the stack
      // stays balanced across the await.
      frames.push({ owner, kind: null, decided: false });
      try {
        return await run();
      } finally {
        frames.pop();
      }
    },
    subtree<T>(run: () => T, lost: (result: T) => LostItem | null): T {
      const kept = new Map<string, number>();
      keptInSubtree.push(kept);
      const result = (() => {
        try {
          return run();
        } finally {
          keptInSubtree.pop();
        }
      })();
      const item = lost(result);
      if (item) {
        for (const [kind, count] of kept) {
          countOf(kind).kept -= count;
          addEntry("dropped", kind, insideDropped(item.kind), item.owner, count);
        }
      } else {
        // Survived this level; an enclosing item can still be lost.
        const parent = keptInSubtree[keptInSubtree.length - 1];
        if (parent) {
          for (const [kind, count] of kept) parent.set(kind, (parent.get(kind) ?? 0) + count);
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

const recorders = new WeakMap<object, DocxReportRecorder>();

/** Bind `recorder` to the context it reports for. Called by the context factories. */
export function bindReportRecorder(context: object, recorder: DocxReportRecorder): void {
  recorders.set(context, recorder);
}

/**
 * The recorder bound to `context`. A context built without the factories gets
 * a detached one: nothing reads its account, but the walk still runs.
 */
export function reportRecorderOf(context: object): DocxReportRecorder {
  let recorder = recorders.get(context);
  if (!recorder) {
    recorder = createReportRecorder();
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
 * its owner together, as the plain `Object.assign` merge did.
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
 * The owner recorded against `key`, or `null` when the table does not say.
 * Own keys only: the key can come from the document (a style id), and
 * `"constructor"` must not answer with `Object`.
 */
export function ownerOf(
  owners: Readonly<Record<string, HandlerOwner>> | undefined,
  key: string,
): HandlerOwner {
  return owners && Object.hasOwn(owners, key) ? (owners[key] ?? null) : null;
}
