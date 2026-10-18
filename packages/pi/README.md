# pi-fast-jev-compaction (Pi Extension & Package)

Continuous, verbatim context pruning extension for the [Pi coding agent](https://github.com/badlogic/pi-mono), powered by TypeSafe Jev and Cloudflare Workers AI Clef.

## Features

- **Zero Lost Text**: Only unneeded tool calls and results are pruned or truncated. User prompts, assistant responses, thinking blocks, and message ordering remain verbatim.
- **Append-only Ledger**: Pruning decisions are recorded as `fast-jev-decisions` custom entries in Pi's session history; the raw JSONL on disk is never modified.
- **On-the-fly Filtering**: Modifies LLM context dynamically via Pi's `context` hook (`applyLedger`).
- **Proactive & Threshold Compaction**: Runs at `turn_end` when context usage exceeds `compactAtPercent` (with cooldown guard), and hooks into `session_before_compact`.
- **Fail-open Safety**: If an API call fails or reduction is insufficient, delegates transparently to Pi's built-in summary compaction.

## Installation

```sh
pi install pi-fast-jev-compaction
```

Or run directly from a local clone:

```sh
pi -e ./packages/pi/extensions/pi-fast-jev-compaction.ts
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

## License

MIT
