---
'@dereknex/jev-compaction': minor
'@dereknex/pi-jev-compaction': minor
---

Make long transcripts fit the decision state instead of failing, and stop
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
