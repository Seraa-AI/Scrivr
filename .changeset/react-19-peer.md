---
"@scrivr/react": patch
---

`@scrivr/react` accepts React 19 as well as React 18. The peer range was `^18.0.0` only, so `npm install` with React 19 failed with a peer-dependency conflict.

The refs the headless hooks return (`rootRef`, and `optionsRef` from `useHeaderFooterRibbon`) now have a declared type, `{ readonly current: HTMLDivElement | null }`. It attaches with `ref={…}` under both `@types/react` 18 and 19.
