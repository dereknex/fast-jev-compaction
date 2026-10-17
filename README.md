# fast-jev-compaction (Monorepo)

Continuous, verbatim context compaction for LLM agents using TypeSafe's Jev model and Cloudflare Workers AI Clef.

This repository is organized as a monorepo containing:
- **[`packages/core`](packages/core)** (`fast-jev-compaction`): Standalone, lightweight npm library containing the core decision and state-fitting algorithms.
- **[`packages/claude-code`](packages/claude-code)** (`fast-jev-claude-code`): Function-hook plugin for [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code).
- **[`packages/pi`](packages/pi)** (`pi-fast-jev-compaction`): Extension and package for the [Pi coding agent](https://github.com/badlogic/pi-mono).

---

## What and Why

Most context compaction asks an LLM to summarize old turns. A summary is lossy: file paths, exact errors, constraints, and command outputs can disappear even when they matter later.

`fast-jev-compaction` never summarizes conversational history:
- It only deletes or truncates tool calls and results that Jev or Clef determines are no longer needed.
- Decisions are made while showing the model the whole conversation state.
- User and assistant text, system instructions, thinking blocks, and message order stay verbatim.
- In Pi, decisions are persisted as append-only entries (`fast-jev-decisions`) in session history and applied on-the-fly when feeding context to the LLM—the underlying session JSONL on disk is never altered.

---

## Packages Overview

### 1. Core Library (`packages/core`)

```sh
npm install fast-jev-compaction
```

```ts
import { compactMessages, reductionRatio, type Message } from 'fast-jev-compaction';

const result = await compactMessages(transcript, {
  preserveRecentMessages: 4,
  // Optional: model: '@cf/cloudflare/clef', accountId: '...', apiKey: '...'
});
```

See [`packages/core/README.md`](packages/core/README.md) for full library documentation.

### 2. Claude Code Plugin (`packages/claude-code`)

Enable function hooks in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
    "TYPESAFE_API_KEY": "<your key>"
  }
}
```

Install via marketplace:

```sh
claude plugin marketplace add tamaratran/fast-jev-compaction
claude plugin install fast-jev-compaction@fast-jev-compaction
```

Or run directly from local checkout:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir packages/claude-code
```

See [`packages/claude-code/hooks/README.md`](packages/claude-code/hooks/README.md) for details.

### 3. Pi Coding Agent Extension (`packages/pi`)

Install via Pi package manager:

```sh
pi install pi-fast-jev-compaction
```

Or run directly from checkout:

```sh
pi -e ./packages/pi/extensions/pi-fast-jev-compaction.ts
```

Configure in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "fastJevCompaction": {
    "enabled": true,
    "model": "jev-latest",
    "compactAtPercent": 60,
    "minReductionRatio": 0.25,
    "cooldownTokens": 8000
  }
}
```

See [`packages/pi/README.md`](packages/pi/README.md) for details.

---

## Development

```sh
npm install
npm run build            # compiles core and pi packages, syncs claude-code
npm run typecheck        # typechecks all workspaces
npm test                 # runs Vitest suite across all workspaces
npm run validate:plugin  # validates Claude Code plugin manifest
```

All test suites run completely offline with mocked providers and zero external network calls.
