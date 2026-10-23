---
'@dereknex/jev-compaction': patch
---

Ship the Claude Code plugin's Clef context-window fix.

Core's runtime is unchanged; this release moves the version the bundled plugin
carries, because Claude Code caches an installed plugin by version. The plugin's
hook builds its own `JevAsker` over `$.http.fetch` instead of using `JevClient`,
so it never reported `contextWindow`, `decide()` kept the default 25,000-token
state budget, and a large transcript on `clef-flash` (24,576 tokens) was rejected
with HTTP 422 — falling back to Claude Code's built-in summary on every
compaction. The asker now reports the window, and `scripts/sync-claude.js` stamps
the plugin and marketplace manifests with this package's version so a merged fix
actually reaches an installed plugin.
