---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

**Repo:** add `SECURITY.md` — first PR of the pre-1.x security baseline.

Establishes the disclosure surface and the trust model so external
researchers know how to report vulnerabilities responsibly and app
authors know where the framework's defended surface ends.

Disclosure channel is GitHub Security Advisories (private, encrypted,
CVE-integrated). Coordinated-disclosure window is 90 days. Acknowledge
within 3 business days, substantive response within 10.

Explicitly out-of-scope (so reporters don't burn time and app authors
know to handle these at their layer):

- **Extensions are trusted code** — same model as TipTap / ProseMirror /
  CodeMirror / Slate. No sandbox. Audit extensions like dependencies.
- **Collaborative peers can mutate the document** — Scrivr enforces
  schema invariants but not authorisation. Adversarial-peer scenarios
  need app-level permissioning, validation, and potentially E2EE.
- **AI prompt injection** — defended at the prompt layer + accept-time
  UX, not the suggestion overlay primitive.
- **DoS via pathological input** — documented as recommended app-level
  limits today; hard guards in core planned for 1.1+.

States the load-bearing invariant: **storage-safe forever**. Anything
that enters the ProseMirror JSON document must be safe to render
through any future surface (DOM a11y mirror, PDF, DOCX, exports).
Validation happens at ingestion time, not render time.

No code changes — lockstep patch bump only so the policy is visible
in every published package's release notes.

**Action required by the repo owner before this policy is real:** enable
"Private vulnerability reporting" in repo Settings → Security → Code
security and analysis. Without it the disclosure URL 404s for non-
maintainers.
