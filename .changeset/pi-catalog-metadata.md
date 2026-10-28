---
'@dereknex/pi-jev-compaction': patch
---

Optimize package metadata for pi.dev package catalog discovery:
- Add `author` field in `package.json`.
- Prioritize `pi-package` and `pi-extension` keywords at the beginning of the `keywords` array.
- Point `pi.extensions` explicitly to `./extensions/pi-jev-compaction.ts`.
