---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Allow mouse selection (click, drag, double/triple-click) in readOnly mode so users can select and copy text. Block programmatic command dispatch (`editor.commands.*`) in readOnly to prevent extensions from bypassing InputBridge.
