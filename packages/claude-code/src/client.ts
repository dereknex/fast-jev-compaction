import {
  buildJevRequest,
  missingKeyMessage,
  resolveEndpoint,
  parseJevResponse,
  type EndpointConfig,
  type JevBackend,
  type JevEndpoint,
} from './request.js';
import type { JevAsker, JevQuestions, JevResponse, JevState } from './types.js';

export interface JevClientOptions extends EndpointConfig {
  /** Defaults to the first set env var of the resolved backend's key chain. */
  apiKey?: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

function envKey(keyEnvs: readonly string[]): string | undefined {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env;
  for (const name of keyEnvs) {
    const value = env?.[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Asks Jev / Clef over HTTP with the global `fetch` (or an injected one). */
export class JevClient implements JevAsker {
  private readonly apiKey: string;
  private readonly endpoint: JevEndpoint;
  private readonly config: EndpointConfig;
  private readonly fetcher: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    this.config = {
      backend: options.backend,
      model: options.model,
      baseUrl: options.baseUrl,
      accountId: options.accountId,
    };
    this.endpoint = resolveEndpoint(this.config);
    this.fetcher = options.fetch ?? fetch;
    this.apiKey = options.apiKey ?? envKey(this.endpoint.keyEnvs) ?? '';
  }

  /** The backend this client resolved to (`typesafe` or `cloudflare`). */
  get backend(): JevBackend {
    return this.endpoint.backend;
  }

  async ask(state: JevState, questions: JevQuestions, signal?: AbortSignal): Promise<JevResponse> {
    if (!this.apiKey) throw new Error(missingKeyMessage(this.endpoint.backend));
    const request = buildJevRequest(
      { ...this.config, apiKey: this.apiKey },
      state,
      questions,
    );
    const response = await this.fetcher(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal,
    });
    return parseJevResponse(response.status, response.ok, await response.text());
  }
}
