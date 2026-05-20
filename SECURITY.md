# Security Policy

Thank you for helping keep Scrivr and its users safe.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Report privately through GitHub's Security Advisories form:

> [**Report a vulnerability**](https://github.com/Seraa-AI/Scrivr/security/advisories/new)

This opens a private, encrypted thread with the maintainers. We will acknowledge receipt within **3 business days** and aim to provide a substantive response (triage, severity assessment, planned remediation timeline) within **10 business days**.

If you don't get an acknowledgement within 5 business days, please ping `@LanteiRaph` in a follow-up comment on the advisory.

When reporting, please include:

- The Scrivr version (or commit SHA) affected
- The package(s) involved (`@scrivr/core`, `@scrivr/react`, `@scrivr/plugins`, `@scrivr/export*`)
- A clear description of the impact and a minimal reproduction
- Any proof-of-concept code or test fixture that demonstrates the issue
- Suggested mitigation, if you have one

## Coordinated Disclosure

We follow a standard **90-day coordinated-disclosure window**:

1. You report the issue privately.
2. We confirm and triage it within 10 business days.
3. We work with you on a fix and a release timeline. For most issues we aim to ship a patch within 30 days; complex architectural changes may take longer.
4. We publish a security advisory + CVE on release, crediting you (unless you prefer to remain anonymous).
5. If we haven't shipped a fix within 90 days, we will coordinate a public disclosure plan with you rather than leave the issue indefinitely embargoed.

## Supported Versions

Scrivr is currently in **beta** — APIs may change between releases.

| Version | Security fixes |
|---------|----------------|
| Latest `0.x` release on `main` | ✅ Yes |
| Older `0.x` releases | ❌ No backports — please upgrade |

Once Scrivr reaches `1.0`, we will support the current and previous minor versions and document the policy here.

## What's In Scope

Vulnerabilities that affect any of the published `@scrivr/*` packages:

- **`@scrivr/core`** — the editor engine, layout, renderer, schema, input bridge, paste transformer
- **`@scrivr/react`** — React bindings, hooks, components
- **`@scrivr/plugins`** — collaboration (Yjs binding), AI Toolkit, AI Suggestions, Track Changes, Header/Footer
- **`@scrivr/export-pdf`, `@scrivr/export-docx`, `@scrivr/export-markdown`** — export pipelines

Examples of in-scope issues:

- XSS via paste, markdown ingestion, link `href`, image `src`, or any other path that lands user-controlled content in the document
- Schema invariant violations that allow malformed nodes/marks past the parser
- Resource-exhaustion attacks that hang or crash the editor with bounded input (we want bounded input to stay bounded in cost)
- Supply-chain issues in our published `dist/` bundles
- Collaboration protocol issues that let a malicious peer crash other peers or escape the declared-attrs whitelist

## What's Out of Scope

These are the trust boundaries we **explicitly do not defend across**. Reports that depend on these patterns will likely be acknowledged but closed as "expected behaviour" — we mention them here so security researchers don't burn time on them and so app authors know to handle them at their layer.

### Extensions you install are trusted code

Scrivr extensions can register arbitrary ProseMirror plugins, commands, keymaps, and renderers. There is no sandbox. Installing an extension from an untrusted source is equivalent to installing any other untrusted code — it has full access to the document, the editor instance, and the surrounding page.

Same model as TipTap, ProseMirror, CodeMirror, Slate, and most other editor frameworks. Audit extensions like you audit dependencies.

### Collaborative peers can mutate the document

In a Yjs collaboration session, every connected peer can write to the document content and to any extension-declared `doc.attrs`. Scrivr enforces schema invariants (peers can't introduce undeclared nodes/marks or undeclared attrs), but it cannot prevent an authorised peer from making legitimate-looking edits you didn't want.

**Adversarial-peer scenarios require app-level mitigation:** authentication and permissioning (who can join a room), validation (server-side checks on what's allowed), and potentially end-to-end encryption (layer above Yjs).

### AI suggestion prompt injection

If your editor exposes user-controlled content (a shared document, paste from the web, etc.) to an LLM and surfaces the LLM's output as a suggestion, that output may include text that the user accepts and stores. Prompt-injection defences belong at the prompt layer and at the accept-time UX. The framework provides the suggestion overlay primitive; it does not validate model output for you.

### Denial-of-service via pathological input

We recommend app-level limits on:

- Paste payload size
- Image dimensions and file size
- Table dimensions (rows × cols)
- List nesting depth
- Y.js update size (collab)

Pre-1.0 these are documentation only. Hard guards in core are planned for 1.1+, driven by real reports.

## Security Model

Scrivr's load-bearing security invariant is **storage-safe forever**: content that lands in the ProseMirror JSON document — whether typed, pasted, parsed from markdown, applied from a collaborator, or accepted from an AI suggestion — must be safe to render through any surface, including ones that don't exist yet (DOM accessibility mirror, PDF, DOCX, future exports).

That means validation happens at **ingestion time**, not at render time. Canvas is render-safe by accident; future DOM-shaped targets won't be. URL allow-listing, paste normalization, and schema enforcement all sit at the document boundary.

A fuller threat model document is forthcoming as part of the 1.0 graduation.

## Credit

We credit reporters in the published advisory and the CHANGELOG entry for the fix release, unless you ask to remain anonymous. We do not currently offer a bug bounty.

## License

This security policy applies to code released under the [Apache License 2.0](./LICENSE).
