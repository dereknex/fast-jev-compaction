# fast-jev-compaction (Monorepo)

Continuous, verbatim context compaction for LLM agents using TypeSafe's Jev model and Cloudflare Workers AI Clef.

This repository is organized as a monorepo containing:
- **[`packages/core`](packages/core)** (`@dereknex/jev-compaction`): Standalone, lightweight npm library containing the core decision and state-fitting algorithms.
- **[`packages/claude-code`](packages/claude-code)** (`fast-jev-claude-code`): Function-hook plugin for [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code).
- **[`packages/pi`](packages/pi)** (`@dereknex/pi-jev-compaction`): Extension and package for the [Pi coding agent](https://github.com/badlogic/pi-mono).

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
cd /path/to/your-project && npm link @dereknex/jev-compaction
```

#### Usage

```ts
import { compactMessages, reductionRatio, type Message } from '@dereknex/jev-compaction';

// Using TypeSafe Jev (default, requires TYPESAFE_API_KEY):
const result = await compactMessages(transcript, {
  preserveRecentMessages: 4,
});

// Or using Cloudflare Workers AI Clef:
const result = await compactMessages(transcript, {
  backend: 'cloudflare',
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

Enable function hooks and pick a backend. Credentials are read from the plugin's
`sensitive` `apiKey` option first, then from the backend's key chain in the process
environment, then from the `env` block of `~/.claude/settings.json`:

| `backend` | key chain | required besides the key |
| --- | --- | --- |
| `typesafe` (default) | `TYPESAFE_API_KEY` | — |
| `cloudflare` | `CLOUDFLARE_API_TOKEN` → `CLOUDFLARE_AUTH_TOKEN` → `TYPESAFE_API_KEY` | `accountId` (or `CLOUDFLARE_ACCOUNT_ID`) |

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
    "CLOUDFLARE_API_TOKEN": "<your-cloudflare-api-token>"
  }
}
```

Selecting the backend is a plugin option, not an env var. Non-interactively:

```sh
claude plugin configure fast-jev-compaction@fast-jev-compaction --values-stdin <<'JSON'
{"backend":"cloudflare","model":"clef-flash","accountId":"<your-account-id>","compactAtPercent":"45"}
JSON
```

or run `/plugin configure fast-jev-compaction@fast-jev-compaction` inside Claude Code.
Claude Code stores **every** option as a string and passes unset ones as `""`; numeric
options accept `"45"`, and `""` means "use the default". See
[`packages/claude-code/hooks/README.md`](packages/claude-code/hooks/README.md) for the full
option list.

#### 2. Installation

From this checkout, validate the function-hook module first — the whole plugin refuses to
load if it does not pass:

```sh
npm run validate:plugin
```

##### Option 1: Install from GitHub Marketplace (No checkout needed)
```sh
claude plugin marketplace add dereknex/fast-jev-compaction
claude plugin install fast-jev-compaction@fast-jev-compaction
```

##### Option 2: Install from this Repository Checkout

A folder marketplace keeps reading the checkout, so local edits apply on the next
Claude Code start — no reinstall. A marketplace name can only be registered once, so
remove a GitHub-sourced marketplace of the same name first:

```sh
# Option A: Install directly from the local package directory
claude plugin install ./packages/claude-code

# Option B: Add the local monorepo as a marketplace source and install
claude plugin marketplace remove fast-jev-compaction   # only if it points at GitHub
claude plugin marketplace add .
claude plugin install fast-jev-compaction@fast-jev-compaction

# Option C: Run directly with --plugin-dir without installing
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./packages/claude-code
```

`claude plugin list` shows the resolved source path, which is the quickest way to tell a
checkout install from a cached marketplace copy.

See [`packages/claude-code/hooks/README.md`](packages/claude-code/hooks/README.md) for details.

---

### 3. Pi Coding Agent Extension (`packages/pi`)

#### 1. Installation

Install or load the extension directly from this repository checkout:

```sh
# Option A: Install local package into Pi
pi install ./packages/pi

# Option B: Load extension directly from checkout
pi -e ./packages/pi/extensions/pi-jev-compaction.ts
```

#### 2. Configuration (`~/.pi/agent/settings.json` or `.pi/settings.json`)

**Using TypeSafe Jev (Default):**
```json
{
  "fastJevCompaction": {
    "enabled": true,
    "backend": "typesafe",
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
    "backend": "cloudflare",
    "model": "clef",
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
| **`backend` value** | `typesafe` | `cloudflare` |
| **Endpoint** | `https://api.typesafe.ai/v1/systemone` | `https://api.cloudflare.com/client/v4` (or custom AI Gateway) |
| **Auth Credentials** | `TYPESAFE_API_KEY` | `CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_AUTH_TOKEN`) |
| **Account Identifier** | *None* | `CLOUDFLARE_ACCOUNT_ID` |
| **Supported Integrations** | Core library, Claude Code, Pi | Core library, Claude Code, Pi |

---

### Backend selection

`backend` is the single switch that selects the provider. Everything else follows from it, and an unsupported combination fails loudly at load time (Pi disables pruning and says why, the Claude Code hook shows the error and falls back to the built-in summary) instead of silently calling the wrong API.

| Field | `backend: "typesafe"` | `backend: "cloudflare"` |
| --- | --- | --- |
| `model` | `jev-latest` (default) | `clef`, `clef-flash`, `@cf/cloudflare/clef`, `@cf/cloudflare/clef-flash` |
| `accountId` | not allowed | required unless `baseUrl` is set (falls back to `CLOUDFLARE_ACCOUNT_ID`) |
| `baseUrl` | optional, used verbatim | optional, used verbatim |
| key chain | `TYPESAFE_API_KEY` | `CLOUDFLARE_API_TOKEN` → `CLOUDFLARE_AUTH_TOKEN` → `TYPESAFE_API_KEY` |

Notes:
- `baseUrl` has exactly one meaning: a **complete endpoint URL**, used as-is. For AI Gateway, pass the full
  `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway}/workers-ai/@cf/cloudflare/clef` URL.
- When `backend` is omitted it is inferred from `model` / `baseUrl` / `accountId`, so older configs keep working.
  Setting it explicitly is recommended.
- Rejected combinations: `accountId` with `backend: "typesafe"`, a Clef model with
  `backend: "typesafe"`, a non-Clef model with `backend: "cloudflare"`, and a `baseUrl` pointing at the
  TypeSafe endpoint while the backend resolves to `cloudflare`.
- In Claude Code every field is a plugin option (`claude plugin configure`), so `accountId` does not have to be
  an environment variable there; in Pi the same fields live under `fastJevCompaction`. Every consumer (core
  library, Pi extension, Claude Code hook) resolves the endpoint through one function, `resolveEndpoint()`, so
  model, URL and key chain can never drift apart.

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
`backend: "typesafe"` with `model: "jev-latest"` is the plugin default, so no plugin
configuration is needed for this backend.

#### 2. Pi Coding Agent
In `~/.pi/agent/settings.json` (or `.pi/settings.json`):
```json
{
  "fastJevCompaction": {
    "enabled": true,
    "backend": "typesafe",
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
import { compactMessages, JevClient } from '@dereknex/jev-compaction';

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
- **`CLOUDFLARE_API_TOKEN`** (or `CLOUDFLARE_AUTH_TOKEN`): Cloudflare API token with `Workers AI: Read` permission.
- **`CLOUDFLARE_ACCOUNT_ID`**: Your Cloudflare Account ID.
- **`baseUrl`** *(optional)*: A complete endpoint URL, used as-is. For AI Gateway, pass the full
  `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway}/workers-ai/@cf/cloudflare/clef`.

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
Select the backend through the plugin options (`backend`, `model`, `accountId`);
`CLOUDFLARE_ACCOUNT_ID` is only a fallback for `accountId`:
```sh
claude plugin configure fast-jev-compaction@fast-jev-compaction --values-stdin <<'JSON'
{"backend":"cloudflare","model":"clef","accountId":"<your-cloudflare-account-id>"}
JSON
```
Or run directly from a checkout:
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
    "backend": "cloudflare",
    "model": "clef",
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
    "backend": "cloudflare",
    "model": "clef",
    "accountId": "<your-cloudflare-account-id>",
    "apiKeyCommand": "op read op://personal/cloudflare/token"
  }
}
```

#### 3. Core Library (`packages/core`)
```ts
import { compactMessages, JevClient } from '@dereknex/jev-compaction';

// Using compactMessages with Clef:
const result = await compactMessages(transcript, {
  backend: 'cloudflare',
  model: 'clef', // or 'clef-flash', '@cf/cloudflare/clef'
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  preserveRecentMessages: 4,
});

// Or using JevClient with optional AI Gateway (baseUrl is a complete endpoint URL):
const client = new JevClient({
  backend: 'cloudflare',
  model: 'clef',
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
| `maxStateTokens` | `25000` | Maximum token ceiling for conversation state presented to the decision model. Capped at the model's input window when it is known. |
| `maxRequestTokens` | `30000` | Maximum token ceiling per question request sent to the decision model. Capped at the model's input window when it is known, leaving room for one full batch of questions. |

Clef reports its input window (`clef-flash` 24,576 tokens, `clef` 65,536), and every request re-sends the whole state, so on Clef the two budgets above are clamped to keep `state + questions` inside the window. Raise the model, not these numbers, when a transcript does not fit.

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

---

## Release & Versioning

This repository uses [Changesets](https://github.com/changesets/changesets) along with GitHub Actions and [npm Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers) to automate package releases and provenance attestations without storing static `NPM_TOKEN` secrets.

### Adding a Changeset

When submitting changes that should be released:

```sh
npm run changeset
```

1. Select the packages to bump (`@dereknex/jev-compaction`, `@dereknex/pi-jev-compaction`).
2. Choose the bump type (`patch`, `minor`, `major`).
3. Enter a concise summary of the change.
4. Commit the generated file in `.changeset/`.

### Claude Code Plugin Version

`fast-jev-claude-code` is private and ignored by Changesets: it is a bundle of `packages/core/src` plus its hook, so `scripts/sync-claude.js` stamps `packages/claude-code/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` with the version of `@dereknex/jev-compaction`. Claude Code caches an installed plugin by version, so a change that touches only the hook needs a changeset for `@dereknex/jev-compaction` to move that version.

### Automated Publishing Workflow

1. Merging a PR containing a changeset into `main` automatically triggers the [Release workflow](.github/workflows/release.yml), which creates or updates a **"Version Packages"** PR.
2. Merging the **"Version Packages"** PR triggers the automated build, package publishing to the npm registry with cryptographic provenance via Trusted Publisher, git tagging, and GitHub Releases.

### One-Time Bootstrap

A trusted publisher can only be attached to a package that already exists on npm, and CI cannot publish until that trust is in place. Run the guided bootstrap once for a new package name (and once per npm account taking over releases):

```sh
npm install -g npm@^11.15.0   # `npm trust` needs this locally
bash scripts/setup-release.sh
```

It builds and tests, publishes any workspace version that is missing from the registry with your own npm login, then registers `.github/workflows/release.yml` as a trusted publisher for each published package. Requirements: npm write access to the packages and 2FA enabled on the npm account. After that, every release goes through OIDC as described above.

### Repairing a Stage-Only Trusted Publisher

npm registers new trusted publishers as **stage publish only** unless `--allow-publish` is passed. A stage-only entry still authenticates the Release workflow, so the failure only shows up at publish time:

```text
E403: 403 Forbidden - PUT https://registry.npmjs.org/@dereknex%2fjev-compaction - OIDC permission denied for this action
```

Check and repair each package (needs npm 2FA):

```sh
npm login
npm trust list @dereknex/jev-compaction   # note the id of any dereknex/fast-jev-compaction entry
npm trust revoke @dereknex/jev-compaction --id=<id>
npm trust github @dereknex/jev-compaction --repo dereknex/fast-jev-compaction --file release.yml --allow-publish -y
npm trust list @dereknex/jev-compaction   # must report publish (createPackage) permission
```

Repeat for `@dereknex/pi-jev-compaction`. `scripts/setup-release.sh` runs the same check and offers the revoke/re-add when it finds a stage-only entry.

### Expired Trusted Publisher

The same `E403` has a second cause. A newly created trusted publisher must complete its **first successful publish within 2 days**; that publish is what binds the configuration to the repository's immutable identity. A configuration that never got there expires, and `npm trust list` cannot tell you: the entry and its permissions still read as correct.

Delete and recreate it, then trigger the release immediately — the fresh entry is on the same 2-day clock, and a re-run of the failed Release workflow is its first successful publish:

```sh
npm trust list @dereknex/pi-jev-compaction   # note the id
npm trust revoke @dereknex/pi-jev-compaction --id=<id>
npm trust github @dereknex/pi-jev-compaction --repo dereknex/fast-jev-compaction --file release.yml --allow-publish -y
gh run list --workflow=release.yml --limit 1 # grab the failing run id
gh run rerun <run-id> --failed
```

Repeat per package, then re-run right away. Once one release succeeds through a recreated entry it is bound, and it stops expiring.

