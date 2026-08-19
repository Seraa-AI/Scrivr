/**
 * `@scrivr/ai` — the AI layer for Scrivr.
 *
 * The AI toolkit (`AiToolkit`, `getAiToolkit`, `GhostText`, `AiCaret`), the
 * AI-suggestion overlay (`AiSuggestion`, `computeAiSuggestion`, popover +
 * subscription helpers), and the zod-validated semantic edit protocol
 * (`RichSemanticEditSchema`, `parseRichEdits`). Builds on `@scrivr/core`,
 * `@scrivr/export-semantic`, and the tracked-merge engine from `@scrivr/plugins`.
 */
export * from "./ai-toolkit";
export * from "./ai-suggestion";
export * from "./schema";
