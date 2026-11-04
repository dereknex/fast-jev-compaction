# @dereknex/pi-jev-compaction

## 0.5.0

### Minor Changes

- [`b9ec51b`](https://github.com/dereknex/fast-jev-compaction/commit/b9ec51b675ef52ada748b34c67d6a1d81c2446df) Thanks [@dereknex](https://github.com/dereknex)! - Make long transcripts fit the decision state instead of failing, and stop
  re-asking settled calls.
  
  A `clef-flash` session with a few hundred tool calls hit
  `history too large for Jev (~30711 tokens after truncation, limit 19456)` on
  every proactive run: the state could grow only in characters, never in calls,
  so a long enough history could not be fitted at all. Three changes:
  
  - Runs that still carry a collapsed `[… N chars omitted …]` placeholder are now
    folded into one entry with one placeholder for the whole run, instead of
    paying a full entry envelope per message. This halves the per-call floor
    (~70 → ~30 estimated tokens) and lifts the ceiling from ~280 to ~640 calls.
  - When even the folded state does not fit, the oldest entries now leave the
    state, with a `[… N older messages omitted from this state …]` marker, and the
    calls they hold are not judged in that run. `FittedState.omitted` reports the
    message indices, `DecisionStats.deferred` the count, so nothing is dropped
    silently. The floor becomes bounded, so a long session no longer wedges the
    extension; the transcript keeps every message it had.
  - `CompactOptions.skipCallIds` lets callers reuse decisions they already
    applied. During proactive pruning, Pi reuses evaluated `keep` and
    `drop_result` decisions, including after reload. It records the decision
    reason so a pinned call is never mistaken for an evaluated keep; older keep
    entries without a reason are evaluated once before reuse. Manual runs and Pi
    compaction reassess surviving calls, while previously applied pruning remains
    irreversible. `DecisionStats.skipped` and the notification report reuse.
  
  The question reserve in `clampToContextWindow` is also computed from the calls a
  run actually asks about (default: one full batch) instead of always reserving 32
  calls. It includes the 20-token request envelope and leaves room for actual
  question pairs when long tool names exceed the per-call estimate, preventing a
  single candidate from exhausting its question budget.

### Patch Changes

- [`94de824`](https://github.com/dereknex/fast-jev-compaction/commit/94de824f2b644a09def3470a2de1e14fa7246e08) Thanks [@dereknex](https://github.com/dereknex)! - Optimize package metadata for pi.dev package catalog discovery:
  - Add `author` field in `package.json`.
  - Prioritize `pi-package` and `pi-extension` keywords at the beginning of the `keywords` array.
  - Point `pi.extensions` explicitly to `./extensions/pi-jev-compaction.ts`.
- Updated dependencies [[`2cb7251`](https://github.com/dereknex/fast-jev-compaction/commit/2cb725102d68d5f020eda931376019d489b854cd), [`b9ec51b`](https://github.com/dereknex/fast-jev-compaction/commit/b9ec51b675ef52ada748b34c67d6a1d81c2446df)]:
  - @dereknex/jev-compaction@0.6.0

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
