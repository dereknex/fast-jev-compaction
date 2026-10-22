---
'@dereknex/jev-compaction': minor
'@dereknex/pi-jev-compaction': minor
---

Record durable, redacted diagnostics when a decision run fails or is cancelled.

Failed and cancelled runs in Pi are now appended as `fast-jev-diagnostics` session entries carrying the outcome, backend, model, trigger mode, execution stage, elapsed time, and — once known — fitted state tokens, fitting stage, and planned batch count. Errors record the error type, an HTTP status when available, and a message redacted of credentials, URLs, and control characters and bounded to 300 characters; response bodies, stacks, and request payloads are never persisted.

Cancellation is reported separately from failure: it emits no warning, does not advance the cooldown, and cancels built-in compaction instead of falling back to it. Failure notifications now name the reason and only claim a Pi fallback when Pi compaction triggered the run.

`decide()` accepts an optional `onProgress` callback and `parseJevResponse()` throws a `JevRequestError` carrying the HTTP status.
