/**
 * `@scrivr/ai` — the AI layer for Scrivr.
 *
 * The AI toolkit (`AiToolkit`, `getAiToolkit`, `GhostText`, `AiCaret`) and the
 * AI-suggestion overlay (`AiSuggestion`, `computeAiSuggestion`, popover +
 * subscription helpers). Builds on `@scrivr/core` and the tracked-merge engine
 * exported from `@scrivr/plugins/track-changes`.
 */
export * from "./ai-toolkit";
export * from "./ai-suggestion";
