# fast-jev-compaction (Core Library)

Continuous, verbatim context compaction engine for LLM agents using TypeSafe's Jev model and Cloudflare Workers AI Clef.

This package provides the core algorithms and clients with zero heavy dependencies:
- State extraction, fitting, and token estimation (`fitState`, `collectToolCalls`, `estimateTokens`)
- Non-summarizing verbatim pruning logic (`decide`, `compact`, `applyDecisions`)
- Dual-provider client (`JevClient`) supporting both TypeSafe System One API and Cloudflare Workers AI Clef

## Installation

```sh
npm install fast-jev-compaction
```

## Usage

```ts
import { compactMessages, reductionRatio, type Message } from 'fast-jev-compaction';

const transcript: Message[] = [
  { role: 'user', text: 'Fix the failing test. Never edit src/generated.', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 'toolu_1', tool: 'Read', input: { file_path: 'src/a.ts' } }],
  },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'toolu_1', text: '…file…' }] },
];

// Using TypeSafe Jev (default, requires TYPESAFE_API_KEY):
const result = await compactMessages(transcript, { preserveRecentMessages: 4 });

// Or using Cloudflare Workers AI Clef:
// const result = await compactMessages(transcript, {
//   backend: 'cloudflare',
//   model: 'clef', // or 'clef-flash', '@cf/cloudflare/clef'
//   accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
//   apiKey: process.env.CLOUDFLARE_API_TOKEN,
//   preserveRecentMessages: 4,
// });

console.log(result.messages, result.decisions, result.stats);
```

## Backend selection

`resolveEndpoint({ backend, model, baseUrl, accountId })` returns the one
`{ backend, url, bodyModel, keyEnvs }` that every client, request builder and
integration uses. `backend` is `typesafe` (default) or `cloudflare`; an
unsupported combination throws instead of silently calling the wrong API.
`baseUrl` is always a complete endpoint URL used verbatim. When `backend` is
omitted it is inferred from `model` / `baseUrl` / `accountId`.

## License

MIT
