---
"@scrivr/plugins": patch
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/export": patch
---

Add token authentication and connection lifecycle callbacks to the Collaboration plugin and collab server.

**@scrivr/plugins** — `Collaboration.configure()` now accepts `token` (string or async function) forwarded to HocuspocusProvider for WebSocket auth, plus optional `onConnect`/`onDisconnect` callbacks for connection lifecycle visibility.