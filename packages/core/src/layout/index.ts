export { CharacterMap } from "./CharacterMap";
export { ExclusionManager } from "./ExclusionManager";
export type { AvailableSegment, ExclusionRect, LineSpace } from "./ExclusionManager";
export type { GlyphEntry, LineEntry, CoordsResult } from "./CharacterMap";
export { TextMeasurer } from "./TextMeasurer";
export type { FontMetrics, RunMetrics, TextMeasurerLike } from "./TextMeasurer";
export { LineBreaker } from "./LineBreaker";
export type { InputSpan, LayoutSpan, LayoutLine, LineSpaceProvider } from "./LineBreaker";
export { layoutBlock, resolveLeafBlockDimensions, computeAlignmentOffset, computeJustifySpaceBonus, countSpaces } from "./BlockLayout";
export type { LayoutBlock, BlockLayoutOptions } from "./BlockLayout";
export { runPipeline, buildFragments, defaultPageConfig, defaultPagelessConfig, collapseMargins } from "./PageLayout";
export type { PageConfig, LayoutPage, DocumentLayout, PageLayoutOptions, LayoutFragment } from "./PageLayout";
export type {
  WrapMode,
  PositionMode,
  XAlign,
  LegacyWrappingMode,
  NormalizedImageAttrs,
  AnchoredObjectInput,
  AnchoredObjectPlacement,
  WrapZone,
  AnchoredObjectSolverResult,
} from "./AnchoredObjects";
export {
  ANCHORED_OBJECT_MARGIN,
  normalizeImageAttrs,
  resolveImageX,
  isWrapModeValue,
  isLegacyWrappingMode,
  compareAnchoredObjectPaintOrder,
  compareAnchoredObjectHitOrder,
} from "./AnchoredObjects";
export { defaultFontConfig, getBlockStyle, DEFAULT_FONT_FAMILY } from "./FontConfig";
export type { FontConfig, BlockStyle } from "./FontConfig";
export type {
  PageMetrics,
  PageFlowMetrics,
  ChromeContribution,
  ResolvedChrome,
  LayoutIterationContext,
  PageChromeMeasureInput,
  PageChromePaintContext,
  PageChromeContribution,
} from "./PageMetrics";
export {
  pageStartGlobalForMetrics,
  pageLocalYToGlobalForMetrics,
} from "./PageMetrics";
export { runMiniPipeline } from "./runMiniPipeline";
export type { MiniPipelineOptions } from "./runMiniPipeline";
export { resolveFont } from "./StyleResolver";
export { BlockRegistry } from "./BlockRegistry";
export { LayoutCoordinator } from "./LayoutCoordinator";
export type { LayoutCoordinatorOptions } from "./LayoutCoordinator";
export type { BlockStrategy, BlockRenderContext, InlineStrategy } from "./BlockRegistry";
export { TextBlockStrategy } from "./TextBlockStrategy";
export { ListItemStrategy } from "./ListItemStrategy";
