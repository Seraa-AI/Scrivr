// Side-effect: augments FormatHandlers with the "pdf" key.
import "./augmentation";

export { PdfExport } from "./PdfExport";
export type { PdfHandlers, PdfNodeHandler, PdfChromeHandler } from "./augmentation";
export type { PdfEmbedSource } from "@scrivr/core";
// The handler contract lives in core so an extension can describe its node and
// its mark without depending on this package; re-exported for consumers already
// importing it from here.
export type {
  FontResolutionId,
  PdfNodeContext,
  PdfBlockDrawSurface,
  PdfMarkHandler,
  PdfSpanStyle,
  PdfSpanMark,
  PdfMarkContext,
  PdfDrawSurface,
  PdfPoint,
  PdfBox,
  PdfTextOp,
  PdfLineOp,
  PdfRectOp,
  PdfEllipseOp,
  PdfImageOp,
  PdfFontHandle,
  PdfImageHandle,
  Rgb,
} from "@scrivr/core";
export type { PdfContext, PdfFontRegistry, PdfDrawHelpers } from "./context";
export type { PdfMetadata } from "./metadata";
export type { ImageResolver, ImageBytes } from "./fetchImage";

export { buildPdf, exportToPdf } from "./pdf";
export type { PdfExportOptions } from "./pdf";

export { exportExecutedPdf } from "./executed";
export type { ExecutedPdfOptions, ExecutedPdfRefusal, ExecutedPdfResult } from "./executed";
export { bundleCertificate, exportCompletionCertificate, DEFAULT_CERTIFICATE_LABELS } from "./certificate";
export type {
  CertificateContent,
  CertificateNode,
  CertificateSlot,
  CertificateLabels,
  CertificateParts,
  CertificateRefusal,
  CompletionCertificateOptions,
  CompletionCertificateResult,
  CompletionEvent,
  CompletionParty,
  CompletionRecord,
  StandardEventKind,
  VerifiedFacts,
  VerifiedSignature,
} from "./certificate";
