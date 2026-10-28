# @dereknex/pi-jev-compaction

## 0.4.2

### Patch Changes

- [`94de824`](https://github.com/dereknex/fast-jev-compaction/commit/94de824f2b644a09def3470a2de1e14fa7246e08) Thanks [@dereknex](https://github.com/dereknex)! - Optimize package metadata for pi.dev package catalog discovery:
  - Add `author` field in `package.json`.
  - Prioritize `pi-package` and `pi-extension` keywords at the beginning of the `keywords` array.
  - Point `pi.extensions` explicitly to `./extensions/pi-jev-compaction.ts`.
- Updated dependencies [[`2cb7251`](https://github.com/dereknex/fast-jev-compaction/commit/2cb725102d68d5f020eda931376019d489b854cd)]:
  - @dereknex/jev-compaction@0.5.2

## 0.4.1

### Patch Changes

- [`8f4877d`](https://github.com/dereknex/fast-jev-compaction/commit/8f4877d47ba9571219639686d5b07037425bda35) Thanks [@dereknex](https://github.com/dereknex)! - Budget every decision request against the model's input token window.
  
  Clef-flash reports a 24,576-token window while the default budgets asked for 25,000 state and 30,000 request tokens, so a large transcript produced a request the backend rejected with HTTP 422 (`AiError ... the maximum is 24576`) and compaction never ran. `decide()` now clamps `maxStateTokens` and `maxRequestTokens` to the window the asker reports, leaving room for a full batch of questions, and the diagnostics entry records that window. Endpoints without a known window keep the configured budgets.
- Updated dependencies [[`8f4877d`](https://github.com/dereknex/fast-jev-compaction/commit/8f4877d47ba9571219639686d5b07037425bda35)]:
  - @dereknex/jev-compaction@0.5.1

## 0.4.0

### Minor Changes

- [`15cebf1`](https://github.com/dereknex/fast-jev-compaction/commit/15cebf1323cd0849f373e9133cadf6336b9cf590) Thanks [@dereknex](https://github.com/dereknex)! - Record durable, redacted diagnostics when a decision run fails or is cancelled.
  
  Failed and cancelled runs in Pi are now appended as `fast-jev-diagnostics` session entries carrying the outcome, backend, model, trigger mode, execution stage, elapsed time, and — once known — fitted state tokens, fitting stage, and planned batch count. Errors record the error type, an HTTP status when available, and a message redacted of credentials, URLs, and control characters and bounded to 300 characters; response bodies, stacks, and request payloads are never persisted.
  
  Cancellation is reported separately from failure: it emits no warning, does not advance the cooldown, and cancels built-in compaction instead of falling back to it. Failure notifications now name the reason and only claim a Pi fallback when Pi compaction triggered the run.
  
  `decide()` accepts an optional `onProgress` callback and `parseJevResponse()` throws a `JevRequestError` carrying the HTTP status.

### Patch Changes

- Updated dependencies [[`15cebf1`](https://github.com/dereknex/fast-jev-compaction/commit/15cebf1323cd0849f373e9133cadf6336b9cf590)]:
  - @dereknex/jev-compaction@0.5.0
