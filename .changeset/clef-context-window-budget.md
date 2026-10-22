---
'@dereknex/jev-compaction': patch
'@dereknex/pi-jev-compaction': patch
---

Budget every decision request against the model's input token window.

Clef-flash reports a 24,576-token window while the default budgets asked for 25,000 state and 30,000 request tokens, so a large transcript produced a request the backend rejected with HTTP 422 (`AiError ... the maximum is 24576`) and compaction never ran. `decide()` now clamps `maxStateTokens` and `maxRequestTokens` to the window the asker reports, leaving room for a full batch of questions, and the diagnostics entry records that window. Endpoints without a known window keep the configured budgets.
