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

## Building the Monorepo

Before installing or running packages from this repository, install dependencies and build the workspaces:

```sh
git clone https://github.com/dereknex/fast-jev-compaction.git
cd fast-jev-compaction
npm install
npm run build
```

This compiles `packages/core` and `packages/pi`, and synchronizes core modules into `packages/claude-code`.

---

## Packages Overview & Local Installation

### 1. Core Library (`packages/core`)

Install locally into your target project from this repository checkout:

```sh
# Option A: Install directly via relative or absolute path
npm install /path/to/fast-jev-compaction/packages/core

# Option B: Link via npm link
cd /path/to/fast-jev-compaction/packages/core && npm link
cd /path/to/your-project && npm link fast-jev-compaction
```

#### Usage

```ts
import { compactMessages, reductionRatio, type Message } from 'fast-jev-compaction';

// Using TypeSafe Jev (default, requires TYPESAFE_API_KEY):
const result = await compactMessages(transcript, {
  preserveRecentMessages: 4,
});

// Or using Cloudflare Workers AI Clef:
const result = await compactMessages(transcript, {
  model: '@cf/cloudflare/clef', // or 'clef', 'clef-flash'
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  preserveRecentMessages: 4,
});
```

See [`packages/core/README.md`](packages/core/README.md) for full library documentation.

---

### 2. Claude Code Plugin (`packages/claude-code`)

#### 1. Configuration (`~/.claude/settings.json`)

Enable function hooks and configure credentials for either **TypeSafe Jev** or **Cloudflare Workers AI Clef**:

**Using TypeSafe Jev (Default):**
```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
    "TYPESAFE_API_KEY": "<your-typesafe-key>"
  }
}
```

**Using Cloudflare Workers AI Clef:**
```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
    "CLOUDFLARE_API_TOKEN": "<your-cloudflare-api-token>",
    "CLOUDFLARE_ACCOUNT_ID": "<your-cloudflare-account-id>"
  }
}
```

#### 2. Installation

##### Option 1: Install from GitHub Marketplace (No checkout needed)

```sh
claude plugin marketplace add dereknex/fast-jev-compaction
claude plugin install fast-jev-compaction@fast-jev-compaction
```

##### Option 2: Install from this Repository Checkout

```sh
# Option A: Install directly from the local package directory
claude plugin install ./packages/claude-code

# Option B: Add the local monorepo as a marketplace source and install
claude plugin marketplace add .
claude plugin install fast-jev-compaction@fast-jev-compaction

# Option C: Run directly with --plugin-dir without installing
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./packages/claude-code
```

See [`packages/claude-code/hooks/README.md`](packages/claude-code/hooks/README.md) for details.

---

### 3. Pi Coding Agent Extension (`packages/pi`)

#### 1. Installation

Install or load the extension directly from this repository checkout:

```sh
# Option A: Install local package into Pi
pi install ./packages/pi

# Option B: Load extension directly from checkout
pi -e ./packages/pi/extensions/pi-fast-jev-compaction.ts
```

#### 2. Configuration (`~/.pi/agent/settings.json` or `.pi/settings.json`)

**Using TypeSafe Jev (Default):**
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
Set your key in shell (`export TYPESAFE_API_KEY="<your-key>"`) or configure `apiKeyCommand`.

**Using Cloudflare Workers AI Clef:**
```json
{
  "fastJevCompaction": {
    "enabled": true,
    "model": "@cf/cloudflare/clef",
    "accountId": "<your-cloudflare-account-id>",
    "compactAtPercent": 60,
    "minReductionRatio": 0.25,
    "cooldownTokens": 8000
  }
}
```
Set your token in shell (`export CLOUDFLARE_API_TOKEN="<your-token>"`) or configure `apiKeyCommand`.

See [`packages/pi/README.md`](packages/pi/README.md) for details.

---

## Model Configuration: TypeSafe Jev & Cloudflare Workers AI Clef

`fast-jev-compaction` supports two high-performance backends for verbatim context compaction decisions:
1. **TypeSafe Jev** (Default): Specialized binary call/result scoring model served via TypeSafe System One API.
2. **Cloudflare Workers AI Clef**: Globally distributed LLM scoring model served via Cloudflare Workers AI with optional AI Gateway routing.

### Quick Comparison Matrix

| Feature | TypeSafe Jev (Default) | Cloudflare Workers AI Clef |
| --- | --- | --- |
| **Primary Model ID** | `jev-latest` | `@cf/cloudflare/clef` (shorthand: `clef`) |
| **Fast Variant** | — | `@cf/cloudflare/clef-flash` (shorthand: `clef-flash`) |
| **Provider** | TypeSafe System One | Cloudflare Workers AI |
| **Endpoint (`baseUrl`)** | `https://api.typesafe.ai/v1/systemone` | `https://api.cloudflare.com/client/v4` (or custom AI Gateway) |
| **Auth Credentials** | `TYPESAFE_API_KEY` | `CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_AUTH_TOKEN`, `CLOUDFLARE_API_KEY`) |
| **Account Identifier** | *None* | `CLOUDFLARE_ACCOUNT_ID` |
| **Supported Integrations** | Core library, Claude Code, Pi | Core library, Claude Code, Pi |

---

### Backend 1: TypeSafe Jev Configuration

#### Required Credentials
- **`TYPESAFE_API_KEY`**: Your TypeSafe API key.

#### 1. Claude Code
In `~/.claude/settings.json`:
```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
    "TYPESAFE_API_KEY": "<your-typesafe-api-key>"
  }
}
```

#### 2. Pi Coding Agent
In `~/.pi/agent/settings.json` (or `.pi/settings.json`):
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
Provide the key via environment:
```sh
export TYPESAFE_API_KEY="<your-typesafe-api-key>"
```
Or securely retrieve it via dynamic command (e.g. 1Password CLI):
```json
{
  "fastJevCompaction": {
    "model": "jev-latest",
    "apiKeyCommand": "op read op://personal/typesafe/token"
  }
}
```

#### 3. Core Library (`packages/core`)
```ts
import { compactMessages, JevClient } from 'fast-jev-compaction';

// Using compactMessages (defaults to Jev and process.env.TYPESAFE_API_KEY):
const result = await compactMessages(transcript, {
  preserveRecentMessages: 4,
});

// Or using JevClient:
const client = new JevClient({
  model: 'jev-latest',
  apiKey: process.env.TYPESAFE_API_KEY,
});
```

---

### Backend 2: Cloudflare Workers AI Clef Configuration

#### Supported Clef Identifiers
- `@cf/cloudflare/clef`: Standard Clef model identifier.
- `clef`: Convenience alias (automatically mapped to `@cf/cloudflare/clef`).
- `@cf/cloudflare/clef-flash`: Low-latency Clef Flash model variant.
- `clef-flash`: Convenience alias for Clef Flash.
- `https://developers.cloudflare.com/workers-ai/models/clef/`: Full Cloudflare docs URL format is also recognized.

#### Required Credentials & Environment Variables
- **`CLOUDFLARE_API_TOKEN`** (or `CLOUDFLARE_AUTH_TOKEN`, `CLOUDFLARE_API_KEY`): Cloudflare API token with `Workers AI: Read` permission.
- **`CLOUDFLARE_ACCOUNT_ID`**: Your Cloudflare Account ID.
- **`baseUrl`** *(optional)*: Custom API endpoint, such as Cloudflare AI Gateway URL:
  `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway}/workers-ai/@cf/cloudflare/clef`

#### 1. Claude Code
In `~/.claude/settings.json`:
```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
    "CLOUDFLARE_API_TOKEN": "<your-cloudflare-api-token>",
    "CLOUDFLARE_ACCOUNT_ID": "<your-cloudflare-account-id>"
  }
}
```
Specify the model identifier in your plugin configuration or run directly with:
```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 \
CLOUDFLARE_API_TOKEN="<your-token>" \
CLOUDFLARE_ACCOUNT_ID="<your-account-id>" \
claude --plugin-dir ./packages/claude-code
```

#### 2. Pi Coding Agent
In `~/.pi/agent/settings.json` (or `.pi/settings.json`):
```json
{
  "fastJevCompaction": {
    "enabled": true,
    "model": "@cf/cloudflare/clef",
    "accountId": "<your-cloudflare-account-id>",
    "compactAtPercent": 60,
    "minReductionRatio": 0.25,
    "cooldownTokens": 8000
  }
}
```
Provide the API token via environment:
```sh
export CLOUDFLARE_API_TOKEN="<your-cloudflare-api-token>"
```
Or securely retrieve it via dynamic command (e.g. 1Password CLI):
```json
{
  "fastJevCompaction": {
    "model": "@cf/cloudflare/clef",
    "accountId": "<your-cloudflare-account-id>",
    "apiKeyCommand": "op read op://personal/cloudflare/token"
  }
}
```

#### 3. Core Library (`packages/core`)
```ts
import { compactMessages, JevClient } from 'fast-jev-compaction';

// Using compactMessages with Clef:
const result = await compactMessages(transcript, {
  model: '@cf/cloudflare/clef', // or 'clef', 'clef-flash'
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  preserveRecentMessages: 4,
});

// Or using JevClient with optional AI Gateway:
const client = new JevClient({
  model: '@cf/cloudflare/clef',
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  // baseUrl: 'https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway>/workers-ai/@cf/cloudflare/clef', // optional
});
```

---

### Tuning Compaction Parameters

Both Jev and Clef share the same pruning and compaction engine parameters:

| Parameter | Default | Description |
| --- | --- | --- |
| `compactAtPercent` | `60` | Trigger compaction when context usage exceeds this percentage (Claude Code & Pi). |
| `minReductionRatio` | `0.25` | Minimum estimated character reduction ratio (25%) needed to apply compaction. Falls back to summary if unreached. |
| `preserveRecentMessages` | `6` (plugin/pi), `4` (core) | Number of most recent messages always preserved verbatim. |
| `keepThreshold` | `0.5` | Minimum model confidence score required to keep a tool call or result intact. |
| `truncateHeadChars` | `300` | Number of characters retained from the head of a dropped tool result before trimming. |
| `cooldownTokens` | `8000` | Minimum token growth required in Pi between consecutive compactions to avoid flapping. |
| `maxStateTokens` | `25000` | Maximum token ceiling for conversation state presented to the decision model. |
| `maxRequestTokens` | `30000` | Maximum token ceiling per question request sent to the decision model. |

---

## Development

```sh
npm install
npm run build            # compiles core and pi packages, syncs claude-code
npm run typecheck        # typechecks all workspaces
npm test                 # runs Vitest suite across all workspaces
npm run demo             # runs demonstration script
npm run validate:plugin  # validates Claude Code plugin manifest
```

All test suites run completely offline with mocked providers and zero external network calls.
