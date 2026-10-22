# @dereknex/pi-jev-compaction (Pi Extension & Package)

Continuous, verbatim context pruning extension for the [Pi coding agent](https://github.com/badlogic/pi-mono), powered by TypeSafe Jev and Cloudflare Workers AI Clef.

## Features

- **Zero Lost Text**: Only unneeded tool calls and results are pruned or truncated. User prompts, assistant responses, thinking blocks, and message ordering remain verbatim.
- **Append-only Ledger**: Pruning decisions are recorded as `fast-jev-decisions` custom entries in Pi's session history; the raw JSONL on disk is never modified.
- **On-the-fly Filtering**: Modifies LLM context dynamically via Pi's `context` hook (`applyLedger`).
- **Proactive & Threshold Compaction**: Runs at `turn_end` when context usage exceeds `compactAtPercent` (with cooldown guard), and hooks into `session_before_compact`.
- **Fail-open Safety**: During Pi compaction, an API failure or insufficient reduction delegates to Pi's built-in summary. Proactive and manual failures leave pruning unchanged.
- **Durable Diagnostics**: Failed and cancelled runs are recorded as `fast-jev-diagnostics` custom entries, separate from the decision ledger.

## Installation

```sh
pi install @dereknex/pi-jev-compaction
```

Or run directly from a local clone:

```sh
pi -e ./packages/pi/extensions/pi-jev-compaction.ts
```

## Configuration

In `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "fastJevCompaction": {
    "enabled": true,
    "backend": "typesafe",
    "model": "jev-latest",
    "compactAtPercent": 60,
    "minReductionRatio": 0.25,
    "cooldownTokens": 8000,
    "preserveRecentMessages": 6,
    "truncateHeadChars": 300
  }
}
```

For Cloudflare Workers AI Clef:

```json
{
  "fastJevCompaction": {
    "backend": "cloudflare",
    "model": "clef-flash",
    "accountId": "your-cloudflare-account-id"
  }
}
```

### `backend` selects the provider

| Field | `backend: "typesafe"` | `backend: "cloudflare"` |
| --- | --- | --- |
| `model` | `jev-latest` (default) | `clef`, `clef-flash`, `@cf/cloudflare/*` |
| `accountId` | not allowed | required unless `baseUrl` is set (else `CLOUDFLARE_ACCOUNT_ID`) |
| `baseUrl` | optional, **complete endpoint URL**, used verbatim | optional, same meaning |
| key | `TYPESAFE_API_KEY` | `CLOUDFLARE_API_TOKEN` → `CLOUDFLARE_AUTH_TOKEN` → `TYPESAFE_API_KEY` |

An unsupported combination is rejected at session start: the extension logs
`fast-jev: disabled; <reason>` and leaves Pi's own compaction untouched. Omitting
`backend` falls back to inference from `model` / `baseUrl` / `accountId` so older
configs keep loading, but setting it explicitly is recommended.

## Commands

- `/fast-jev`: Show current ledger status and statistics.
- `/fast-jev run`: Force a decision run immediately.
- `/fast-jev on` / `/fast-jev off`: Enable or disable for the current session.

## Failure diagnostics

Inspect `fast-jev-diagnostics` custom entries in the session JSONL after a failure.
Each entry records `outcome` (`failed` or `cancelled`), backend, model, trigger mode,
execution stage, and elapsed milliseconds. Fitted state tokens, state fitting stage,
and planned batch count are included once known; missing fields mean they had not
been calculated. Batch count describes planned batches, not successful responses.

Failures also record an error type, a redacted message limited to 300 characters,
and HTTP status when available. HTTP response bodies, stacks, credentials, and
request payloads are excluded. Notifications show the same brief reason and only
claim a Pi fallback when the run was triggered by Pi compaction. Cancellation is
recorded without a failure warning, does not advance the cooldown, and cancels
built-in compaction when encountered in the compaction hook.

Requests retain their existing concurrency and are not automatically retried.

## License

MIT
