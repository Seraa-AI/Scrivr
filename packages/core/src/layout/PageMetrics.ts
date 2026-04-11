/**
 * Per-page layout metrics.
 *
 * This module is Phase 0 of the multi-surface architecture refactor (see
 * `docs/weekend-plan-2026-04-12.md` §PR 1 and `docs/header-footer-plan.md` §3).
 * It introduces the primitives that let future iterative-chrome contributors
 * (headers, footers, footnotes) reserve per-page vertical space without
 * scattering `pageHeight - margins.bottom` arithmetic across `runPipeline`,
 * `paginateFlow`, and `applyFloatLayout`.
 *
 * Design note: per-page metrics (`PageMetrics` carries `pageNumber`, not a
 * constant shared across pages) is deliberate from day one. `differentFirstPage`
 * headers reserve different heights on page 1 vs. the rest; footnotes reserve
 * different heights per page based on which refs anchor there. Collapsing to
 * a single `PageMetrics` per run and flipping to per-page later would ship a
 * visible "page 2+ has empty space" bug. See `docs/header-footer-plan.md` §3
 * for the rationale in detail.
 *
 * In this PR (Phase 0), the only contributor is an empty `ResolvedChrome`
 * (no registered `ChromeContribution`s), so `computePageMetrics` produces
 * values identical to the current hand-computed formula for every page. All
 * existing layout tests pass unchanged. Later PRs (Phase 1b, the header-
 * footer plugin, footnotes) fill in real contributors without touching this
 * file's interface.
 */

import type { PageConfig } from "./PageLayout";

/**
 * Geometry for a single page, computed from `PageConfig` + the sum of all
 * chrome contributions for that specific page. Pure data — no methods, no
 * closures. Safe to cache, compare, and serialize.
 *
 * Consumed by `runPipeline`, `paginateFlow`, and `applyFloatLayout` instead
 * of raw `pageConfig.pageHeight - margins.bottom` arithmetic. The per-page
 * shape is load-bearing: `differentFirstPage` headers and footnotes both
 * produce metrics that vary by page number.
 */
export interface PageMetrics {
  /** 1-based page number this bundle applies to. */
  pageNumber: number;
  /** Y of the top of flow content = margins.top + headerHeight for this page. */
  contentTop: number;
  /**
   * Y of the bottom of flow content =
   *   pageHeight - margins.bottom - footerHeight for this page.
   */
  contentBottom: number;
  /** contentBottom - contentTop. Available vertical space for flow on this page. */
  contentHeight: number;
  /**
   * pageWidth - margins.left - margins.right.
   * Constant across pages for v1 (columns not yet implemented). Included here
   * so downstream code can read everything page-related through one bundle.
   */
  contentWidth: number;
  /** Y of the top of the header band (always equal to margins.top). */
  headerTop: number;
  /**
   * Y of the top of the footer band for this page =
   *   pageHeight - margins.bottom - footerHeight.
   */
  footerTop: number;
  /**
   * Resolved header height for this page. 0 when no chrome contributor
   * reserves top space (which is the case throughout Phase 0 — this PR
   * ships with an empty `ResolvedChrome`).
   */
  headerHeight: number;
  /**
   * Resolved footer height for this page. 0 when no chrome contributor
   * reserves bottom space.
   */
  footerHeight: number;
}

/**
 * One chrome contribution (typically one plugin's worth of header / footer /
 * footnote band / margin-notes gutter / etc.). Each contributor exposes
 * per-page top and bottom reservations plus an opaque `payload` that the
 * core never inspects — it just routes the payload back to the contributor
 * at paint time.
 *
 * See `docs/multi-surface-architecture.md` §3.4 for the full iterative-chrome
 * lifecycle. In Phase 0 this shape is inert — no contributors exist yet, so
 * `ResolvedChrome.contributions` is always empty and none of these methods
 * are ever called. The shape is declared here anyway so Phase 1b can wire
 * real contributors without changing the type surface.
 */
export interface ChromeContribution {
  /** Reserved vertical space at the top of page `pageNumber` (px). */
  topForPage(pageNumber: number): number;
  /** Reserved vertical space at the bottom of page `pageNumber` (px). */
  bottomForPage(pageNumber: number): number;
  /**
   * Opaque per-contributor state. Carried through `DocumentLayout._chromePayloads`
   * and handed back to the contributor at paint time. Core never inspects it.
   */
  payload?: unknown;
  /**
   * True when this contributor has reached a fixed point for its own inputs.
   * Non-iterative contributors (headers, footers) return `true` on iteration 1;
   * iterative contributors (footnotes) return `true` only when their internal
   * assignment has stabilized. The aggregator loop in Phase 1b exits when
   * every contributor reports `stable`.
   *
   * Phase 0 doesn't use this (no contributors, no iteration) but we define
   * it here so the type is complete and Phase 1b can consume it without a
   * shape change.
   */
  stable: boolean;
  /**
   * Number of synthetic pages this contributor needs appended after the
   * flow's last natural page. Used for chrome-only overflow (e.g. footnote
   * end-of-doc spill per `docs/multi-surface-architecture.md` §8.7.6).
   * Zero for contributors that never overflow.
   */
  syntheticPages?: number;
}

/**
 * All chrome contributions for a single layout run, plus a version hash.
 *
 * `contributions` is keyed by contributor name (e.g. `"headerFooter"`,
 * `"footnotes"`) — same name the plugin uses in its `addPageChrome()`
 * registration. `metricsVersion` is a stable hash of the resolved state
 * used by `Phase 1b` early termination to invalidate cross-run caches
 * when the chrome shape changes.
 *
 * In Phase 0, `contributions` is always the empty record `{}` (no plugins
 * contributing yet), and `metricsVersion` is always 0.
 */
export interface ResolvedChrome {
  contributions: Record<string, ChromeContribution>;
  /**
   * Monotonic identity hash. Any change to any contributor's contribution
   * bumps this. `metricsVersion === 0` is reserved for "no contributors"
   * (Phase 0). Subsequent PRs compute it as a djb2-style hash over every
   * contributor's stable identity.
   */
  metricsVersion: number;
}

/**
 * Pure function. Given a `PageConfig` and a `ResolvedChrome`, produce the
 * `PageMetrics` for one specific page. No caching — callers that hit this
 * repeatedly should memoize at the call site (see `paginateFlow`'s 1-entry
 * `metricsFor` helper added in PR 1.3).
 *
 * Phase 0 behavior: when `resolved.contributions` is empty, the returned
 * metrics match the current hand-computed formula on every page:
 *
 *   contentTop    = margins.top
 *   contentBottom = pageHeight - margins.bottom
 *   contentHeight = contentBottom - contentTop
 *   contentWidth  = pageWidth - margins.left - margins.right
 *   headerHeight  = 0
 *   footerHeight  = 0
 *
 * With real contributors (Phase 1b+), `headerHeight` and `footerHeight` sum
 * over every contributor's `topForPage(pageNumber)` / `bottomForPage(pageNumber)`
 * result.
 *
 * Pageless mode: `config.pageless === true` zeros out the footer reservation
 * (the layout never ends on a specific bottom). Headers still reserve the
 * top of the virtual canvas, but in practice no chrome contributor runs in
 * pageless mode (the header-footer plugin short-circuits on `pageless`).
 */
export function computePageMetrics(
  config: PageConfig,
  resolved: ResolvedChrome,
  pageNumber: number,
): PageMetrics {
  const { pageWidth, pageHeight, margins } = config;

  let headerHeight = 0;
  let footerHeight = 0;

  for (const contribution of Object.values(resolved.contributions)) {
    headerHeight += contribution.topForPage(pageNumber);
    // Pageless mode has no meaningful footer position — the flow grows
    // unbounded. Skip bottom reservations so callers don't clamp against
    // a nonsense `contentBottom`.
    if (!config.pageless) {
      footerHeight += contribution.bottomForPage(pageNumber);
    }
  }

  const contentTop = margins.top + headerHeight;
  // In pageless mode, `contentBottom` is unused (overflow is disabled) but
  // we still return a finite number rather than Infinity so callers that
  // print debug metrics don't get surprising output.
  const contentBottom = config.pageless
    ? pageHeight // effectively 0 + 0, see defaultPagelessConfig
    : pageHeight - margins.bottom - footerHeight;
  const contentHeight = contentBottom - contentTop;
  const contentWidth = pageWidth - margins.left - margins.right;

  return {
    pageNumber,
    contentTop,
    contentBottom,
    contentHeight,
    contentWidth,
    headerTop: margins.top,
    footerTop: pageHeight - margins.bottom - footerHeight,
    headerHeight,
    footerHeight,
  };
}

/**
 * Constant for the empty / Phase 0 state — no contributors, metricsVersion 0.
 * Exported so `runPipeline` and tests can reach for a stable reference
 * without constructing a fresh object every call.
 */
export const EMPTY_RESOLVED_CHROME: ResolvedChrome = {
  contributions: {},
  metricsVersion: 0,
};
