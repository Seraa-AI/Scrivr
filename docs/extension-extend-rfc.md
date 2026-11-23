# Extending an extension

**Status:** shipped.
**Asked by:** Seraa. They need to change a built-in where it limits them, without forking it.

## Problem

- **Options only:** an extension can be configured, but `configure` changes its options, not its behaviour.
- **No partial override:** to change one attribute of a node, one keymap or one command, a host had to write a whole new extension with the same name. That meant copying every hook it wanted to keep, and following each upstream change by hand.
- **Nothing to build on:** an extension's hooks are private.

## Design

- **The API:** `extension.extend(overrides)` returns a new extension.
  - It takes any part of an `ExtensionConfig`.
  - A hook in `overrides` replaces the original's.
  - Inside it, `this` is the hook's usual context plus `parent`.
- **What `parent` is:** the original hook, called with the same context and arguments. It is `undefined` when the original declares no such hook.
  - An override that calls it changes or adds to the original's result.
  - One that doesn't replaces it.
- **Hooks left out** stay the original's.
- **Chaining:** `extend` can be chained, and each layer's `parent` is the one below it.
- **No change to `resolve()`:** it already calls every hook with `.call(context)`, so `extend` wraps hooks and nothing else changes.
- **Every hook is covered,** by a typed table that names each one. The compiler fails when a hook is added to `ExtensionConfig` but not to `extend`.
- **Options:**
  - The new extension starts from the original's current options, so a configured extension extends as configured.
  - `overrides.defaultOptions` merges over them, and `configure` applies after, as for any extension.
  - The new options type must extend the original's, because the original's hooks still read them.
- **Name and keymap priority** carry over unless `overrides` names them. A new name renames the extension. Keys its hooks write literally stay the same, and a key built from `this.name` follows the new name.
- **Lifecycle hooks:** an `onEditorReady` or `onViewReady` override returns the parent's cleanup, or combines it with its own.
- **Replacing a StarterKit child:** turn it off in `StarterKit.configure` and list the extended one. Otherwise both register the same node or mark, and the later one wins with a warning.
- **Replacing Paragraph:** it must be replaced in place, by mapping `this.parent()` in `StarterKit.extend({ addExtensions })`. The first block type registered is the one an empty document starts with. Bundles extend like any extension.
- **Declined from review:** keeping the stored config as a strict `ExtensionConfig`, without explicitly `undefined` hooks. The private config names every hook so that the compiler checks `extend` covers each one, and every reader calls hooks with `?.call`.

### Rejected

- **Replacing whole extensions by name inside the manager:** this is implicit. It can't keep part of the original, and it hides which extension is in effect.
- **Copying the config with `Object.assign`:** this can't reach the original hook, so there is no `parent`.

## What shipped

- `Extension.prototype.extend` in `@scrivr/core`, with the `ExtendConfig`, `ExtendHookContext`, `ExtensionHookName` and `Phase1Context` types exported.
- Tests in `packages/core/src/extensions/extend.test.ts`, covering:
  - a node attribute added to Heading;
  - a command added beside Bold's;
  - a keymap replaced outright;
  - an undeclared hook staying the original's, and a rename;
  - chained `parent`;
  - `parent` being `undefined` with no original hook;
  - option merging with `configure` after `extend`;
  - lifecycle hook arguments;
  - extending StarterKit with a child;
  - a lifecycle override keeping the parent's cleanup;
  - replacing Paragraph in place, so it stays the default block.
- A "Customising a built-in extension" section in the custom extensions guide.
