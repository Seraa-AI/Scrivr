/**
 * Module augmentation — declares the "semantic" format key on FormatHandlers.
 * Imported for its side-effect at the entry point of @scrivr/export-semantic.
 *
 * The handler types live in @scrivr/core (`exports/semantic`); this only adds
 * the key so extensions can declare `addExports().semantic` contributions that
 * the walker collects by name. Any package that contributes a semantic handler
 * (e.g. @scrivr/plugins' TrackChanges) declares the same augmentation locally —
 * identical `semantic: SemanticHandlers` signatures merge cleanly.
 */

import type { SemanticHandlers } from "@scrivr/core";

declare module "@scrivr/core" {
  interface FormatHandlers {
    semantic: SemanticHandlers;
  }
}
